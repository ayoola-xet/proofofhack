import { usePrivy, useSignMessage } from "@privy-io/react-auth";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { keccak256 } from "viem";
import { canonicalJson, seal } from "../../../../packages/crypto-envelope/src/index.ts";
import { formatMoney, parseMoney } from "../../../../packages/domain/src/index.ts";
import { useApi, useResource, type Wallet } from "../api.ts";

type ProgramSummary = {
  id: string;
  name: string;
  scope_summary: string | null;
  rules_summary: string | null;
  organization_name: string;
};
type Tier = {
  id: string;
  name: string;
  min_reward: string;
  max_reward: string;
  openSlots: number;
  scopeAddress: string | null;
};
type ProgramDetailData = ProgramSummary & { tiers: Tier[] };

export function ProgramDirectory() {
  const programs = useResource<{ items: ProgramSummary[] }>("/programs");
  return (
    <>
      <header className="page-title">
        <div>
          <p className="eyebrow">FIND A PROGRAM</p>
          <h1>Public bug bounty programs.</h1>
          <p className="muted">
            Every finding is auto-verified by sandbox execution and AI review. No manual triage.
          </p>
        </div>
      </header>
      {programs.loading && <p role="status">Loading programs…</p>}
      {programs.error && <p role="alert">{programs.error}</p>}
      {programs.data?.items.length === 0 && <p>No public programs are open right now.</p>}
      <div className="bounty-grid">
        {programs.data?.items.map((program) => (
          <article className="panel" key={program.id}>
            <div className="section-heading">
              <ShieldCheck size={20} />
              <span className="pill">{program.organization_name}</span>
            </div>
            <h2>{program.name}</h2>
            {program.scope_summary && <p className="muted">{program.scope_summary}</p>}
            <Link className="primary" to={`/programs/${program.id}`}>
              View program <ArrowRight size={15} />
            </Link>
          </article>
        ))}
      </div>
    </>
  );
}

const TIER_NAMES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

export function ProgramSeverityTiers({
  organizationId,
  programId,
  canManage,
}: {
  organizationId: string;
  programId: string;
  canManage: boolean;
}) {
  const api = useApi();
  const program = useResource<ProgramDetailData>(`/programs/${programId}`);
  const [name, setName] = useState<(typeof TIER_NAMES)[number]>("CRITICAL");
  const [minReward, setMinReward] = useState("");
  const [maxReward, setMaxReward] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/organizations/${organizationId}/programs/${programId}/severity-tiers`, {
        method: "POST",
        body: {
          name,
          minReward: parseMoney(minReward).toString(),
          maxReward: parseMoney(maxReward).toString(),
        },
      });
      setMinReward("");
      setMaxReward("");
      program.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <strong>Severity tiers</strong>
      {program.error && <p role="alert">{program.error}</p>}
      {program.data?.tiers.map((tier) => (
        <div className="record" key={tier.id}>
          <span className="pill">{tier.name}</span>
          <small>
            {formatMoney(BigInt(tier.min_reward))} - {formatMoney(BigInt(tier.max_reward))} test
            USDC · {tier.openSlots} open slot{tier.openSlots === 1 ? "" : "s"}
          </small>
        </div>
      ))}
      {program.data?.tiers.length === 0 && (
        <p className="muted">No severity tiers yet. Researchers cannot submit until you add one.</p>
      )}
      {canManage && (
        <form className="form-row" onSubmit={submit}>
          <label>
            Tier
            <select value={name} onChange={(e) => setName(e.target.value as typeof name)}>
              {TIER_NAMES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label>
            Minimum reward (test USDC)
            <input
              inputMode="decimal"
              required
              value={minReward}
              onChange={(e) => setMinReward(e.target.value)}
              placeholder="500"
            />
          </label>
          <label>
            Maximum reward (test USDC)
            <input
              inputMode="decimal"
              required
              value={maxReward}
              onChange={(e) => setMaxReward(e.target.value)}
              placeholder="5000"
            />
          </label>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <button type="submit" className="secondary" disabled={busy}>
            {busy ? "Adding…" : "Add tier"}
          </button>
        </form>
      )}
    </div>
  );
}

export function ProgramDetail() {
  const { id } = useParams();
  const program = useResource<ProgramDetailData>(id ? `/programs/${id}` : null);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  return (
    <>
      <header className="page-title">
        <div>
          <p className="eyebrow">{program.data?.organization_name ?? "PROGRAM"}</p>
          <h1>{program.data?.name ?? "Program"}</h1>
          {program.data?.scope_summary && <p className="muted">{program.data.scope_summary}</p>}
        </div>
      </header>
      {program.loading && <p role="status">Loading program…</p>}
      {program.error && <p role="alert">{program.error}</p>}
      {program.data?.rules_summary && (
        <section className="panel">
          <h2>Rules</h2>
          <p>{program.data.rules_summary}</p>
        </section>
      )}
      <section className="panel">
        <h2>Severity tiers</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Tier</th>
              <th scope="col">Reward range</th>
              <th scope="col">In-scope contract</th>
              <th scope="col">Open slots</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {program.data?.tiers.map((tier) => (
              <tr key={tier.id}>
                <td>{tier.name}</td>
                <td>
                  {formatMoney(BigInt(tier.min_reward))} - {formatMoney(BigInt(tier.max_reward))}{" "}
                  USDC
                </td>
                <td className="mono break">{tier.scopeAddress ?? "—"}</td>
                <td>{tier.openSlots}</td>
                <td>
                  <button
                    type="button"
                    className="secondary"
                    disabled={tier.openSlots === 0}
                    onClick={() => setSelectedTier(tier.id)}
                  >
                    Submit a finding
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {selectedTier && program.data && (
        <FindingSubmissionForm
          programId={program.data.id}
          tierId={selectedTier}
          scopeAddress={
            program.data.tiers.find((tier) => tier.id === selectedTier)?.scopeAddress ?? null
          }
          onClose={() => setSelectedTier(null)}
        />
      )}
    </>
  );
}

type FindingRecord = {
  id: string;
  title: string;
  summary: string;
  affected_component: string;
  self_assessed_severity: string;
  verdict_severity: string | null;
  status: string;
  tier_name: string;
  report_id: string | null;
  report_state: string | null;
};

export function MyFindings() {
  const findings = useResource<{ items: FindingRecord[] }>("/findings/me");
  if (findings.loading) return <p role="status">Loading findings…</p>;
  if (!findings.data?.items.length) return null;
  return (
    <section className="panel">
      <h2>My findings</h2>
      {findings.data.items.map((finding) => (
        <div className="record" key={finding.id}>
          <ShieldCheck size={20} />
          <div>
            <strong>{finding.title}</strong>
            <small>{finding.affected_component}</small>
            <small>
              Self-assessed {finding.self_assessed_severity}
              {finding.verdict_severity ? ` · Verified ${finding.verdict_severity}` : ""}
            </small>
          </div>
          <span className="pill">{finding.status}</span>
        </div>
      ))}
    </section>
  );
}

export function OrganizationFindings({ organizationId }: { organizationId: string }) {
  const findings = useResource<{ items: FindingRecord[] }>(
    `/organizations/${organizationId}/findings`,
  );
  if (findings.loading) return <p role="status">Loading findings…</p>;
  if (!findings.data?.items.length) return null;
  return (
    <section className="panel">
      <h2>Program findings</h2>
      {findings.data.items.map((finding) => (
        <div className="record" key={finding.id}>
          <ShieldCheck size={20} />
          <div>
            <strong>{finding.title}</strong>
            <small>{finding.summary}</small>
            <small>
              {finding.tier_name}
              {finding.verdict_severity ? ` · Verified ${finding.verdict_severity}` : ""}
            </small>
          </div>
          <span className="pill">
            {finding.report_state === "AVAILABLE" ? "PAID" : finding.status}
          </span>
        </div>
      ))}
    </section>
  );
}

type PayoutApproval = {
  id: string;
  claim_id: string;
  reward: string;
  required_approvals: number;
  signatures: number;
  state: string;
  title: string | null;
  message: string;
};

export function PayoutApprovals({ organizationId }: { organizationId: string }) {
  const api = useApi();
  const { signMessage } = useSignMessage();
  const wallets = useResource<{ items: Wallet[] }>("/wallets/me");
  const approvals = useResource<{ items: PayoutApproval[] }>(
    `/organizations/${organizationId}/payout-approvals`,
  );
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const wallet = wallets.data?.items.find((w) => w.provider === "PRIVY");
  const pending = approvals.data?.items.filter((a) => a.state === "PENDING") ?? [];
  if (approvals.loading || pending.length === 0) return null;
  async function approve(item: PayoutApproval) {
    if (!wallet) {
      setError("Create and verify a reward wallet before you approve a payout.");
      return;
    }
    setBusy(item.id);
    setError("");
    try {
      const { signature } = await signMessage(
        { message: item.message },
        { address: wallet.address },
      );
      await api(`/payout-approvals/${item.id}/sign`, {
        method: "POST",
        body: { walletId: wallet.id, signature },
      });
      approvals.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel">
      <h2>Payouts awaiting quorum</h2>
      <p>
        Findings above the large-payout threshold pause here until two organization members confirm
        with Privy. Triage and severity are already automated; this only confirms the amount before
        funds move.
      </p>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {pending.map((item) => (
        <div className="record" key={item.id}>
          <ShieldCheck size={20} />
          <div>
            <strong>{item.title ?? "Automated finding payout"}</strong>
            <small>{formatMoney(BigInt(item.reward))} test USDC</small>
            <small>
              {item.signatures} of {item.required_approvals} confirmations
            </small>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={busy === item.id}
            onClick={() => void approve(item)}
          >
            {busy === item.id ? "Confirming…" : "Confirm with Privy"}
          </button>
        </div>
      ))}
    </section>
  );
}

const severities = ["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const;

function FindingSubmissionForm({
  programId,
  tierId,
  scopeAddress,
  onClose,
}: {
  programId: string;
  tierId: string;
  scopeAddress: string | null;
  onClose: () => void;
}) {
  const api = useApi();
  const { getAccessToken } = usePrivy();
  const wallets = useResource<{ items: Wallet[] }>("/wallets/me");
  const [title, setTitle] = useState(""),
    [summary, setSummary] = useState(""),
    [affectedComponent, setAffectedComponent] = useState(""),
    [selfAssessedSeverity, setSelfAssessedSeverity] =
      useState<(typeof severities)[number]>("MEDIUM"),
    [writeup, setWriteup] = useState(""),
    [pocCode, setPocCode] = useState(""),
    [forkBlockNumber, setForkBlockNumber] = useState(""),
    [walletId, setWalletId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const available = wallets.data?.items.filter((w) => w.provider === "PRIVY") ?? [];
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const wallet = available.find((w) => w.id === (walletId || available[0]?.id));
      if (!wallet) throw new Error("Create and verify a reward wallet before you submit.");
      const config = await api<{
        findings: {
          evidenceKeyId: string;
          evidencePublicKey: string;
        } | null;
      }>("/verifier-config");
      if (!config.findings) throw new Error("The automated finding verifier is not available.");
      const evidence = {
        schemaVersion: "1" as const,
        pocLanguage: pocCode.trim() ? ("solidity-foundry" as const) : ("none" as const),
        pocCode,
        writeup,
        ...(forkBlockNumber.trim() ? { forkBlockNumber: forkBlockNumber.trim() } : {}),
      };
      const plaintext = new TextEncoder().encode(canonicalJson(evidence));
      let ciphertext: Uint8Array;
      try {
        ciphertext = await seal(plaintext, config.findings.evidencePublicKey);
      } finally {
        plaintext.fill(0);
      }
      const ciphertextHash = keccak256(ciphertext);
      const prepared = await api<{ uploadPath: string; claimId: string }>(
        `/programs/${programId}/findings`,
        {
          method: "POST",
          body: {
            tierId,
            title,
            summary,
            affectedComponent,
            selfAssessedSeverity,
            claimantWalletId: wallet.id,
            keyId: config.findings.evidenceKeyId,
            algorithm: "X25519_SEALED_BOX",
            ciphertextHash,
            byteLength: ciphertext.length,
          },
        },
      );
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to complete this upload.");
      const response = await fetch(prepared.uploadPath, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(ciphertext),
        redirect: "error",
      });
      if (!response.ok) throw new Error("The encrypted upload could not complete.");
      setMessage(
        "Your finding is queued for automated verification. Check My findings for its status.",
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div role="dialog" aria-labelledby="finding-title" className="panel">
      <h3 id="finding-title">Submit an encrypted finding</h3>
      <p>
        Your write-up and proof of concept are encrypted in your browser. The protocol cannot read
        them until an automated verdict qualifies your claim and payment is final.
      </p>
      {scopeAddress ? (
        <p className="notice">
          In-scope contract: <span className="mono break">{scopeAddress}</span>. Your proof of
          concept runs on a live fork of Arc Testnet and must actually interact with this exact
          address — a PoC that only exploits its own mock contracts is rejected automatically.
        </p>
      ) : (
        <p role="alert" className="notice error">
          This slot has no recorded in-scope contract address. Contact the program before submitting
          a proof of concept.
        </p>
      )}
      <form className="form-row" onSubmit={submit}>
        <label>
          Title
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Short summary (visible before payment)
          <input
            required
            maxLength={500}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
          />
        </label>
        <label>
          Affected component
          <input
            required
            placeholder="Contract name or address"
            value={affectedComponent}
            onChange={(e) => setAffectedComponent(e.target.value)}
          />
        </label>
        <label>
          Self-assessed severity
          <select
            value={selfAssessedSeverity}
            onChange={(e) => setSelfAssessedSeverity(e.target.value as (typeof severities)[number])}
          >
            {severities.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {available.length > 0 ? (
          <label>
            Reward wallet
            <select
              value={walletId || available[0].id}
              onChange={(e) => setWalletId(e.target.value)}
            >
              {available.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.address}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p>
            <Link to="/wallet">Create and verify a reward wallet</Link> before you submit.
          </p>
        )}
        <label>
          Detailed write-up (encrypted)
          <textarea
            required
            rows={6}
            value={writeup}
            onChange={(e) => setWriteup(e.target.value)}
            placeholder="Full reproduction steps and impact analysis."
          />
        </label>
        <label>
          Proof of concept (encrypted, optional Foundry test)
          <textarea
            rows={10}
            value={pocCode}
            onChange={(e) => setPocCode(e.target.value)}
            placeholder={`A forge test that calls the in-scope address directly (${scopeAddress ?? "see above"}) on a fork of Arc Testnet. Log the measured impact as: console2.log("PROOFOFHACK_IMPACT_USDC", amount);`}
          />
        </label>
        {pocCode.trim() && (
          <label>
            Fork block number (optional)
            <input
              inputMode="numeric"
              value={forkBlockNumber}
              onChange={(e) => setForkBlockNumber(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Defaults to the current block"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice">
            {message}
          </p>
        )}
        <button
          type="submit"
          className="primary"
          disabled={
            busy || !available.length || !title || !summary || !affectedComponent || !writeup
          }
        >
          {busy ? "Encrypting and submitting…" : "Submit encrypted finding"}
        </button>
        <button type="button" className="text-button" onClick={onClose}>
          Cancel
        </button>
      </form>
    </div>
  );
}
