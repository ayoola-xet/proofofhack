import { usePrivy } from "@privy-io/react-auth";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  FileCheck2,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Plus,
  RefreshCw,
  ShieldCheck,
  Users,
  Wallet as WalletIcon,
} from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { formatMoney } from "../../../packages/domain/src/index.ts";
import { type Me, type Membership, useApi, useResource } from "./api.ts";
import { BountyWorkspace } from "./pages/BountyWorkspace.tsx";
import { ClaimSubmission, MyClaims, ReportDownload } from "./pages/Claims.tsx";
import { Coverage } from "./pages/Coverage.tsx";
import { Treasury } from "./pages/Treasury.tsx";
import { WalletPage } from "./pages/Wallet.tsx";

function Brand() {
  return (
    <Link to="/" className="brand">
      <span className="brand-mark">
        <ShieldCheck size={23} />
      </span>
      VulnProof<span className="beta">BETA</span>
    </Link>
  );
}
function State({ loading, error, empty }: { loading?: boolean; error?: string; empty?: string }) {
  if (error)
    return (
      <div role="alert" className="notice error">
        <CircleHelp size={18} />
        <span>{error}</span>
      </div>
    );
  if (loading)
    return (
      <div className="loading" role="status">
        <RefreshCw className="spin" size={18} /> Loading your workspace…
      </div>
    );
  return empty ? (
    <div className="empty">
      <Layers3 size={28} />
      <h3>{empty}</h3>
      <p>New records appear here when they are available.</p>
    </div>
  ) : null;
}
function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-title">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {action}
    </header>
  );
}
function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}
function Intro() {
  const { login, ready } = usePrivy();
  return (
    <div className="welcome">
      <header>
        <Brand />
        <span className="network">
          <i />
          Arc Testnet
        </span>
      </header>
      <main className="welcome-grid">
        <section>
          <div className="eyebrow">A WORKSPACE FOR ACCOUNTABLE COVERAGE</div>
          <h1>
            Keep evidence private.
            <br />
            <em>Make settlement clear.</em>
          </h1>
          <p>
            Fund a fixed reward. Submit an encrypted fixture claim. Follow the payment from approval
            to receipt.
          </p>
          <button type="button" className="primary large" disabled={!ready} onClick={() => login()}>
            Open your workspace <ArrowRight size={18} />
          </button>
          <div className="trust-row">
            <LockKeyhole size={15} /> Private report access <span>·</span>
            <Check size={15} /> Fixed reward terms
          </div>
        </section>
        <section className="flow-card">
          <div className="flow-top">
            <ShieldCheck size={22} />
            <span>One claim. A clear record.</span>
            <Pill>TESTNET</Pill>
          </div>
          {[
            ["01", "Fund coverage", "Lock the reward and its terms."],
            ["02", "Submit a private claim", "Encrypt a fixed synthetic record."],
            ["03", "Verify and settle", "Check the record. Collect the reward."],
            ["04", "Release the report", "Give the organization access after payment."],
          ].map(([n, t, d]) => (
            <div className="flow-step" key={n}>
              <span>{n}</span>
              <div>
                <h3>{t}</h3>
                <p>{d}</p>
              </div>
            </div>
          ))}
          <div className="flow-foot">
            The Graph <span>+</span> Arc <span>+</span> Privy
          </div>
        </section>
      </main>
      <footer>
        <strong>Evidence scope: synthetic fixtures.</strong> The trusted verifier checks committed
        accounting records. It does not prove a vulnerability in a live vault.
      </footer>
    </div>
  );
}

export function App() {
  const { authenticated, ready, logout } = usePrivy();
  const me = useResource<Me>(authenticated ? "/me" : null);
  const [selected, setSelected] = useState("");
  const organization =
    me.data?.memberships.find((m) => m.organization_id === selected) ??
    me.data?.memberships[0] ??
    null;
  if (!ready)
    return (
      <main className="setup">
        <Brand />
        <State loading />
      </main>
    );
  if (!authenticated) return <Intro />;
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Brand />
        <label className="org-switch">
          <span>WORKSPACE</span>
          <div>
            <select
              aria-label="Active organization"
              value={organization?.organization_id ?? ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {me.data?.memberships.length ? (
                me.data.memberships.map((m) => (
                  <option value={m.organization_id} key={m.organization_id}>
                    {m.name}
                  </option>
                ))
              ) : (
                <option value="">Personal workspace</option>
              )}
            </select>
            <ChevronDown size={14} />
          </div>
        </label>
        <nav aria-label="Main navigation">
          {[
            ["/", "Overview", LayoutDashboard],
            ["/coverage", "Vault coverage", Layers3],
            ["/bounties", "Fixture bounties", ShieldCheck],
            ["/reports", "Private reports", FileCheck2],
            ["/wallet", "Wallet", WalletIcon],
            ["/receipts", "Receipts", BookOpen],
            ["/team", "Organization", Users],
          ].map(([to, label, Icon]) => {
            const I = Icon as typeof LayoutDashboard;
            return (
              <NavLink key={to as string} to={to as string} end>
                <I size={18} />
                {label as string}
              </NavLink>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="scope">
            <LockKeyhole size={18} />
            <strong>Private by design</strong>
            <p>Only paid reports are available to the organization.</p>
            <Link to="/trust">
              Read the trust notice <ArrowUpRight size={13} />
            </Link>
          </div>
          <button type="button" className="account" onClick={() => logout()}>
            <span className="avatar">{(me.data?.user.displayName ?? "V").slice(0, 1)}</span>
            <span>
              {me.data?.user.displayName ?? "Your account"}
              <small>{organization?.role ?? "RESEARCHER"}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main-wrap">
        <div className="topbar">
          <span className="crumb">
            Workspace <span>/</span> Coverage operations
          </span>
          <span className="network">
            <i />
            Arc Testnet
          </span>
        </div>
        <main className="main-content">
          <State loading={me.loading} error={me.error} />
          <Routes>
            <Route
              path="/"
              element={<Overview organization={organization} me={me.data} refresh={me.refresh} />}
            />
            <Route path="/coverage" element={<Coverage organization={organization} />} />
            <Route
              path="/bounties"
              element={<Bounties organization={organization} actorId={me.data?.user.id ?? ""} />}
            />
            <Route path="/reports" element={<Reports organization={organization} />} />
            <Route path="/wallet" element={<WalletPage />} />
            <Route path="/receipts" element={<Receipts organization={organization} />} />
            <Route
              path="/team"
              element={<Team organization={organization} me={me.data} refresh={me.refresh} />}
            />
            <Route path="/trust" element={<Trust />} />
            <Route path="*" element={<State empty="This page is not available." />} />
          </Routes>
        </main>
        <footer className="workspace-footer">
          <span>VulnProof · Synthetic fixture evidence</span>
          <Link to="/trust">
            Trust and data use <ArrowUpRight size={12} />
          </Link>
        </footer>
      </div>
    </div>
  );
}
function OrganizationForm({ refresh }: { refresh: () => void }) {
  const api = useApi();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState(crypto.randomUUID());
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/organizations", { method: "POST", body: { name }, key });
      setName("");
      setKey(crypto.randomUUID());
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="form-row" onSubmit={submit}>
      <label>
        Organization name
        <input
          required
          minLength={2}
          maxLength={80}
          placeholder="Your organization"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setKey(crypto.randomUUID());
          }}
        />
      </label>
      <button type="submit" className="primary" disabled={busy || name.trim().length < 2}>
        <Plus size={17} />
        {busy ? "Creating…" : "Create organization"}
      </button>
      {error && <State error={error} />}
    </form>
  );
}
function Overview({
  organization,
  me,
  refresh,
}: {
  organization: Membership | null;
  me: Me | null;
  refresh: () => void;
}) {
  return (
    <>
      <PageTitle
        eyebrow="COVERAGE OPERATIONS"
        title="A clear view of your coverage."
        description="Manage funded rewards, private claims, and verified payments."
        action={
          <Link className="primary" to="/bounties">
            Explore bounties <ArrowUpRight size={16} />
          </Link>
        }
      />
      <div className="notice">
        <ShieldCheck size={19} />
        <div>
          <strong>This workspace uses synthetic fixture evidence.</strong>
          <span> Live vault data provides source context. It is not a vulnerability finding.</span>
        </div>
        <Link to="/trust">
          Details <ArrowRight size={14} />
        </Link>
      </div>
      <section className="summary-grid">
        <div>
          <span>Active workspace</span>
          <strong>{organization?.name ?? "Personal"}</strong>
          <small>{organization?.role ?? "Researcher access"}</small>
        </div>
        <div>
          <span>Your organizations</span>
          <strong>{me?.memberships.length ?? "—"}</strong>
          <small>Access is checked on each request</small>
        </div>
        <div>
          <span>Settlement network</span>
          <strong>
            Arc <small>Testnet</small>
          </strong>
          <small>Rewards use test USDC</small>
        </div>
      </section>
      <div className="section-heading">
        <h2>Your next steps</h2>
        <Pill>GET STARTED</Pill>
      </div>
      <section className="action-grid">
        {[
          [
            "01",
            "Set up coverage",
            "Create a program and choose the vaults to cover.",
            "/team",
            "Set up organization",
            Layers3,
          ],
          [
            "02",
            "Submit a fixture claim",
            "Review fixed terms and send encrypted evidence.",
            "/bounties",
            "View open bounties",
            LockKeyhole,
          ],
          [
            "03",
            "Track settlement",
            "Find the receipt for each confirmed payment.",
            "/receipts",
            "View receipts",
            FileCheck2,
          ],
        ].map(([n, t, d, to, cta, Icon]) => {
          const I = Icon as typeof Layers3;
          return (
            <Link className="action-card" key={n as string} to={to as string}>
              <div className="action-icon">
                <I size={22} />
                <span>{n as string}</span>
              </div>
              <h3>{t as string}</h3>
              <p>{d as string}</p>
              <span className="card-link">
                {cta as string}
                <ArrowRight size={15} />
              </span>
            </Link>
          );
        })}
      </section>
      {!organization && (
        <section className="panel">
          <h2>Create your organization</h2>
          <p className="muted">
            Add a workspace to manage coverage. Researchers can also use open bounties.
          </p>
          <OrganizationForm refresh={refresh} />
        </section>
      )}
      <section className="architecture-strip">
        <span>
          <Layers3 size={18} />
          <strong>The Graph</strong>Vault data
        </span>
        <span>
          <ShieldCheck size={18} />
          <strong>Arc</strong>USDC settlement
        </span>
        <span>
          <WalletIcon size={18} />
          <strong>Privy</strong>Identity and wallets
        </span>
      </section>
    </>
  );
}
type BountyItem = {
  bounty_id: string;
  reward: string;
  chain_state: string;
  policy: Record<string, string>;
};
function Bounties({ organization, actorId }: { organization: Membership | null; actorId: string }) {
  const result = useResource<{ items: BountyItem[] }>("/bounties");
  return (
    <>
      <PageTitle
        eyebrow="FIXED TERMS · PRIVATE EVIDENCE"
        title="Fixture bounties"
        description="Review the reward and deadline before you submit a claim."
      />
      <State loading={result.loading} error={result.error} />
      {organization && ["OWNER", "TREASURY", "REVIEWER"].includes(organization.role) && (
        <BountyWorkspace
          key={organization.organization_id}
          organization={organization}
          actorId={actorId}
          onFunded={result.refresh}
        />
      )}
      {result.data?.items.length ? (
        <div className="bounty-grid">
          {result.data.items.map((b) => (
            <article className="panel" key={b.bounty_id}>
              <div className="section-heading">
                <Pill>{b.chain_state}</Pill>
                <ShieldCheck size={20} />
              </div>
              <h2>{formatMoney(BigInt(b.reward))} USDC</h2>
              <p>Accounting fixture coverage</p>
              <p className="mono">{short(b.policy.sourceVault)}</p>
              <dl>
                <dt>Submissions close</dt>
                <dd>{new Date(Number(b.policy.submissionDeadline) * 1000).toLocaleString()}</dd>
                <dt>Evidence scope</dt>
                <dd>Synthetic fixture</dd>
              </dl>
              <ClaimSubmission bounty={b} onSubmitted={result.refresh} />
            </article>
          ))}
        </div>
      ) : (
        !result.loading &&
        !result.error && (
          <section className="panel">
            <State empty="No funded bounties are available yet." />
          </section>
        )
      )}
    </>
  );
}
function Reports({ organization }: { organization: Membership | null }) {
  const result = useResource<{
    items: { id: string; state: string; report_hash: string; available_at: string | null }[];
  }>(organization ? `/organizations/${organization.organization_id}/reports` : null);
  return (
    <>
      <PageTitle
        eyebrow="CONFIDENTIAL RECORDS"
        title="Private reports"
        description="Organization access starts after the claimant's payment is final."
      />
      <MyClaims />
      <div className="notice">
        <LockKeyhole size={18} />
        <span>Your current role is checked each time you open a report.</span>
      </div>
      <section className="panel">
        <State
          loading={result.loading}
          error={result.error}
          empty={
            !organization
              ? "Select an organization to view reports."
              : result.data?.items.length === 0
                ? "No reports are available yet."
                : undefined
          }
        />
        {result.data?.items.map((r) => (
          <div className="record" key={r.id}>
            <FileCheck2 size={22} />
            <div>
              <strong>Fixture assessment</strong>
              <small className="mono">{short(r.report_hash)}</small>
            </div>
            <Pill>{r.state}</Pill>
            {r.state === "AVAILABLE" && <ReportDownload id={r.id} mode="organization" />}
          </div>
        ))}
      </section>
    </>
  );
}
function Receipts({ organization }: { organization: Membership | null }) {
  const result = useResource<{
    items: {
      id: string;
      category: string;
      amount: string;
      status: string;
      transaction_hash: string;
    }[];
  }>(organization ? `/organizations/${organization.organization_id}/receipts` : null);
  return (
    <>
      <PageTitle
        eyebrow="PAYMENT RECORDS"
        title="Receipts"
        description="Check confirmed payments and their transaction records."
      />
      <section className="panel">
        <State
          loading={result.loading}
          error={result.error}
          empty={
            !organization
              ? "Select an organization to view receipts."
              : result.data?.items.length === 0
                ? "No payment receipts yet."
                : undefined
          }
        />
        {result.data?.items.map((r) => (
          <div className="record" key={r.id}>
            <ArrowDownLeft size={22} />
            <div>
              <strong>{r.category}</strong>
              <small className="mono">{short(r.transaction_hash)}</small>
            </div>
            <strong>{formatMoney(BigInt(r.amount))} USDC</strong>
            <Pill>{r.status}</Pill>
          </div>
        ))}
      </section>
    </>
  );
}
function Team({
  organization,
  me,
  refresh,
}: {
  organization: Membership | null;
  me: Me | null;
  refresh: () => void;
}) {
  const programs = useResource<{ items: { id: string; name: string; status: string }[] }>(
    organization ? `/organizations/${organization.organization_id}/programs` : null,
  );
  const api = useApi();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!organization) return;
    setBusy(true);
    try {
      await api(`/organizations/${organization.organization_id}/programs`, {
        method: "POST",
        body: { name },
      });
      setName("");
      programs.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="ORGANIZATION SETTINGS"
        title={organization?.name ?? "Your organization"}
        description="Set up programs and manage access to your workspace."
      />
      <section className="panel">
        <h2>Create an organization</h2>
        <OrganizationForm refresh={refresh} />
      </section>
      {organization && ["OWNER", "TREASURY"].includes(organization.role) && (
        <Treasury key={organization.organization_id} organization={organization} />
      )}
      {organization && (
        <section className="panel">
          <div className="section-heading">
            <h2>Coverage programs</h2>
            <Pill>{organization.role}</Pill>
          </div>
          <State loading={programs.loading} error={programs.error || error} />
          {programs.data?.items.map((p) => (
            <div className="record" key={p.id}>
              <Layers3 size={20} />
              <strong>{p.name}</strong>
              <Pill>{p.status}</Pill>
            </div>
          ))}
          {["OWNER", "REVIEWER"].includes(organization.role) && (
            <form className="form-row" onSubmit={submit}>
              <label>
                Program name
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Accounting fixture coverage"
                />
              </label>
              <button type="submit" className="primary" disabled={busy}>
                <Plus size={16} />
                Create program
              </button>
            </form>
          )}
        </section>
      )}
      <section className="panel">
        <h2>Your user reference</h2>
        <p className="muted">An owner uses this reference to add you to an organization.</p>
        <code className="break">{me?.user.id ?? "Loading…"}</code>
      </section>
    </>
  );
}
function Trust() {
  return (
    <>
      <PageTitle
        eyebrow="TRUST AND DATA USE"
        title="What VulnProof verifies"
        description="Know the evidence scope and the service limits."
      />
      <article className="panel prose">
        <h2>Synthetic fixture evidence</h2>
        <p>
          This release accepts fixed synthetic accounting records. The record must belong to the
          committed fixture manifest. A manifest is a signed list of allowed records.
        </p>
        <p>
          The verifier compares expected assets with observed assets. It checks the result against
          the fixed threshold. This result does not establish a vulnerability in a live vault.
        </p>
        <h2>A trusted service</h2>
        <p>
          The verifier holds the evidence decryption key and signs its assessment. The contract
          checks this signature. This is not a zero-knowledge proof or an independent audit.
        </p>
        <h2>Private records and public metadata</h2>
        <p>
          The evidence and report stay encrypted in storage. Public chain events include claim
          commitments, wallet addresses, reward amounts, and payment status.
        </p>
        <h2>Report access</h2>
        <p>
          The researcher can access their own report. An organization owner or reviewer can access
          the report after final payment. A removed member loses access on their next request.
        </p>
        <h2>Testnet only</h2>
        <p>
          This build uses test USDC. A successful test does not establish that the system is ready
          for real funds.
        </p>
      </article>
    </>
  );
}
function short(value: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}
