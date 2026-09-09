import { usePrivy } from "@privy-io/react-auth";
import { type FormEvent, useEffect, useState } from "react";
import { formatMoney } from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource } from "../api.ts";

type Receipt = {
  id: string;
  category: string;
  amount: string;
  status: string;
  transaction_hash: string;
  block_number: string;
  created_at: string;
};
type ExportItem = {
  id: string;
  state: string;
  rowCount: number;
  contentHash: string | null;
  errorCode: string | null;
  createdAt: string;
};
const categories = [
  "FUNDING",
  "PAYMENT",
  "REFUND",
  "BUDGET_ALLOCATION",
  "BUDGET_DEPOSIT",
  "BUDGET_WITHDRAW",
];
const label = (value: string) => value.toLowerCase().replaceAll("_", " ");
export function ReceiptsPage({ organization }: { organization: Membership | null }) {
  const [selectedScope, setSelectedScope] = useState("organization");
  const canReadOrganization = organization && ["OWNER", "TREASURY"].includes(organization.role);
  const scope = canReadOrganization ? selectedScope : "researcher";
  return (
    <>
      <label>
        Receipt account
        <select value={scope} onChange={(event) => setSelectedScope(event.target.value)}>
          {canReadOrganization && <option value="organization">Organization receipts</option>}
          <option value="researcher">My reward payments</option>
        </select>
      </label>
      <ReceiptWorkspace
        key={scope === "organization" ? organization?.organization_id : "researcher"}
        base={scope === "organization" ? `/organizations/${organization?.organization_id}` : "/me"}
        researcher={scope === "researcher"}
      />
    </>
  );
}
function ReceiptWorkspace({ base, researcher }: { base: string; researcher: boolean }) {
  const api = useApi(),
    { getAccessToken } = usePrivy();
  const [category, setCategory] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const query = new URLSearchParams({
    ...filters,
    ...(cursor ? { cursor } : {}),
    limit: "25",
  }).toString();
  const records = useResource<{ items: Receipt[]; nextCursor: string | null }>(
    `${base}/receipts?${query}`,
  );
  const exports = useResource<{ items: ExportItem[] }>(`${base}/receipt-exports`);
  const pending =
    exports.data?.items.some((e) => ["QUEUED", "RUNNING", "RETRYING"].includes(e.state)) ?? false;
  const refreshExports = exports.refresh;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(refreshExports, 5000);
    return () => clearInterval(timer);
  }, [pending, refreshExports]);
  function apply(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    const selected: Record<string, string> = {};
    if (category) selected.category = category;
    if (from) selected.from = new Date(`${from}T00:00:00`).toISOString();
    if (to) {
      const end = new Date(`${to}T00:00:00`);
      end.setDate(end.getDate() + 1);
      selected.to = end.toISOString();
    }
    if (selected.from && selected.to && selected.from >= selected.to) {
      setError("Use an end date on or after the start date.");
      return;
    }
    setFilters(selected);
    setCursor(null);
    setRequestKey(crypto.randomUUID());
  }
  async function createExport() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ id: string; rowCount: number }>(`${base}/receipt-exports`, {
        method: "POST",
        key: requestKey,
        body: filters,
      });
      setNotice(
        `Export requested for ${result.rowCount} final receipts. The worker checks their chain events.`,
      );
      setRequestKey(crypto.randomUUID());
      exports.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(item: ExportItem) {
    setBusy(true);
    setError("");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again.");
      const response = await fetch(`/api/v1/exports/${item.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.status !== 200 || !response.headers.get("content-type")?.startsWith("text/csv"))
        throw new Error("The export is not available. Refresh its status and check your role.");
      const bytes = await response.arrayBuffer();
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== item.contentHash || hash !== response.headers.get("x-content-sha256"))
        throw new Error("The downloaded file failed its integrity check.");
      const url = URL.createObjectURL(new Blob([bytes], { type: "text/csv;charset=utf-8" })),
        link = document.createElement("a");
      link.href = url;
      link.download = `proofofhack-receipts-${item.id}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="page-title">
        <div>
          <p className="eyebrow">PAYMENT RECORDS · ARC TESTNET</p>
          <h1>{researcher ? "My reward payments" : "Organization receipts"}</h1>
          <p className="muted">
            Filter records and export amounts checked against final chain events.
          </p>
        </div>
      </header>
      <section className="panel">
        <form className="form-row" onSubmit={apply}>
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {(researcher ? ["PAYMENT"] : categories).map((c) => (
                <option value={c} key={c}>
                  {label(c)}
                </option>
              ))}
            </select>
          </label>
          <label>
            From date
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            Through date
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button type="submit" className="secondary">
            Apply filters
          </button>
        </form>
        <p>
          Dates use your local time. Exports include all final receipts that match the applied
          filters, up to 1,000 rows. New receipts do not change a saved export.
        </p>
        {(error || records.error || exports.error) && (
          <p role="alert">{error || records.error || exports.error}</p>
        )}
        {notice && <p role="status">{notice}</p>}
        <div className="section-heading">
          <h2>Financial records</h2>
          <button
            type="button"
            onClick={() => {
              records.refresh();
              exports.refresh();
            }}
          >
            Refresh receipts
          </button>
        </div>
        {records.loading ? (
          <p role="status">Loading receipts…</p>
        ) : (
          <>
            <section className="table-wrap" aria-label="Financial receipts">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Amount (test USDC)</th>
                    <th scope="col">State</th>
                    <th scope="col">Recorded</th>
                    <th scope="col">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {records.data?.items.map((r) => (
                    <tr key={r.id}>
                      <td>{label(r.category)}</td>
                      <td>{formatMoney(BigInt(r.amount))}</td>
                      <td>{r.status}</td>
                      <td>{new Date(r.created_at).toLocaleString()}</td>
                      <td>
                        <a
                          href={`https://testnet.arcscan.app/tx/${r.transaction_hash}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View transaction
                        </a>
                        <small>Block {r.block_number}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            {records.data?.items.length === 0 && <p>No receipts match these filters.</p>}
            {cursor && (
              <button type="button" onClick={() => setCursor(null)}>
                First page
              </button>
            )}
            {records.data?.nextCursor && (
              <button type="button" onClick={() => setCursor(records.data?.nextCursor ?? null)}>
                Next page
              </button>
            )}
          </>
        )}
        <button
          type="button"
          className="primary"
          disabled={busy || records.loading || !!records.error}
          onClick={() => void createExport()}
        >
          Export final receipts as CSV
        </button>
        <p>
          Keep the file private. Import long base-unit values as text to preserve every digit.
          Funding, budget transfers, and payments are separate accounting categories.
        </p>
      </section>
      <section className="panel">
        <h2>Your saved exports</h2>
        <p>
          {researcher
            ? "Only you can download your reward payment exports. Organization membership is not required."
            : "A current owner or treasury role is required for every download."}
        </p>
        {exports.data?.items.map((item) => (
          <article className="wallet-card" key={item.id}>
            <p>
              {item.rowCount} {item.rowCount === 1 ? "receipt" : "receipts"} · {label(item.state)} ·{" "}
              {new Date(item.createdAt).toLocaleString()}
            </p>
            {item.errorCode && (
              <p>
                {label(item.errorCode)}.{" "}
                {item.state === "CANCELLED"
                  ? "Access was removed. This export will not run."
                  : item.state === "FAILED"
                    ? "Check the records and request a new export."
                    : "The worker will retry."}
              </p>
            )}
            {item.state === "READY" && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void download(item)}
              >
                Download CSV
              </button>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
