import { useState } from "react";
import { formatMoney } from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource } from "../api.ts";
import { type BudgetDraft, BudgetOwnerControls } from "./BudgetOwnerControls.tsx";

export type BudgetController = {
  id: string;
  address: string;
  enabled: boolean;
  owner_address: string;
  operator_address: string;
  limit_projection_json: {
    balance: string;
    perActionLimit: string;
    dailyLimit: string;
    spentToday: string;
    minimumInterval: string;
    timestamp: string;
    deploymentProof: { transactionHash: string };
  };
};
type Allocation = {
  id: string;
  controller_id: string;
  state: string;
  policy_hash: string;
  transaction_hash: string | null;
  rejection_code: string | null;
};
type Approval = {
  id: string;
  policy_hash: string;
  reward: string;
  expires_at: string;
  consumed_event_ref: string | null;
};
const amount = (value: string) => `${formatMoney(BigInt(value))} test USDC`;
export function Budget({ organization, actorId }: { organization: Membership; actorId?: string }) {
  const controllers = useResource<{ items: BudgetController[] }>(
    `/organizations/${organization.organization_id}/controllers`,
  );
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Coverage budget</h2>
        <button type="button" className="text-button" onClick={controllers.refresh}>
          Refresh budget
        </button>
      </div>
      <p>
        The Circle operator can fund exact policies approved by the owner. The controller enforces
        the spending limits.
      </p>
      {controllers.error && (
        <p role="alert" className="notice">
          {controllers.error}
        </p>
      )}
      {controllers.loading && <p role="status">Loading budget…</p>}
      {controllers.data?.items.length === 0 && <p>No budget controller is registered.</p>}
      {controllers.data?.items.map((controller) => (
        <Controller
          key={controller.id}
          controller={controller}
          organization={organization}
          actorId={actorId}
          refresh={controllers.refresh}
        />
      ))}
    </section>
  );
}
function Controller({
  controller,
  organization,
  refresh,
  actorId,
}: {
  controller: BudgetController;
  organization: Membership;
  refresh: () => void;
  actorId?: string;
}) {
  const api = useApi(),
    state = controller.limit_projection_json;
  const approvals = useResource<{ items: Approval[] }>(`/controllers/${controller.id}/approvals`);
  const allocations = useResource<{ items: Allocation[] }>(
    `/organizations/${organization.organization_id}/allocations`,
  );
  const drafts = useResource<{ items: BudgetDraft[] }>(
    `/organizations/${organization.organization_id}/bounty-drafts`,
  );
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const canManage = ["OWNER", "TREASURY"].includes(organization.role);
  async function run(path: string, body: unknown = {}) {
    setBusy(path);
    setError("");
    setNotice("");
    try {
      await api(path, { method: "POST", body });
      refresh();
      approvals.refresh();
      allocations.refresh();
      setNotice(
        path.endsWith("retry")
          ? "The saved request is queued for another status check."
          : "The chain records are updated.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <article className="wallet-card">
      <div>
        <h3>{amount(state.balance)}</h3>
        <p>
          <span className="pill">{controller.enabled ? "ENABLED" : "DISABLED"}</span> · Available
          budget
        </p>
        {!controller.enabled && (
          <p>New allocations are disabled. The owner must set limits and enable the controller.</p>
        )}
        <dl>
          <dt>Limit per allocation</dt>
          <dd>{amount(state.perActionLimit)}</dd>
          <dt>Daily limit</dt>
          <dd>{amount(state.dailyLimit)}</dd>
          <dt>Spent today (UTC)</dt>
          <dd>{amount(state.spentToday)}</dd>
          <dt>Minimum time between allocations</dt>
          <dd>{state.minimumInterval} seconds</dd>
          <dt>Chain record time</dt>
          <dd>{new Date(Number(state.timestamp) * 1000).toLocaleString()}</dd>
        </dl>
        <p>
          The budget balance is separate from the organization wallet and the operator gas reserve.
        </p>
        <details>
          <summary>Controller and wallet addresses</summary>
          <dl>
            <dt>Controller</dt>
            <dd className="mono break">{controller.address}</dd>
            <dt>Owner wallet</dt>
            <dd className="mono break">{controller.owner_address}</dd>
            <dt>Circle operator</dt>
            <dd className="mono break">{controller.operator_address}</dd>
          </dl>
          <a
            href={`https://testnet.arcscan.app/tx/${state.deploymentProof.transactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            View deployment receipt
          </a>
        </details>
        <button
          type="button"
          className="secondary"
          disabled={!!busy}
          onClick={() => void run(`/controllers/${controller.id}/refresh`)}
        >
          Check current chain state
        </button>
        {(error || approvals.error || allocations.error || drafts.error) && (
          <p role="alert" className="notice">
            {error || approvals.error || allocations.error || drafts.error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        <BudgetOwnerControls
          controller={controller}
          organization={organization}
          actorId={actorId}
          drafts={drafts.data?.items ?? []}
        />
        <h3>Policy approvals</h3>
        <p>
          A draft approval in ProofOfHack does not grant a controller approval. The owner must also
          approve the exact policy on chain.
        </p>
        {canManage &&
          drafts.data?.items
            .filter(
              (d) => d.status === "APPROVED" && d.policy.refundRecipient === controller.address,
            )
            .map((draft) => (
              <div key={draft.id}>
                <p className="mono break">{draft.policy_hash}</p>
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() =>
                    void run(`/controllers/${controller.id}/approvals/sync`, { draftId: draft.id })
                  }
                >
                  Check owner approval on chain
                </button>
              </div>
            ))}
        {approvals.data?.items.length === 0 && <p>No controller approvals are recorded.</p>}
        {approvals.data?.items.map((approval) => (
          <div key={approval.id}>
            <p>
              <strong>{amount(approval.reward)}</strong> ·{" "}
              {approval.consumed_event_ref
                ? "Used"
                : Date.parse(approval.expires_at) <= Date.now()
                  ? "Expired"
                  : "Approved"}
            </p>
            <p className="mono break">{approval.policy_hash}</p>
            <p>Expires {new Date(approval.expires_at).toLocaleString()}</p>
          </div>
        ))}
        <h3>Allocation history</h3>
        {allocations.data &&
          !allocations.data.items.some((a) => a.controller_id === controller.id) && (
            <p>No allocations are recorded.</p>
          )}
        {allocations.data?.items
          .filter((a) => a.controller_id === controller.id)
          .map((allocation) => (
            <div key={allocation.id}>
              <p>
                <span className="pill">{allocation.state.replaceAll("_", " ")}</span>
              </p>
              <p className="mono break">{allocation.policy_hash}</p>
              {allocation.rejection_code && <p>{allocation.rejection_code.replaceAll("_", " ")}</p>}
              {allocation.transaction_hash && (
                <p>
                  <a
                    href={`https://testnet.arcscan.app/tx/${allocation.transaction_hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction
                  </a>
                </p>
              )}
              {canManage &&
                ["QUEUED", "PREPARED", "SUBMITTED", "CONFIRMING"].includes(allocation.state) && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={!!busy}
                    onClick={() => void run(`/allocations/${allocation.id}/retry`)}
                  >
                    Retry saved allocation
                  </button>
                )}
            </div>
          ))}
      </div>
    </article>
  );
}
