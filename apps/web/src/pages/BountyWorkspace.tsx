import { useSignMessage } from "@privy-io/react-auth";
import { type FormEvent, useState } from "react";
import {
  type BountyPolicy,
  formatMoney,
  parseMoney,
} from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource, type Wallet } from "../api.ts";
import type { BudgetController } from "./Budget.tsx";

type Draft = {
  id: string;
  policy: BountyPolicy;
  policy_hash: string;
  status: string;
  version: number;
};
type Funding = {
  id: string;
  draft_id: string;
  state: string;
  failure_code: string | null;
  authorization_message: string;
  version: number;
  requested_by: string;
  approval_hash: string | null;
  funding_hash: string | null;
};
type Treasury = {
  id: string | null;
  address: string | null;
  state: string;
  max_per_action: string;
};
type Prepared = {
  id: string;
  message: string;
  version: number;
  fixtures: unknown[];
  manifest: { root: string };
  signature?: string;
};
export function BountyWorkspace({
  organization,
  actorId,
  onFunded,
}: {
  organization: Membership;
  actorId: string;
  onFunded: () => void;
}) {
  const api = useApi(),
    base = `/organizations/${organization.organization_id}`;
  const { signMessage } = useSignMessage();
  const drafts = useResource<{ items: Draft[] }>(`${base}/bounty-drafts`);
  const controllers = useResource<{ items: BudgetController[] }>(`${base}/controllers`);
  const [controllerId, setControllerId] = useState("");
  const funding = useResource<{ items: Funding[] }>(`${base}/funding-requests`);
  const programs = useResource<{ items: { id: string; name: string }[] }>(`${base}/programs`);
  const vaults = useResource<{ items: { id: string; label: string }[] }>(`${base}/coverage`);
  const wallets = useResource<{ items: Wallet[] }>("/wallets/me");
  const treasury = useResource<{ items: Treasury[] }>(
    ["OWNER", "TREASURY"].includes(organization.role) ? `${base}/wallets` : null,
  );
  const [program, setProgram] = useState(""),
    [vault, setVault] = useState(""),
    [reward, setReward] = useState("1");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [deadline, setDeadline] = useState(() => String(Math.floor(Date.now() / 1000) + 259200));
  const [draftCreated, setDraftCreated] = useState(false);
  const [confirm, setConfirm] = useState<{ funding: Funding; wallet: Wallet } | null>(null);
  const wallet = wallets.data?.items.find(
    (w) => w.provider === "PRIVY" && w.chain_id === "5042002",
  );
  const bank = treasury.data?.items.find((w) => w.state === "READY" && w.id && w.address);
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function prepare(event: FormEvent) {
    event.preventDefault();
    await run("Prepare draft", async () => {
      if (!wallet || !bank?.id)
        throw new Error(
          "Create and verify your reward wallet and organization funding wallet first.",
        );
      const programId = program || programs.data?.items[0]?.id,
        vaultId = vault || vaults.data?.items[0]?.id;
      if (!programId || !vaultId)
        throw new Error("Create a program and register a source vault first.");
      await api(`${base}/report-key`, { method: "POST", key: `${key}:report`, body: {} });
      const item =
        prepared ??
        (await api<Prepared>(`${base}/fixture-manifests/prepare`, {
          method: "POST",
          key: `${key}:manifest`,
          body: { vaultId, signingWalletId: wallet.id },
        }));
      setPrepared(item);
      const signature =
        item.signature ??
        (await signMessage({ message: item.message }, { address: wallet.address })).signature;
      setPrepared({ ...item, signature });
      await api(`/fixture-manifests/${item.id}/sign`, {
        method: "POST",
        key: `${key}:signature`,
        version: item.version,
        body: { signature },
      });
      await api(`/programs/${programId}/bounty-drafts`, {
        method: "POST",
        key: `${key}:draft`,
        body: {
          manifestId: item.id,
          ...(controllerId ? { controllerId } : { refundWalletId: bank.id }),
          reward: parseMoney(reward).toString(),
          minimumDiscrepancy: "1000000",
          submissionDeadline: deadline,
          reservationDurationSeconds: 1800,
        },
      });
      setDraftCreated(true);
      drafts.refresh();
      setNotice(
        "Draft created. Download the synthetic cases, then review and approve the fixed terms.",
      );
    });
  }
  function download() {
    if (!prepared) return;
    const blob = new Blob(
      [JSON.stringify({ manifest: prepared.manifest, fixtures: prepared.fixtures }, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `vulnproof-synthetic-cases-${prepared.id}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function requestFunding(draft: Draft) {
    await run("Prepare funding", async () => {
      if (!bank?.id || !wallet) throw new Error("Verify both wallets before funding.");
      const item = await api<Funding>(`/bounty-drafts/${draft.id}/funding-requests`, {
        method: "POST",
        body: {
          policyHash: draft.policy_hash,
          walletId: bank.id,
          authorizationWalletId: wallet.id,
        },
      });
      setConfirm({ funding: item, wallet });
      funding.refresh();
    });
  }
  async function authorize() {
    if (!confirm) return;
    await run("Confirm funding", async () => {
      let signature: string;
      try {
        signature = (
          await signMessage(
            { message: confirm.funding.authorization_message },
            { address: confirm.wallet.address },
          )
        ).signature;
      } catch (e) {
        await api(`/funding-requests/${confirm.funding.id}/cancel`, { method: "POST", body: {} });
        setConfirm(null);
        funding.refresh();
        throw e;
      }
      await api(`/funding-requests/${confirm.funding.id}/authorize`, {
        method: "POST",
        version: confirm.funding.version,
        body: { signature },
      });
      setConfirm(null);
      funding.refresh();
      setNotice("Funding is queued. Refresh to check its final receipt.");
    });
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Prepare and fund a bounty</h2>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            drafts.refresh();
            funding.refresh();
            onFunded();
          }}
        >
          Refresh funding
        </button>
      </div>
      <p>
        Each bounty uses three synthetic accounting cases. Live vault data supplies context. It does
        not prove a vulnerability.
      </p>
      {(error ||
        drafts.error ||
        funding.error ||
        programs.error ||
        vaults.error ||
        wallets.error ||
        treasury.error ||
        controllers.error) && (
        <p role="alert" className="notice">
          {error ||
            drafts.error ||
            funding.error ||
            programs.error ||
            vaults.error ||
            wallets.error ||
            treasury.error ||
            controllers.error}
        </p>
      )}
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {organization.role === "OWNER" && (
        <form className="form-row" onSubmit={prepare}>
          <label>
            Program
            <select
              value={program || programs.data?.items[0]?.id || ""}
              onChange={(e) => setProgram(e.target.value)}
              disabled={!!prepared || !!busy}
            >
              {programs.data?.items.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Source vault
            <select
              value={vault || vaults.data?.items[0]?.id || ""}
              onChange={(e) => setVault(e.target.value)}
              disabled={!!prepared || !!busy}
            >
              {vaults.data?.items.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Reward (test USDC)
            <input
              inputMode="decimal"
              required
              value={reward}
              onChange={(e) => setReward(e.target.value)}
              disabled={!!prepared || !!busy}
            />
          </label>
          <label>
            Funding source and refund destination
            <select
              value={controllerId}
              onChange={(event) => setControllerId(event.target.value)}
              disabled={!!prepared || !!busy}
            >
              <option value="">Organization wallet</option>
              {controllers.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  Coverage budget {c.enabled ? "(enabled)" : "(disabled)"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary"
            type="submit"
            disabled={!!busy || !bank || !wallet || draftCreated}
          >
            {busy === "Prepare draft"
              ? "Preparing…"
              : draftCreated
                ? "Draft created"
                : prepared
                  ? "Resume draft setup"
                  : "Create signed fixture draft"}
          </button>
        </form>
      )}
      {prepared && (
        <button type="button" className="secondary" onClick={download}>
          Download synthetic cases
        </button>
      )}
      <p>
        Submissions stay open for three days. The discrepancy threshold is 1,000,000 fixture units.
        Each reservation lasts 30 minutes.
      </p>
      {draftCreated && (
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setPrepared(null);
            setDraftCreated(false);
            setKey(crypto.randomUUID());
            setDeadline(String(Math.floor(Date.now() / 1000) + 259200));
          }}
        >
          Create another draft
        </button>
      )}
      {drafts.data?.items.map((draft) => {
        const request = funding.data?.items.find(
          (f) => f.draft_id === draft.id && !["CANCELLED", "EXPIRED"].includes(f.state),
        );
        return (
          <article className="wallet-card" key={draft.id}>
            <div>
              <h3>{formatMoney(BigInt(draft.policy.reward))} test USDC</h3>
              <p>
                {draft.status} · {request?.state ?? "No funding request"}
              </p>
              <p className="mono break">{draft.policy_hash}</p>
              <dl>
                <dt>Refund destination</dt>
                <dd className="mono break">{draft.policy.refundRecipient}</dd>
                <dt>Submission deadline</dt>
                <dd>{new Date(Number(draft.policy.submissionDeadline) * 1000).toLocaleString()}</dd>
                <dt>Network</dt>
                <dd>Arc Testnet</dd>
              </dl>
              <details>
                <summary>Review all fixed terms</summary>
                <pre className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {JSON.stringify(draft.policy, null, 2)}
                </pre>
              </details>
              {draft.status === "DRAFT" && organization.role === "OWNER" && (
                <button
                  className="secondary"
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    void run("Approve terms", async () => {
                      await api(`/bounty-drafts/${draft.id}/approve`, {
                        method: "POST",
                        version: draft.version,
                        body: { policyHash: draft.policy_hash },
                      });
                      drafts.refresh();
                    })
                  }
                >
                  Approve these exact terms
                </button>
              )}
              {draft.status === "APPROVED" &&
                draft.policy.refundRecipient === bank?.address &&
                !request &&
                ["OWNER", "TREASURY"].includes(organization.role) && (
                  <button
                    className="primary"
                    type="button"
                    disabled={!!busy || !bank || !wallet}
                    onClick={() => void requestFunding(draft)}
                  >
                    Review funding confirmation
                  </button>
                )}
              {controllers.data?.items.some((c) => c.address === draft.policy.refundRecipient) && (
                <p>
                  This draft uses the coverage budget. Check its owner approval and limits in
                  organization settings.
                </p>
              )}
              {request?.state === "AWAITING_AUTHORIZATION" &&
                request.requested_by === actorId &&
                wallet && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => setConfirm({ funding: request, wallet })}
                  >
                    Open funding confirmation
                  </button>
                )}
              {request?.failure_code && (
                <p role="alert">
                  Funding needs attention: {request.failure_code.replaceAll("_", " ")}. Refresh
                  after you resolve the issue.
                </p>
              )}
              {request?.failure_code &&
                ["QUEUED", "APPROVING", "FUNDING"].includes(request.state) &&
                request.requested_by === actorId && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void run("Retry funding", async () => {
                        await api(`/funding-requests/${request.id}/retry`, {
                          method: "POST",
                          body: {},
                        });
                        funding.refresh();
                      })
                    }
                  >
                    Retry the saved funding request
                  </button>
                )}
              {request?.funding_hash && (
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`https://testnet.arcscan.app/tx/${request.funding_hash}`}
                >
                  View funding transaction
                </a>
              )}
            </div>
          </article>
        );
      })}
      {confirm && (
        <div role="dialog" aria-labelledby="funding-title" className="panel">
          <h3 id="funding-title">Confirm the fixed bounty funding</h3>
          <p>
            Make sure the organization wallet holds the reward plus at least 0.1 test USDC for fees.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {confirm.funding.authorization_message}
          </pre>
          <button
            className="primary"
            type="button"
            disabled={!!busy}
            onClick={() => void authorize()}
          >
            Confirm with Privy
          </button>
          <button
            className="secondary"
            type="button"
            disabled={!!busy}
            onClick={() =>
              void run("Cancel", async () => {
                await api(`/funding-requests/${confirm.funding.id}/cancel`, {
                  method: "POST",
                  body: {},
                });
                setConfirm(null);
                funding.refresh();
              })
            }
          >
            Cancel funding
          </button>
        </div>
      )}
    </section>
  );
}
