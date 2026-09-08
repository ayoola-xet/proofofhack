import { useCreateWallet, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { Wallet as WalletIcon } from "lucide-react";
import { type FormEvent, useState } from "react";
import { formatMoney, parseMoney } from "../../../../packages/domain/src/index.ts";
import { useApi, useResource, type Wallet } from "../api.ts";

type Transaction = {
  from: string;
  to: string;
  chainId: number;
  nonce: number;
  data: `0x${string}`;
  value: string;
  amount: string;
  recipient: string;
};
type Intent = {
  id: string;
  state: string;
  transaction_hash: `0x${string}` | null;
  transaction: Transaction;
};
export function WalletPage() {
  const api = useApi();
  const { wallets, ready } = useWallets();
  const { createWallet } = useCreateWallet();
  const saved = useResource<{ items: Wallet[] }>("/wallets/me");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function sync() {
    setBusy(true);
    setError("");
    try {
      await api("/wallets/sync", { method: "POST", body: {} });
      saved.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">YOUR PRIVY WALLETS</p>
          <h1>Wallet</h1>
          <p>Use a verified wallet to receive rewards and send test USDC.</p>
        </div>
      </div>
      <div className="notice">
        <WalletIcon size={18} />
        <span>
          Arc uses USDC for transfers and gas. The token and native balance views refer to the same
          funds.
        </span>
      </div>
      {(error || saved.error) && (
        <div className="notice" role="alert">
          {error || saved.error}
        </div>
      )}
      <section className="panel">
        <div className="section-heading">
          <h2>Your reward wallet</h2>
          <button
            type="button"
            className="secondary"
            disabled={!ready || busy}
            onClick={() => void sync()}
          >
            {busy ? "Verifying…" : "Verify linked wallets"}
          </button>
        </div>
        {wallets
          .filter((w) => w.walletClientType === "privy")
          .map((w) => (
            <article className="wallet-card" key={w.address}>
              <div className="wallet-graphic">
                <WalletIcon size={28} />
                <span>PRIVY WALLET</span>
              </div>
              <div>
                <h2>Embedded wallet</h2>
                <p className="mono break">{w.address}</p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void navigator.clipboard.writeText(w.address)}
                >
                  Copy address
                </button>
              </div>
            </article>
          ))}
        {ready && !wallets.some((w) => w.walletClientType === "privy") && (
          <div>
            <p>Create a Privy wallet for this testnet workspace.</p>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void createWallet()
                  .then(() => sync())
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Create reward wallet
            </button>
          </div>
        )}
      </section>
      {saved.data?.items.map((wallet) => (
        <WalletTransfers key={wallet.id} wallet={wallet} />
      ))}
    </>
  );
}
function WalletTransfers({ wallet }: { wallet: Wallet }) {
  const api = useApi();
  const { sendTransaction } = useSendTransaction();
  const balance = useResource<{ amount: string; blockNumber: string }>(
    `/wallets/${wallet.id}/balance`,
  );
  const transfers = useResource<{ items: Intent[] }>(`/wallets/${wallet.id}/transfers`);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.01");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const pending = transfers.data?.items.find((t) =>
    ["AWAITING_SIGNATURE", "BROADCAST", "SUBMITTED", "UNKNOWN"].includes(t.state),
  );
  async function prepare(event: FormEvent) {
    event.preventDefault();
    setBusy("prepare");
    setError("");
    setNotice("");
    try {
      await api(`/wallets/${wallet.id}/transfers`, {
        method: "POST",
        key,
        body: { to: recipient, amount: parseMoney(amount).toString() },
      });
      setKey(crypto.randomUUID());
      transfers.refresh();
      setNotice("Transfer saved. Check the recipient and amount before you open Privy.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function reconcile(intent: Intent, hash: `0x${string}`) {
    await api(`/transfers/${intent.id}/broadcast`, {
      method: "POST",
      body: { transactionHash: hash },
    });
    localStorage.removeItem(`vulnproof:transfer:${intent.id}`);
    transfers.refresh();
    balance.refresh();
  }
  async function send(intent: Intent) {
    setBusy(intent.id);
    setError("");
    try {
      const cached = localStorage.getItem(`vulnproof:transfer:${intent.id}`);
      if (cached && /^0x[0-9a-fA-F]{64}$/.test(cached)) {
        await reconcile(intent, cached as `0x${string}`);
        return;
      }
      const tx = intent.transaction;
      const result = await sendTransaction(
        { to: tx.to, data: tx.data, chainId: tx.chainId, nonce: tx.nonce, value: 0n },
        { address: tx.from, uiOptions: { showWalletUIs: true } },
      );
      localStorage.setItem(`vulnproof:transfer:${intent.id}`, result.hash);
      await reconcile(intent, result.hash);
      setNotice("Transaction sent. Check its final status below.");
    } catch (e) {
      setError(
        `${(e as Error).message} Keep this transfer record. Its fixed transaction nonce prevents a second payment from a retry.`,
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <h2>Test USDC balance</h2>
          <button
            className="text-button"
            type="button"
            onClick={() => {
              balance.refresh();
              transfers.refresh();
            }}
          >
            Refresh
          </button>
        </div>
        <h2>
          {balance.data
            ? `${formatMoney(BigInt(balance.data.amount))} USDC`
            : balance.loading
              ? "Loading…"
              : "Unavailable"}
        </h2>
        <p>This balance also pays network fees. Keep enough USDC for gas.</p>
        {(error || balance.error || transfers.error) && (
          <div className="notice" role="alert">
            {error || balance.error || transfers.error}
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            {notice}
          </div>
        )}
        {!pending && (
          <form className="form-row" onSubmit={prepare}>
            <label>
              Recipient address
              <input
                required
                pattern="0x[0-9a-fA-F]{40}"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </label>
            <label>
              Amount (test USDC)
              <input
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setKey(crypto.randomUUID());
                }}
              />
            </label>
            <button className="primary" type="submit" disabled={!!busy}>
              Prepare transfer
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>Transfers</h2>
        {!transfers.data?.items.length ? (
          <p>No transfers are recorded yet.</p>
        ) : (
          transfers.data.items.map((intent) => (
            <article className="coverage-decision" key={intent.id}>
              <div className="section-heading">
                <strong>{formatMoney(BigInt(intent.transaction.amount))} USDC</strong>
                <span className="pill">{intent.state.replaceAll("_", " ")}</span>
              </div>
              <p className="mono break">To {intent.transaction.recipient}</p>
              {intent.state === "AWAITING_SIGNATURE" && (
                <button
                  type="button"
                  className="primary"
                  disabled={!!busy}
                  onClick={() => void send(intent)}
                >
                  Review and sign with Privy
                </button>
              )}
              {intent.transaction_hash && (
                <>
                  <a
                    href={`https://testnet.arcscan.app/tx/${intent.transaction_hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction
                  </a>
                  {["BROADCAST", "SUBMITTED", "UNKNOWN"].includes(intent.state) && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={!!busy}
                      onClick={() => {
                        setBusy(intent.id);
                        if (!intent.transaction_hash) return;
                        void reconcile(intent, intent.transaction_hash)
                          .catch((e) => setError(e.message))
                          .finally(() => setBusy(""));
                      }}
                    >
                      Check confirmation
                    </button>
                  )}
                </>
              )}
            </article>
          ))
        )}
      </section>
    </>
  );
}
