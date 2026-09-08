import { type FormEvent, useState } from "react";
import { formatMoney } from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource } from "../api.ts";

type RecoveryItem = {
  bounty_id: string;
  reward: string;
  chain_state: string;
  settlement_deadline: string;
  refund_recipient: string;
  status: string;
  failure_code: string | null;
  transaction_hash: string | null;
};
const labels: Record<string, string> = {
  NOT_STARTED: "Waiting for first check",
  WAITING: "Watching the deadline",
  SCANNING: "Checking chain records",
  PREPARED: "Request saved",
  CONFIRMING: "Waiting for final confirmation",
  RETRYING: "Retry pending",
  NEEDS_REVIEW: "Review required",
  COMPLETE: "Recovery check complete",
};
export function Recovery({
  organization,
  onChanged,
}: {
  organization: Membership;
  onChanged: () => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const result = useResource<{ items: RecoveryItem[]; nextCursor: string | null }>(
    `/organizations/${organization.organization_id}/recovery?limit=25${cursor ? `&cursor=${cursor}` : ""}`,
  );
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Expiry and refunds</h2>
        <button type="button" className="secondary" onClick={result.refresh}>
          Refresh status
        </button>
      </div>
      <p>
        Expired reservations close automatically. After the settlement deadline, unallocated rewards
        return to the fixed refund recipient. A qualified reward remains payable to its claimant.
      </p>
      {result.loading && <p role="status">Loading recovery status…</p>}
      {result.error && <p role="alert">{result.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {result.data?.items.length === 0 && <p>No funded bounties need a recovery check yet.</p>}
      {result.data?.items.map((item) => (
        <RecoveryRow
          key={item.bounty_id}
          item={item}
          onChanged={(message) => {
            setNotice(message);
            result.refresh();
            onChanged();
          }}
        />
      ))}
      {cursor && (
        <button className="secondary" type="button" onClick={() => setCursor(null)}>
          First page
        </button>
      )}
      {result.data?.nextCursor && (
        <button
          className="secondary"
          type="button"
          onClick={() => setCursor(result.data?.nextCursor ?? null)}
        >
          Next page
        </button>
      )}
    </section>
  );
}
function RecoveryRow({
  item,
  onChanged,
}: {
  item: RecoveryItem;
  onChanged: (message: string) => void;
}) {
  const api = useApi(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [hash, setHash] = useState("");
  async function act(receipt = false) {
    setBusy(true);
    setError("");
    try {
      await api(`/bounties/${item.bounty_id}/${receipt ? "recovery-receipts" : "recovery/retry"}`, {
        method: "POST",
        body: receipt ? { transactionHash: hash.trim() } : {},
      });
      onChanged(
        receipt ? "The final recovery receipt is recorded." : "The recovery check is queued.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void act(true);
  }
  return (
    <details className="recovery-item">
      <summary>
        {formatMoney(BigInt(item.reward))} USDC · {labels[item.status] ?? item.status}
      </summary>
      <dl>
        <dt>Bounty</dt>
        <dd className="mono">{item.bounty_id}</dd>
        <dt>Chain state</dt>
        <dd>{item.chain_state}</dd>
        <dt>Settlement deadline</dt>
        <dd>{new Date(Number(item.settlement_deadline) * 1000).toLocaleString()}</dd>
        <dt>Fixed refund recipient</dt>
        <dd className="mono">{item.refund_recipient}</dd>
      </dl>
      {item.transaction_hash && (
        <p>
          <a
            href={`https://testnet.arcscan.app/tx/${item.transaction_hash}`}
            target="_blank"
            rel="noreferrer"
          >
            View recovery transaction
          </a>
        </p>
      )}
      {item.failure_code && (
        <p role="status">
          The last check needs attention. Reference: {item.failure_code}. A retry preserves the
          saved transaction.
        </p>
      )}
      <button type="button" className="secondary" disabled={busy} onClick={() => void act()}>
        Check recovery now
      </button>
      <form onSubmit={submit}>
        <label>
          Already completed a recovery transaction?
          <input
            aria-label="Recovery transaction hash"
            value={hash}
            onChange={(e) => setHash(e.target.value)}
            placeholder="0x transaction hash"
            pattern="0x[0-9a-fA-F]{64}"
            required
            disabled={busy}
          />
        </label>
        <button type="submit" className="secondary" disabled={busy}>
          Record final receipt
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
