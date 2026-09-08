import { type FormEvent, useState } from "react";
import { formatMoney, parseMoney } from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource } from "../api.ts";

type TreasuryWallet = {
  id: string | null;
  address: string | null;
  state: string;
  max_per_action: string;
  policy_ref: string | null;
  setup_id: string;
};
export function Treasury({ organization }: { organization: Membership }) {
  const api = useApi();
  const base = `/organizations/${organization.organization_id}`;
  const wallets = useResource<{ items: TreasuryWallet[] }>(`${base}/wallets`);
  const [limit, setLimit] = useState("5"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  async function create(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`${base}/wallets`, {
        method: "POST",
        key,
        body: { maxPerAction: parseMoney(limit).toString() },
      });
      setKey(crypto.randomUUID());
      wallets.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Organization funding wallet</h2>
        <button type="button" className="text-button" onClick={wallets.refresh}>
          Refresh
        </button>
      </div>
      <p>
        Privy limits this wallet to Arc Testnet and the approved funding contracts. An owner or
        treasury member must approve each funding action.
      </p>
      {(error || wallets.error) && (
        <div className="notice" role="alert">
          {error || wallets.error}
        </div>
      )}
      {wallets.loading && !wallets.data ? (
        <p>Loading wallet…</p>
      ) : wallets.data?.items.length ? (
        wallets.data.items.map((wallet) => (
          <div key={wallet.setup_id}>
            <p>
              <span className="pill">{wallet.state.replaceAll("_", " ")}</span> · Maximum{" "}
              {formatMoney(BigInt(wallet.max_per_action))} test USDC per action
            </p>
            {wallet.address && <p className="mono break">{wallet.address}</p>}
            {wallet.state === "NEEDS_RECONCILIATION" ? (
              <p>Setup needs an operator check. Do not send funds to this wallet yet.</p>
            ) : wallet.state !== "READY" ? (
              <p>Setup is in progress. Refresh this panel to check the result.</p>
            ) : (
              wallet.id && (
                <TreasuryBalance
                  organizationId={organization.organization_id}
                  walletId={wallet.id}
                />
              )
            )}
          </div>
        ))
      ) : (
        organization.role === "OWNER" && (
          <form className="form-row" onSubmit={create}>
            <label>
              Maximum per action (test USDC)
              <input
                required
                inputMode="decimal"
                value={limit}
                onChange={(e) => {
                  setLimit(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Queuing setup…" : "Create restricted wallet"}
            </button>
          </form>
        )
      )}
    </section>
  );
}
function TreasuryBalance({
  organizationId,
  walletId,
}: {
  organizationId: string;
  walletId: string;
}) {
  const balance = useResource<{ amount: string }>(
    `/organizations/${organizationId}/wallets/${walletId}/balance`,
  );
  return (
    <div>
      <strong>
        {balance.data
          ? `${formatMoney(BigInt(balance.data.amount))} test USDC`
          : balance.loading
            ? "Loading balance…"
            : "Balance unavailable"}
      </strong>
      <p>This balance also pays gas. Keep a reserve for network fees.</p>
      {balance.error && (
        <div className="notice" role="alert">
          {balance.error}
        </div>
      )}
      <button className="secondary" type="button" onClick={balance.refresh}>
        Refresh balance
      </button>
    </div>
  );
}
