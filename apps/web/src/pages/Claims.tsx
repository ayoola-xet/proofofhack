import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { keccak256 } from "viem";
import { canonicalJson, seal } from "../../../../packages/crypto-envelope/src/index.ts";
import { fixtureSchema, MAX_EVIDENCE_BYTES } from "../../../../packages/domain/src/index.ts";
import { useApi, useResource, type Wallet } from "../api.ts";

type Fixture = ReturnType<typeof fixtureSchema.parse>;
type Attempt = {
  ciphertext: Uint8Array;
  key: string;
  body: Record<string, unknown>;
  upload?: { uploadPath: string; claimId: string };
};
export function ClaimSubmission({
  bounty,
  onSubmitted,
}: {
  bounty: { bounty_id: string; chain_state: string; policy: Record<string, string> };
  onSubmitted: () => void;
}) {
  const api = useApi(),
    { getAccessToken } = usePrivy();
  const wallets = useResource<{ items: Wallet[] }>("/wallets/me");
  const [cases, setCases] = useState<{ label: string; fixture: Fixture }[]>([]);
  const [selected, setSelected] = useState(0),
    [walletId, setWalletId] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const attempt = useRef<Attempt | null>(null);
  const [prepared, setPrepared] = useState(false);
  const available =
    wallets.data?.items.filter(
      (w) => w.provider === "PRIVY" && w.chain_id === bounty.policy.settlementChainId,
    ) ?? [];
  async function load(file?: File) {
    setError("");
    setCases([]);
    setSelected(0);
    setMessage("");
    if (!file) return;
    try {
      if (file.size > MAX_EVIDENCE_BYTES)
        throw new Error("Use a fixture file smaller than 256 KiB.");
      const input = JSON.parse(await file.text());
      if (Array.isArray(input.fixtures)) {
        if (input.manifest?.root !== bounty.policy.fixtureManifestRoot)
          throw new Error("This case file belongs to another bounty manifest.");
        setCases(
          input.fixtures.map((item: { label: string; fixture: unknown }) => ({
            label: String(item.label),
            fixture: fixtureSchema.parse(item.fixture),
          })),
        );
      } else setCases([{ label: "Selected fixture", fixture: fixtureSchema.parse(input) }]);
    } catch {
      setError("Select the signed synthetic case file for this bounty.");
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      if (!attempt.current) {
        const wallet = available.find((w) => w.id === (walletId || available[0]?.id));
        if (!wallet || !cases[selected])
          throw new Error("Select a fixture case and a verified reward wallet.");
        const config = await api<{
          evidenceKeyId: string;
          evidencePublicKey: string;
          adapterCodeHash: string;
          verifierConfigHash: string;
        }>("/verifier-config");
        if (
          config.adapterCodeHash !== bounty.policy.adapterCodeHash ||
          config.verifierConfigHash !== bounty.policy.verifierConfigHash
        )
          throw new Error("The original verifier version is not available for this bounty.");
        const plaintext = new TextEncoder().encode(canonicalJson(cases[selected].fixture));
        let ciphertext: Uint8Array;
        try {
          ciphertext = await seal(plaintext, config.evidencePublicKey);
        } finally {
          plaintext.fill(0);
        }
        attempt.current = {
          ciphertext,
          key: crypto.randomUUID(),
          body: {
            keyId: config.evidenceKeyId,
            algorithm: "X25519_SEALED_BOX",
            ciphertextHash: keccak256(ciphertext),
            byteLength: ciphertext.length,
            claimantWalletId: wallet.id,
          },
        };
        setPrepared(true);
      }
      const current = attempt.current;
      if (!current.upload)
        current.upload = await api<{ uploadPath: string; claimId: string }>(
          `/bounties/${bounty.bounty_id}/uploads`,
          {
            method: "POST",
            body: current.body,
            key: current.key,
          },
        );
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to complete this upload.");
      const response = await fetch(current.upload.uploadPath, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(current.ciphertext),
        redirect: "error",
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error?.message ?? "The encrypted upload cannot complete now.");
      setMessage("Your encrypted case is queued. Check My claims for its assessment and payment.");
      current.ciphertext.fill(0);
      attempt.current = null;
      setPrepared(false);
      onSubmitted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (bounty.chain_state !== "FUNDED" && !prepared) return null;
  return (
    <div className="claim-form">
      <p>
        The file is encrypted in your browser before upload. This test uses synthetic accounting
        cases.
      </p>
      <label>
        Signed case file
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy || prepared}
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </label>
      {cases.length > 0 && (
        <label>
          Case
          <select
            value={selected}
            disabled={busy || prepared}
            onChange={(e) => setSelected(Number(e.target.value))}
          >
            {cases.map((item, i) => (
              <option key={item.fixture.caseId} value={i}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {available.length > 0 ? (
        <label>
          Reward wallet
          <select
            value={walletId || available[0].id}
            disabled={busy || prepared}
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
      {(error || wallets.error) && (
        <p role="alert" className="notice error">
          {error || wallets.error}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <button
        type="button"
        className="primary"
        disabled={busy || (!prepared && (!cases.length || !available.length))}
        onClick={() => void submit()}
      >
        {busy
          ? "Sending encrypted case…"
          : prepared
            ? "Retry saved upload"
            : "Submit encrypted case"}
      </button>
    </div>
  );
}
export function ReportDownload({ id, mode }: { id: string; mode: "researcher" | "organization" }) {
  const { getAccessToken } = usePrivy();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in to download the report.");
      const response = await fetch(`/private/${mode}/reports/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        redirect: "error",
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "The report is not available.");
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement("a");
      link.href = url;
      link.download = `vulnproof-report-${id}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      <button type="button" className="secondary" disabled={busy} onClick={() => void download()}>
        {busy ? "Opening report…" : "Download report"}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
export function MyClaims() {
  const claims = useResource<{
    items: {
      claim_id: string;
      job_state: string;
      outcome: string | null;
      report_id: string | null;
      chain_state: string;
    }[];
  }>("/claims/me");
  useEffect(() => {
    const timer = setInterval(claims.refresh, 10000);
    return () => clearInterval(timer);
  }, [claims.refresh]);
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>My claims</h2>
        <button type="button" className="secondary" onClick={claims.refresh}>
          Refresh claims
        </button>
      </div>
      {claims.error && <p role="alert">{claims.error}</p>}
      {claims.data?.items.length === 0 && <p>Your submitted cases appear here.</p>}
      {claims.data?.items.map((claim) => (
        <div className="record" key={claim.claim_id}>
          <div>
            <strong>
              {claim.outcome === "QUALIFIES"
                ? "Qualifying case"
                : claim.outcome === "DOES_NOT_QUALIFY"
                  ? "Below the reward threshold"
                  : "Fixture assessment"}
            </strong>
            <small className="mono">{claim.claim_id.slice(0, 14)}…</small>
            <small>{claim.job_state.replaceAll("_", " ")}</small>
          </div>
          {claim.report_id && <ReportDownload id={claim.report_id} mode="researcher" />}
        </div>
      ))}
    </section>
  );
}
