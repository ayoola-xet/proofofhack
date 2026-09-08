import { randomBytes, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { type Hex, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { BountyReader } from "../../../packages/chain/src/bounty-reader.ts";
import { protectCiphertextWrite } from "../../../packages/ciphertext-store/src/coordination.ts";
import type { CiphertextStore } from "../../../packages/ciphertext-store/src/index.ts";
import {
  canonicalJson,
  decryptReport,
  encryptReport,
  hashCanonical,
  unseal,
} from "../../../packages/crypto-envelope/src/index.ts";
import {
  address,
  admissionFields,
  assessmentFields,
  bytes32,
  DomainError,
  MAX_EVIDENCE_BYTES,
  policySchema,
  signingDomain,
} from "../../../packages/domain/src/index.ts";
import type { PublicServiceConfig } from "../../../packages/service-config/src/index.ts";
import { first } from "../../api/src/context.ts";
import { assessFixture } from "./fixture.ts";
export type VerifierOptions = {
  config: PublicServiceConfig;
  evidence: CiphertextStore;
  reports: CiphertextStore;
  reader: BountyReader;
  evidenceKeys: { publicKey: string; privateKey: string };
  researcherKeys: { publicKey: string; privateKey: string };
  admissionKey: Hex;
  verdictKey: Hex;
};
export class FixtureVerifier {
  private admission;
  private verdict;
  constructor(
    private pool: Pool,
    private options: VerifierOptions,
  ) {
    this.admission = privateKeyToAccount(options.admissionKey);
    this.verdict = privateKeyToAccount(options.verdictKey);
    if (
      address.parse(this.admission.address) !== options.config.admissionSigner ||
      address.parse(this.verdict.address) !== options.config.verdictSigner ||
      options.evidenceKeys.publicKey !== options.config.evidencePublicKey
    )
      throw new Error("Verifier keys do not match the configured identities.");
  }
  private async context(c: PoolClient, claimId: string) {
    const claim = await first(
      c,
      `select c.*,u.object_key,u.ciphertext_hash,u.key_id,u.byte_length,u.expires_at,u.state as upload_state,b.policy_json,b.policy_hash from claims c join uploads u on u.id=c.upload_id join bounties b on b.bounty_id=c.bounty_id where c.claim_id=$1`,
      [bytes32.parse(claimId)],
    );
    const policy = policySchema.parse(claim.policy_json),
      config = this.options.config;
    if (
      policy.adapterCodeHash !== config.adapterCodeHash ||
      policy.verifierConfigHash !== config.verifierConfigHash ||
      policy.admissionSigner !== config.admissionSigner ||
      policy.verdictSigner !== config.verdictSigner ||
      claim.key_id !== config.evidenceKeyId ||
      claim.evidence_commitment !== claim.ciphertext_hash
    )
      throw new DomainError(
        "VERIFIER_BINDING_MISMATCH",
        "The claim requires a different verifier configuration.",
      );
    if (claim.upload_state !== "UPLOADED" || claim.expires_at.getTime() <= Date.now())
      throw new DomainError("EVIDENCE_UNAVAILABLE", "The encrypted evidence is not available.");
    const chain = await this.options.reader.read(policy);
    const ciphertext = await this.options.evidence.read(claim.object_key, claim.ciphertext_hash);
    if (ciphertext.length !== claim.byte_length)
      throw new DomainError("EVIDENCE_INTEGRITY", "The encrypted evidence size does not match.");
    let plaintext: Uint8Array | undefined;
    try {
      plaintext = await unseal(ciphertext, this.options.evidenceKeys);
      if (plaintext.length > MAX_EVIDENCE_BYTES) throw new Error("Evidence size");
      const assessment = assessFixture(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        policy,
        { claimId: claim.claim_id, bountyId: claim.bounty_id, assessedAt: chain.timestamp },
      );
      return { claim, policy, chain, assessment };
    } catch {
      throw new DomainError(
        "INVALID_FIXTURE",
        "The encrypted file must contain a valid case from the signed synthetic manifest.",
        422,
      );
    } finally {
      plaintext?.fill(0);
    }
  }
  async admit(claimId: string) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `verifier:${bytes32.parse(claimId)}`,
      ]);
      const { claim, policy, chain, assessment } = await this.context(c, claimId);
      const prior = (
        await c.query(
          "select payload_json,signature_ref from admissions where claim_id=$1 and state='SIGNED' order by created_at desc limit 1",
          [claimId],
        )
      ).rows[0];
      if (prior && BigInt(prior.payload_json.validUntil) >= chain.timestamp) {
        await c.query("commit");
        return { payload: prior.payload_json, signature: prior.signature_ref };
      }
      if (chain.state !== 1 || chain.timestamp >= BigInt(policy.submissionDeadline))
        throw new DomainError("BOUNTY_BUSY", "The bounty does not accept a reservation now.");
      const duplicate = (
        await c.query(
          "select c.claim_id from claims c join assessments a on a.claim_id=c.claim_id where c.bounty_id=$1 and c.case_nullifier=$2 and c.claim_id<>$3 limit 1",
          [claim.bounty_id, assessment.caseNullifier, claimId],
        )
      ).rows[0];
      if (duplicate)
        throw new DomainError(
          "DUPLICATE_FIXTURE",
          "This exact fixture case already has an assessment.",
        );
      const limit = chain.timestamp + 300n,
        deadline = BigInt(policy.submissionDeadline),
        validUntil = limit < deadline ? limit : deadline;
      const payload = {
        bountyId: claim.bounty_id as Hex,
        claimId: claim.claim_id as Hex,
        claimant: address.parse(claim.claimant_address),
        evidenceCommitment: bytes32.parse(claim.evidence_commitment),
        authorizationNonce: `0x${randomBytes(32).toString("hex")}` as Hex,
        validUntil: validUntil.toString(),
      };
      const signature = await this.admission.signTypedData({
        domain: signingDomain(Number(policy.settlementChainId), policy.escrow),
        types: { AdmissionV1: admissionFields },
        primaryType: "AdmissionV1",
        message: { ...payload, validUntil },
      });
      await c.query(
        "insert into admissions(claim_id,nonce,payload_json,signature_ref,valid_until,state) values($1,$2,$3,$4,$5,'SIGNED')",
        [
          claimId,
          payload.authorizationNonce,
          JSON.stringify(payload),
          signature,
          new Date(Number(validUntil) * 1000),
        ],
      );
      await c.query(
        "update claims set case_nullifier=$2,job_state='RESERVING',updated_at=now() where claim_id=$1",
        [claimId, assessment.caseNullifier],
      );
      await c.query("commit");
      return { payload, signature };
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  }
  async assess(claimId: string) {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await protectCiphertextWrite(c);
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `verifier:${bytes32.parse(claimId)}`,
      ]);
      const prior = (
        await c.query("select payload_json,signature_ref from assessments where claim_id=$1", [
          claimId,
        ])
      ).rows[0];
      if (prior) {
        await c.query("commit");
        return { payload: prior.payload_json, signature: prior.signature_ref };
      }
      const { claim, policy, chain, assessment } = await this.context(c, claimId),
        r = chain.reservation;
      if (
        chain.state !== 2 ||
        r.claimId !== claimId ||
        r.claimant.toLowerCase() !== claim.claimant_address ||
        r.evidenceCommitment !== claim.evidence_commitment ||
        chain.timestamp > r.expiresAt ||
        chain.timestamp < r.reservedAt
      )
        throw new DomainError(
          "RESERVATION_MISMATCH",
          "The claim needs its matching active chain reservation.",
        );
      const orgKey = await first(
        c,
        "select k.public_key from organization_keys k join programs p on p.organization_id=k.organization_id join bounties b on b.program_id=p.id where b.bounty_id=$1 and k.key_id=$2",
        [claim.bounty_id, policy.reportRecipientKeyId],
      );
      const reportBytes = new TextEncoder().encode(canonicalJson(assessment.report));
      const organization = await encryptReport(reportBytes, orgKey.public_key),
        researcher = await encryptReport(reportBytes, this.options.researcherKeys.publicKey);
      const orgBytes = new TextEncoder().encode(canonicalJson(organization)),
        researcherBytes = new TextEncoder().encode(canonicalJson(researcher));
      const orgObject = randomUUID(),
        researcherObject = randomUUID(),
        orgHash = keccak256(orgBytes),
        researcherHash = keccak256(researcherBytes);
      await this.options.reports.put(orgObject, orgBytes, orgHash);
      await this.options.reports.put(researcherObject, researcherBytes, researcherHash);
      const savedOrg = await this.options.reports.read(orgObject, orgHash);
      const savedResearcher = JSON.parse(
        new TextDecoder().decode(await this.options.reports.read(researcherObject, researcherHash)),
      );
      if (keccak256(savedOrg) !== orgHash) throw new Error("Organization report read-back failed.");
      const check = await decryptReport(savedResearcher, this.options.researcherKeys);
      try {
        if (keccak256(check) !== assessment.reportHash)
          throw new Error("Researcher report read-back failed.");
      } finally {
        check.fill(0);
        reportBytes.fill(0);
      }
      await c.query(
        "insert into reports(claim_id,report_hash,ciphertext_object_key,ciphertext_hash,researcher_object_key,researcher_ciphertext_hash,researcher_key_id,wrapped_key_ref,recipient_key_id,state,delete_after,retention_hold) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'SEALED',now()+interval '7 days',$10)",
        [
          claimId,
          assessment.reportHash,
          orgObject,
          orgHash,
          researcherObject,
          researcherHash,
          keccak256(toHex(this.options.researcherKeys.publicKey)),
          hashCanonical(organization.wrappedKey),
          policy.reportRecipientKeyId,
          assessment.report.outcome === "QUALIFIES",
        ],
      );
      const qualifies = assessment.report.outcome === "QUALIFIES";
      const payload = {
        bountyId: claim.bounty_id as Hex,
        policyHash: claim.bounty_id as Hex,
        claimId: claim.claim_id as Hex,
        claimant: address.parse(claim.claimant_address),
        evidenceCommitment: bytes32.parse(claim.evidence_commitment),
        caseNullifier: assessment.caseNullifier,
        reportHash: assessment.reportHash,
        adapterCodeHash: policy.adapterCodeHash,
        verifierConfigHash: policy.verifierConfigHash,
        outcome: qualifies ? "1" : "2",
        reward: qualifies ? policy.reward : "0",
        assessedAt: chain.timestamp.toString(),
        validUntil: r.expiresAt.toString(),
      };
      const signature = await this.verdict.signTypedData({
        domain: signingDomain(Number(policy.settlementChainId), policy.escrow),
        types: { AssessmentV1: assessmentFields },
        primaryType: "AssessmentV1",
        message: {
          ...payload,
          outcome: Number(payload.outcome),
          reward: BigInt(payload.reward),
          assessedAt: chain.timestamp,
          validUntil: r.expiresAt,
        },
      });
      await c.query(
        "insert into assessments(claim_id,outcome,report_hash,payload_json,signature_ref,assessed_at) values($1,$2,$3,$4,$5,$6)",
        [
          claimId,
          assessment.report.outcome,
          assessment.reportHash,
          JSON.stringify(payload),
          signature,
          new Date(Number(chain.timestamp) * 1000),
        ],
      );
      await c.query(
        "update claims set job_state='ASSESSED',case_nullifier=$2,reservation_expiry=$3,updated_at=now() where claim_id=$1",
        [claimId, assessment.caseNullifier, new Date(Number(r.expiresAt) * 1000)],
      );
      await c.query("commit");
      return { payload, signature };
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  }
}
