import { useSignMessage } from "@privy-io/react-auth";
import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  type BountyPolicy,
  formatMoney,
  parseMoney,
} from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource, type Wallet } from "../api.ts";
import type { BudgetController } from "./Budget.tsx";

const FUNDING_STEPS = ["Draft", "Approved", "Funding", "Funded"] as const;

function fundingStage(draft: Draft, request: Funding | undefined, usesBudget: boolean) {
  if (draft.creation_tx || draft.chain_state === "FUNDED")
    return { step: 3, failed: false, label: "Funded. The bounty is live on Arc Testnet." };
  if (request?.failure_code && ["QUEUED", "APPROVING", "FUNDING"].includes(request.state))
    return {
      step: 2,
      failed: true,
      label: `Funding failed: ${request.failure_code.replaceAll("_", " ").toLowerCase()}.`,
    };
  if (request && !["CANCELLED", "EXPIRED"].includes(request.state))
    return {
      step: 2,
      failed: false,
      label:
        request.state === "AWAITING_AUTHORIZATION"
          ? "Waiting for your Privy confirmation."
          : "Sending the funding transaction to Arc Testnet…",
    };
  if (draft.status === "APPROVED")
    return {
      step: 1,
      failed: false,
      label: usesBudget
        ? "Approved. Waiting on the coverage budget to allocate this reward."
        : "Approved. Ready to fund.",
    };
  return { step: 0, failed: false, label: "Waiting on the owner to approve these exact terms." };
}
function Stepper({ stage }: { stage: ReturnType<typeof fundingStage> }) {
  return (
    <div className="stepper">
      {FUNDING_STEPS.map((label, i) => {
        const done = i < stage.step || stage.step === 3;
        const active = i === stage.step && stage.step !== 3;
        const failed = active && stage.failed;
        return (
          <div key={label} style={{ display: "contents" }}>
            <span
              className={`stepper-step${done ? " done" : ""}${active && !failed ? " active" : ""}${failed ? " failed" : ""}`}
            >
              {done && <Check size={12} />}
              {failed && <AlertTriangle size={12} />}
              {active && !failed && <Loader2 className="spin" size={12} />}
              {label}
            </span>
            {i < FUNDING_STEPS.length - 1 && <span className="stepper-line" />}
          </div>
        );
      })}
    </div>
  );
}

type Draft = {
  id: string;
  policy: BountyPolicy;
  policy_hash: string;
  status: string;
  version: number;
  chain_state: string | null;
  creation_tx: string | null;
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
  const drafts = useResource<{ items: Draft[] }>(`${base}/bounty-drafts`, { intervalMs: 5000 });
  const controllers = useResource<{ items: BudgetController[] }>(`${base}/controllers`);
  const [controllerId, setControllerId] = useState("");
  const funding = useResource<{ items: Funding[] }>(`${base}/funding-requests`, {
    intervalMs: 5000,
  });
  const programs = useResource<{ items: { id: string; name: string; kind: string }[] }>(
    `${base}/programs`,
  );
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
  const [submissionWindow, setSubmissionWindow] = useState("259200");
  const [reservationDuration, setReservationDuration] = useState("1800");
  const [settlementGrace, setSettlementGrace] = useState("3600");
  const [draftCreated, setDraftCreated] = useState(false);
  const [confirm, setConfirm] = useState<{ funding: Funding; wallet: Wallet } | null>(null);
  const [fProgram, setFProgram] = useState(""),
    [fTier, setFTier] = useState(""),
    [fScopeAddress, setFScopeAddress] = useState(""),
    [fControllerId, setFControllerId] = useState(""),
    [fSubmissionWindow, setFSubmissionWindow] = useState("259200"),
    [fReservationDuration, setFReservationDuration] = useState("1800"),
    [fSettlementGrace, setFSettlementGrace] = useState("3600");
  const findingsPrograms = programs.data?.items.filter((p) => p.kind === "FINDINGS") ?? [];
  const findingsProgramId = fProgram || findingsPrograms[0]?.id || "";
  const findingsProgramDetail = useResource<{
    tiers: { id: string; name: string; min_reward: string; max_reward: string }[];
  }>(findingsProgramId ? `/programs/${findingsProgramId}` : null);
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
      const draftDeadline = prepared
        ? deadline
        : String(Math.floor(Date.now() / 1000) + Number(submissionWindow));
      setDeadline(draftDeadline);
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
          submissionDeadline: draftDeadline,
          reservationDurationSeconds: Number(reservationDuration),
          settlementGraceSeconds: Number(settlementGrace),
        },
      });
      setDraftCreated(true);
      drafts.refresh();
      setNotice(
        "Draft created. Download the synthetic cases, then review and approve the fixed terms.",
      );
    });
  }
  async function prepareFindings(event: FormEvent) {
    event.preventDefault();
    await run("Prepare findings draft", async () => {
      if (!wallet || !bank?.id)
        throw new Error(
          "Create and verify your reward wallet and organization funding wallet first.",
        );
      const programId = findingsProgramId;
      const tierId = fTier || findingsProgramDetail.data?.tiers[0]?.id;
      if (!programId || !tierId)
        throw new Error("Create a findings program and add a severity tier first.");
      if (!/^0x[0-9a-fA-F]{40}$/.test(fScopeAddress))
        throw new Error("Use a full contract address for the in-scope target.");
      const draftDeadline = String(Math.floor(Date.now() / 1000) + Number(fSubmissionWindow));
      await api(`${base}/report-key`, { method: "POST", key: `${key}:findings-report`, body: {} });
      await api(`/programs/${programId}/bounty-drafts`, {
        method: "POST",
        key: `${key}:findings-draft`,
        body: {
          tierId,
          scopeAddress: fScopeAddress,
          ...(fControllerId ? { controllerId: fControllerId } : { refundWalletId: bank.id }),
          submissionDeadline: draftDeadline,
          reservationDurationSeconds: Number(fReservationDuration),
          settlementGraceSeconds: Number(fSettlementGrace),
        },
      });
      setFScopeAddress("");
      setKey(crypto.randomUUID());
      drafts.refresh();
      setNotice("Findings draft created. Review and approve the fixed terms below to fund it.");
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
    link.download = `proofofhack-synthetic-cases-${prepared.id}.json`;
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
          title="Refresh now"
          aria-label="Refresh now"
          onClick={() => {
            drafts.refresh();
            funding.refresh();
            onFunded();
          }}
        >
          <RefreshCw size={14} />
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
              value={program || programs.data?.items.find((p) => p.kind !== "FINDINGS")?.id || ""}
              onChange={(e) => setProgram(e.target.value)}
              disabled={!!prepared || !!busy}
            >
              {programs.data?.items
                .filter((p) => p.kind !== "FINDINGS")
                .map((p) => (
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
          <label>
            Submission window
            <select
              value={submissionWindow}
              onChange={(e) => setSubmissionWindow(e.target.value)}
              disabled={!!prepared || !!busy}
            >
              <option value="600">10 minutes</option>
              <option value="3600">One hour</option>
              <option value="259200">Three days</option>
            </select>
          </label>
          <label>
            Reservation length
            <select
              value={reservationDuration}
              onChange={(e) => setReservationDuration(e.target.value)}
              disabled={!!prepared || !!busy}
            >
              <option value="60">One minute</option>
              <option value="300">Five minutes</option>
              <option value="1800">30 minutes</option>
            </select>
          </label>
          <label>
            Extra time before refund
            <select
              value={settlementGrace}
              onChange={(e) => setSettlementGrace(e.target.value)}
              disabled={!!prepared || !!busy}
            >
              <option value="0">None</option>
              <option value="3600">One hour</option>
            </select>
          </label>
          <button
            className="primary"
            type="submit"
            disabled={!!busy || !bank || !wallet || draftCreated}
          >
            {busy === "Prepare draft" ? (
              <>
                <Loader2 className="spin" size={14} /> Preparing…
              </>
            ) : draftCreated ? (
              "Draft created"
            ) : prepared ? (
              "Resume draft setup"
            ) : (
              "Create signed fixture draft"
            )}
          </button>
        </form>
      )}
      {prepared && (
        <button type="button" className="secondary" onClick={download}>
          Download synthetic cases
        </button>
      )}
      {organization.role === "OWNER" && findingsPrograms.length > 0 && (
        <>
          <h3>Fund a findings bounty</h3>
          <p>
            Creates one bounty slot against a severity tier. The reward pays out automatically
            within the tier's range once a submission is auto-verified. No fixture manifest is
            needed.
          </p>
          <form className="form-row" onSubmit={prepareFindings}>
            <label>
              Program
              <select
                value={findingsProgramId}
                onChange={(e) => {
                  setFProgram(e.target.value);
                  setFTier("");
                }}
                disabled={!!busy}
              >
                {findingsPrograms.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity tier
              <select
                value={fTier || findingsProgramDetail.data?.tiers[0]?.id || ""}
                onChange={(e) => setFTier(e.target.value)}
                disabled={!!busy}
              >
                {findingsProgramDetail.data?.tiers.map((tier) => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name} ({formatMoney(BigInt(tier.min_reward))}-
                    {formatMoney(BigInt(tier.max_reward))} test USDC)
                  </option>
                ))}
              </select>
            </label>
            {findingsProgramDetail.data?.tiers.length === 0 && (
              <p className="muted">
                This program has no severity tiers yet. Add one on the Team page first.
              </p>
            )}
            <label>
              In-scope contract address
              <input
                required
                value={fScopeAddress}
                onChange={(e) => setFScopeAddress(e.target.value)}
                placeholder="0x…"
                disabled={!!busy}
              />
            </label>
            <label>
              Funding source and refund destination
              <select
                value={fControllerId}
                onChange={(event) => setFControllerId(event.target.value)}
                disabled={!!busy}
              >
                <option value="">Organization wallet</option>
                {controllers.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    Coverage budget {c.enabled ? "(enabled)" : "(disabled)"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Submission window
              <select
                value={fSubmissionWindow}
                onChange={(e) => setFSubmissionWindow(e.target.value)}
                disabled={!!busy}
              >
                <option value="600">10 minutes</option>
                <option value="3600">One hour</option>
                <option value="259200">Three days</option>
                <option value="2592000">30 days</option>
              </select>
            </label>
            <label>
              Reservation length
              <select
                value={fReservationDuration}
                onChange={(e) => setFReservationDuration(e.target.value)}
                disabled={!!busy}
              >
                <option value="60">One minute</option>
                <option value="300">Five minutes</option>
                <option value="1800">30 minutes</option>
              </select>
            </label>
            <label>
              Extra time before refund
              <select
                value={fSettlementGrace}
                onChange={(e) => setFSettlementGrace(e.target.value)}
                disabled={!!busy}
              >
                <option value="0">None</option>
                <option value="3600">One hour</option>
              </select>
            </label>
            <button
              className="primary"
              type="submit"
              disabled={!!busy || !bank || !wallet || !findingsProgramDetail.data?.tiers.length}
            >
              {busy === "Prepare findings draft" ? (
                <>
                  <Loader2 className="spin" size={14} /> Preparing…
                </>
              ) : (
                "Create findings draft"
              )}
            </button>
          </form>
        </>
      )}
      <p>
        The submission window starts when you prepare the draft. The refund cutoff adds one
        reservation length and the selected extra time. A short reservation leaves less time for
        network delays. The discrepancy threshold is 1,000,000 fixture units.
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
        const usesBudget = controllers.data?.items.some(
          (c) => c.address === draft.policy.refundRecipient,
        );
        const request = funding.data?.items.find(
          (f) => f.draft_id === draft.id && !["CANCELLED", "EXPIRED"].includes(f.state),
        );
        const stage = fundingStage(draft, request, !!usesBudget);
        return (
          <article className="wallet-card" key={draft.id}>
            <div>
              <h3>{formatMoney(BigInt(draft.policy.reward))} test USDC</h3>
              <Stepper stage={stage} />
              <p className={stage.failed ? "notice error" : "muted"}>{stage.label}</p>
              {draft.creation_tx && (
                <p>
                  <a
                    href={`https://testnet.arcscan.app/tx/${draft.creation_tx}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View final funding transaction
                  </a>
                </p>
              )}
              <p className="mono break">{draft.policy_hash}</p>
              <dl>
                <dt>Refund destination</dt>
                <dd className="mono break">{draft.policy.refundRecipient}</dd>
                <dt>Submission deadline</dt>
                <dd>{new Date(Number(draft.policy.submissionDeadline) * 1000).toLocaleString()}</dd>
                <dt>Refund cutoff</dt>
                <dd>{new Date(Number(draft.policy.settlementDeadline) * 1000).toLocaleString()}</dd>
                <dt>Reservation length</dt>
                <dd>
                  {Number(draft.policy.reservationDurationSeconds) / 60}{" "}
                  {draft.policy.reservationDurationSeconds === "60" ? "minute" : "minutes"}
                </dd>
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
                  {busy === "Approve terms" ? (
                    <>
                      <Loader2 className="spin" size={14} /> Approving…
                    </>
                  ) : (
                    "Approve these exact terms"
                  )}
                </button>
              )}
              {draft.status === "APPROVED" &&
                draft.policy.refundRecipient === bank?.address &&
                !draft.creation_tx &&
                !request &&
                ["OWNER", "TREASURY"].includes(organization.role) && (
                  <button
                    className="primary"
                    type="button"
                    disabled={!!busy || !bank || !wallet}
                    onClick={() => void requestFunding(draft)}
                  >
                    {busy === "Prepare funding" ? (
                      <>
                        <Loader2 className="spin" size={14} /> Preparing…
                      </>
                    ) : (
                      "Review funding confirmation"
                    )}
                  </button>
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
                    {busy === "Retry funding" ? (
                      <>
                        <Loader2 className="spin" size={14} /> Retrying…
                      </>
                    ) : (
                      "Retry the saved funding request"
                    )}
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
            {busy === "Confirm funding" ? (
              <>
                <Loader2 className="spin" size={14} /> Confirming…
              </>
            ) : (
              "Confirm with Privy"
            )}
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
