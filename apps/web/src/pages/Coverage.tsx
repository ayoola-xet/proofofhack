import { CircleHelp, RefreshCw } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { formatMoney, parseMoney } from "../../../../packages/domain/src/index.ts";
import { type Membership, useApi, useResource } from "../api.ts";

type Vault = {
  id: string;
  label: string;
  address: string;
  status: string | null;
  reason: string | null;
  funded_reward: string | null;
  observed_at: string | null;
  provider_deployment_id: string | null;
  observed_block: string | null;
  indexed_head: string | null;
};
type Source = { id: string; address: string; label: string; source: string };
type Recommendation = {
  id: string;
  status: string;
  explanation: string;
  source_ids: string[];
  expires_at: string;
  calculation_json: { reasonCode: string; explanationMode: string };
};
const labels: Record<string, string> = {
  ABSTAIN: "No funding action",
  NO_ACTION: "Coverage met",
  ACTIONABLE: "Funding can proceed",
  EXPIRED: "Expired",
};
export function Coverage({ organization }: { organization: Membership | null }) {
  return (
    <CoverageWorkspace
      key={organization?.organization_id ?? "personal"}
      organization={organization}
    />
  );
}
function CoverageWorkspace({ organization }: { organization: Membership | null }) {
  const base = organization ? `/organizations/${organization.organization_id}` : null;
  const api = useApi();
  const vaults = useResource<{ items: Vault[] }>(base ? `${base}/coverage` : null);
  const sources = useResource<{ items: Source[] }>(base ? "/coverage/sources" : null);
  const policies = useResource<{ items: { version_number: number; min_reward: string }[] }>(
    base ? `${base}/coverage-policies` : null,
  );
  const recommendations = useResource<{ items: Recommendation[] }>(
    base ? `${base}/recommendations` : null,
  );
  const [sourceId, setSourceId] = useState("");
  const [reward, setReward] = useState("1");
  const [age, setAge] = useState("300");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const canRegister = organization && ["OWNER", "REVIEWER"].includes(organization.role);
  const available =
    sources.data?.items.filter((s) => !vaults.data?.items.some((v) => v.address === s.address)) ??
    [];
  function refresh() {
    vaults.refresh();
    policies.refresh();
    recommendations.refresh();
  }
  useEffect(() => {
    if (!base) return;
    const timer = setInterval(() => {
      vaults.refresh();
      recommendations.refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [base, vaults.refresh, recommendations.refresh]);
  async function mutate(kind: string, path: string, body: unknown) {
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      await api(`${base}${path}`, { method: "POST", body, key });
      setKey(crypto.randomUUID());
      if (kind === "register") setSourceId("");
      setNotice(
        kind === "register"
          ? "Vault registered. Source data will appear after the next update."
          : kind === "policy"
            ? "Coverage policy approved. The worker will check funding needs."
            : "Source update queued. This page checks for results every 30 seconds.",
      );
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function approve(event: FormEvent) {
    event.preventDefault();
    try {
      const amount = parseMoney(reward);
      if (amount <= 0n) throw new Error("Enter a reward greater than zero.");
      void mutate("policy", "/coverage-policies", {
        minReward: amount.toString(),
        maxDataAgeSeconds: Number(age),
        allowedVaultIds: vaults.data?.items.map((v) => v.id) ?? [],
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <div className="page-title">
        <div>
          <p className="eyebrow">PUBLIC SOURCE DATA</p>
          <h1>Vault coverage</h1>
          <p>Use indexed vault data to check coverage needs.</p>
        </div>
      </div>
      {!organization ? (
        <div className="panel">Create an organization to register vaults.</div>
      ) : (
        <>
          {(error || vaults.error || sources.error || policies.error || recommendations.error) && (
            <div className="notice" role="alert">
              {error || vaults.error || sources.error || policies.error || recommendations.error}
            </div>
          )}
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}
          <div className="panel">
            <div className="section-heading">
              <h2>Registered vaults</h2>
              <button
                type="button"
                className="text-button"
                disabled={!!busy}
                onClick={() => void mutate("refresh", "/coverage/refresh", {})}
              >
                <RefreshCw size={15} />
                Update source data
              </button>
            </div>
            {canRegister && available.length > 0 && (
              <form
                className="form-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate("register", "/vaults", { sourceId });
                }}
              >
                <label>
                  Source vault
                  <select
                    required
                    value={sourceId}
                    onChange={(e) => {
                      setSourceId(e.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  >
                    <option value="">Select a live vault</option>
                    {available.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label} · Ethereum
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="primary" disabled={!!busy || !sourceId}>
                  {busy === "register" ? "Registering…" : "Register vault"}
                </button>
              </form>
            )}
            {vaults.loading && !vaults.data ? (
              <p>Loading coverage…</p>
            ) : !vaults.data?.items.length ? (
              <p>No vaults are registered yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Vault</th>
                      <th>Coverage state</th>
                      <th>Funded reward</th>
                      <th>Source time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vaults.data.items.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <strong>{v.label}</strong>
                          <small className="mono">
                            {v.address.slice(0, 8)}…{v.address.slice(-6)}
                          </small>
                        </td>
                        <td>
                          <span className="pill">
                            {v.status ? (labels[v.status] ?? v.status) : "Set coverage policy"}
                          </span>
                          <small>{v.reason?.replaceAll("_", " ").toLowerCase()}</small>
                        </td>
                        <td>
                          {v.funded_reward !== null
                            ? `${formatMoney(BigInt(v.funded_reward))} USDC`
                            : "—"}
                        </td>
                        <td>
                          {v.observed_at
                            ? new Date(v.observed_at).toLocaleString()
                            : "Awaiting indexed data"}
                          {v.observed_block && (
                            <small>
                              Block {v.observed_block} · Indexed head {v.indexed_head}
                            </small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {organization.role === "OWNER" && (
            <div className="panel">
              <div className="section-heading">
                <h2>Coverage policy</h2>
                {policies.data?.items[0] && (
                  <span>
                    Version {policies.data.items[0].version_number} ·{" "}
                    {formatMoney(BigInt(policies.data.items[0].min_reward))} USDC
                  </span>
                )}
              </div>
              <p>
                Approve a minimum funded reward for each registered vault. This policy does not
                transfer funds.
              </p>
              <form className="form-row" onSubmit={approve}>
                <label>
                  Minimum reward (test USDC)
                  <input
                    inputMode="decimal"
                    required
                    value={reward}
                    onChange={(e) => {
                      setReward(e.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  />
                </label>
                <label>
                  Maximum source age (seconds)
                  <input
                    type="number"
                    min="30"
                    max="86400"
                    required
                    value={age}
                    onChange={(e) => {
                      setAge(e.target.value);
                      setKey(crypto.randomUUID());
                    }}
                  />
                </label>
                <button
                  className="primary"
                  type="submit"
                  disabled={!!busy || !vaults.data?.items.length}
                >
                  {busy === "policy" ? "Approving…" : "Approve coverage policy"}
                </button>
              </form>
            </div>
          )}
          <div className="panel">
            <div className="section-heading">
              <h2>Coverage decisions</h2>
              <span>Rule-based calculations</span>
            </div>
            {!recommendations.data?.items.length ? (
              <p>Register a vault and approve a coverage policy to see decisions.</p>
            ) : (
              recommendations.data.items.map((r) => (
                <article className="coverage-decision" key={r.id}>
                  <span className="pill">{labels[r.status] ?? r.status}</span>
                  <p>{r.explanation}</p>
                  <small>
                    Valid until {new Date(r.expires_at).toLocaleString()}. No model explanation is
                    attached.
                  </small>
                </article>
              ))
            )}
          </div>
        </>
      )}
      <div className="notice">
        <CircleHelp size={18} />
        <span>
          Live vault data is source context. Fixture evidence is synthetic. Missing or stale data
          stops funding recommendations.
        </span>
      </div>
    </>
  );
}
