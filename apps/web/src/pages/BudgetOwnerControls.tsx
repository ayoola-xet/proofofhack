import { useSignMessage } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import {
  type OwnerCommand,
  ownerCommandDescription,
} from "../../../../packages/chain/src/owner-command.ts";
import { parseMoney } from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource, type Wallet } from "../api.ts";
import type { BudgetController } from "./Budget.tsx";

type Request = {
  id: string;
  requested_by: string;
  authorization_wallet_id: string;
  command_json: OwnerCommand;
  authorization_message: string;
  authorization_expires_at: string;
  state: string;
  failure_code?: string | null;
  transaction_hash?: string | null;
  tx_intent_id?: string | null;
  permission_pending?: boolean;
  version: number;
};
export type BudgetDraft = {
  id: string;
  status: string;
  policy_hash: string;
  policy: { refundRecipient: string; reward: string; submissionDeadline: string };
};
const terminal = new Set(["COMPLETE", "FAILED", "CANCELLED", "EXPIRED"]);
export function BudgetOwnerControls({
  controller,
  organization,
  actorId,
  drafts,
}: {
  controller: BudgetController;
  organization: Membership;
  actorId?: string;
  drafts: BudgetDraft[];
}) {
  const api = useApi(),
    { signMessage } = useSignMessage();
  const requests = useResource<{ items: Request[] }>(
    `/controllers/${controller.id}/owner-requests`,
  );
  const wallets = useResource<{ items: Wallet[] }>(
    organization.role === "OWNER" ? "/wallets/me" : null,
  );
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<Request | null>(null);
  const [perAction, setPerAction] = useState("1"),
    [daily, setDaily] = useState("5"),
    [interval, setInterval] = useState("60"),
    [amount, setAmount] = useState("1"),
    [draftId, setDraftId] = useState("");
  const [approvalHours, setApprovalHours] = useState("24");
  const wallet = wallets.data?.items.find(
    (w) => w.provider === "PRIVY" && w.chain_id === "5042002",
  );
  const active = requests.data?.items.find(
    (r) =>
      !terminal.has(r.state) &&
      !(
        r.state === "AWAITING_AUTHORIZATION" && Date.parse(r.authorization_expires_at) <= Date.now()
      ),
  );
  const pending = active && active.state !== "AWAITING_AUTHORIZATION";
  const disabled = !!busy || !!active || requests.loading || !requests.data || !wallet;
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(requests.refresh, 5000);
    return () => window.clearInterval(timer);
  }, [pending, requests.refresh]);
  async function run(label: string, operation: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      requests.refresh();
    }
  }
  async function prepare(command: OwnerCommand) {
    if (!wallet) throw new Error("Verify your Privy wallet on the Wallet page first.");
    const request = await api<Request>(`/controllers/${controller.id}/owner-requests`, {
      method: "POST",
      body: { command, authorizationWalletId: wallet.id },
    });
    setConfirm(request);
  }
  async function authorize() {
    if (!confirm) return;
    const signingWallet = wallets.data?.items.find((w) => w.id === confirm.authorization_wallet_id);
    if (!signingWallet)
      throw new Error("The confirming wallet is no longer available. Refresh your wallets.");
    const { signature } = await signMessage(
      { message: confirm.authorization_message },
      { address: signingWallet.address },
    );
    await api(`/owner-requests/${confirm.id}/authorize`, {
      method: "POST",
      version: confirm.version,
      body: { signature },
    });
    setConfirm(null);
    setNotice("The owner action is queued. Its final receipt appears below.");
  }
  const eligibleDrafts = drafts.filter(
    (d) =>
      d.status === "APPROVED" &&
      d.policy.refundRecipient === controller.address &&
      Number(d.policy.submissionDeadline) > Date.now() / 1000 + 120,
  );
  return (
    <section>
      <div className="section-heading">
        <h3>Owner controls</h3>
        <button type="button" className="text-button" onClick={requests.refresh}>
          Refresh owner actions
        </button>
      </div>
      <p>
        Each action requires the requesting owner's Privy wallet confirmation. The worker removes
        its temporary signing permission before broadcast.
      </p>
      {(error || requests.error || wallets.error) && (
        <p className="notice" role="alert">
          {error || requests.error || wallets.error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {organization.role === "OWNER" && actorId && (
        <>
          {!wallet && (
            <p>Verify your Privy wallet on the Wallet page before you use these controls.</p>
          )}
          {active && (
            <p>Complete or cancel the current owner request before preparing another action.</p>
          )}
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run("Prepare limits", () =>
                prepare({
                  kind: "SET_LIMITS",
                  perAction: parseMoney(perAction).toString(),
                  daily: parseMoney(daily).toString(),
                  interval: Number(interval),
                }),
              );
            }}
          >
            <label>
              Per allocation (test USDC)
              <input
                required
                inputMode="decimal"
                value={perAction}
                disabled={disabled}
                onChange={(e) => setPerAction(e.target.value)}
              />
            </label>
            <label>
              Per UTC day (test USDC)
              <input
                required
                inputMode="decimal"
                value={daily}
                disabled={disabled}
                onChange={(e) => setDaily(e.target.value)}
              />
            </label>
            <label>
              Minimum interval (seconds)
              <input
                required
                type="number"
                min="60"
                max="86400"
                value={interval}
                disabled={disabled}
                onChange={(e) => setInterval(e.target.value)}
              />
            </label>
            <button type="submit" className="secondary" disabled={disabled}>
              Review limits
            </button>
          </form>
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run("Prepare deposit", () =>
                prepare({ kind: "DEPOSIT", amount: parseMoney(amount).toString() }),
              );
            }}
          >
            <label>
              Amount (test USDC)
              <input
                required
                inputMode="decimal"
                value={amount}
                disabled={disabled}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <button type="submit" className="secondary" disabled={disabled}>
              Review deposit
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() =>
                void run("Prepare withdrawal", () =>
                  prepare({ kind: "WITHDRAW", amount: parseMoney(amount).toString() }),
                )
              }
            >
              Review return to owner wallet
            </button>
          </form>
          <form
            className="form-row"
            onSubmit={(e) => {
              e.preventDefault();
              void run("Prepare policy approval", async () => {
                const draft = eligibleDrafts.find(
                  (d) => d.id === (draftId || eligibleDrafts[0]?.id),
                );
                if (!draft) throw new Error("Create and approve a current budget draft first.");
                await prepare({
                  kind: "APPROVE_POLICY",
                  draftId: draft.id,
                  policyHash: draft.policy_hash as `0x${string}`,
                  reward: draft.policy.reward,
                  expiresAt: String(
                    Math.min(
                      Math.floor(Date.now() / 1000) + Number(approvalHours) * 3600,
                      Number(draft.policy.submissionDeadline),
                    ),
                  ),
                });
              });
            }}
          >
            <label>
              Approved budget draft
              <select
                value={draftId || eligibleDrafts[0]?.id || ""}
                disabled={disabled}
                onChange={(e) => setDraftId(e.target.value)}
              >
                {eligibleDrafts.length === 0 && <option value="">No current budget drafts</option>}
                {eligibleDrafts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.policy_hash.slice(0, 18)}…
                  </option>
                ))}
              </select>
            </label>
            <label>
              Approval duration
              <select
                value={approvalHours}
                disabled={disabled}
                onChange={(e) => setApprovalHours(e.target.value)}
              >
                <option value="1">One hour</option>
                <option value="24">One day</option>
                <option value="72">Three days</option>
              </select>
            </label>
            <button
              type="submit"
              className="secondary"
              disabled={disabled || eligibleDrafts.length === 0}
            >
              Review exact policy approval
            </button>
          </form>
          <p>Approval ends at the selected time or the bounty deadline, whichever comes first.</p>
          <div className="form-row">
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() =>
                void run("Prepare enablement", () =>
                  prepare({ kind: "SET_ENABLED", enabled: true }),
                )
              }
            >
              Review enablement
            </button>
            <button
              type="button"
              className="secondary"
              disabled={disabled}
              onClick={() =>
                void run("Prepare disablement", () =>
                  prepare({ kind: "SET_ENABLED", enabled: false }),
                )
              }
            >
              Review disablement
            </button>
          </div>
          <p>
            Disablement stops new allocations after its transaction confirms. A pending allocation
            can still complete.
          </p>
        </>
      )}
      {confirm && (
        <div className="notice">
          <h3>Confirm one owner action</h3>
          <p>{ownerCommandDescription(confirm.command_json)}</p>
          <p>
            Maximum network fee: 0.05 test USDC. Confirmation expires{" "}
            {new Date(confirm.authorization_expires_at).toLocaleString()}.
          </p>
          <details>
            <summary>Read the complete wallet confirmation</summary>
            <pre className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
              {confirm.authorization_message}
            </pre>
          </details>
          <button
            type="button"
            className="primary"
            disabled={!!busy || Date.parse(confirm.authorization_expires_at) <= Date.now()}
            onClick={() => void run("Confirm owner action", authorize)}
          >
            {busy === "Confirm owner action" ? "Waiting for wallet…" : "Confirm with Privy wallet"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={!!busy}
            onClick={() => setConfirm(null)}
          >
            Close confirmation
          </button>
        </div>
      )}
      {requests.loading && !requests.data && <p role="status">Loading owner actions…</p>}
      {requests.data?.items.length === 0 && <p>No owner actions are recorded.</p>}
      {requests.data?.items.map((request) => (
        <article key={request.id}>
          <p>
            <span className="pill">{request.state.replaceAll("_", " ")}</span>
          </p>
          <p>{ownerCommandDescription(request.command_json)}</p>
          {request.failure_code && (
            <p role="alert">
              {request.failure_code.replaceAll("_", " ")}. Check the request before retrying.
            </p>
          )}
          {request.permission_pending && (
            <p>
              The temporary Privy rule still needs a cleanup check. The worker does not broadcast
              until that check passes.
            </p>
          )}
          {request.transaction_hash && (
            <p>
              <a
                href={`https://testnet.arcscan.app/tx/${request.transaction_hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View owner transaction
              </a>
            </p>
          )}
          {request.state === "COMPLETE" && (
            <p>Check current chain state above to refresh the budget values.</p>
          )}
          {organization.role === "OWNER" &&
            request.requested_by === actorId &&
            request.state === "AWAITING_AUTHORIZATION" && (
              <button
                type="button"
                className="secondary"
                disabled={!!busy || Date.parse(request.authorization_expires_at) <= Date.now()}
                onClick={() => setConfirm(request)}
              >
                Review saved confirmation
              </button>
            )}
          {request.requested_by === actorId &&
            ["AWAITING_AUTHORIZATION", "QUEUED"].includes(request.state) &&
            !request.tx_intent_id && (
              <button
                type="button"
                className="text-button"
                disabled={!!busy}
                onClick={() =>
                  void run("Cancel owner action", async () => {
                    await api(`/owner-requests/${request.id}/cancel`, { method: "POST", body: {} });
                    if (confirm?.id === request.id) setConfirm(null);
                  })
                }
              >
                Cancel before signing
              </button>
            )}
          {organization.role === "OWNER" &&
            !terminal.has(request.state) &&
            request.state !== "AWAITING_AUTHORIZATION" && (
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() =>
                  void run("Retry owner action", async () => {
                    await api(`/owner-requests/${request.id}/retry`, { method: "POST", body: {} });
                    setNotice(
                      "The worker will check the saved transaction and temporary permission.",
                    );
                  })
                }
              >
                Retry saved owner action
              </button>
            )}
        </article>
      ))}
    </section>
  );
}
