import { type FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { formatMoney } from "../../../../packages/domain/src/index.ts";
import type {
  CoverageAnswer,
  CoverageSnapshot,
} from "../../../../services/assistant/src/contract.ts";
import { useApi, useResource } from "../api.ts";

type Run = {
  id: string;
  question: string;
  state: string;
  snapshot: CoverageSnapshot;
  answer: CoverageAnswer | null;
  responseModel: string | null;
  requestedModel: string;
  errorCode: string | null;
  usage: { totalTokens: number } | null;
};
const failures: Record<string, string> = {
  MODEL_UNAVAILABLE: "The model service could not complete this request.",
  MODEL_OUTPUT_REJECTED: "The model answer did not pass the source and calculation checks.",
  SOURCE_CHANGED: "Coverage changed. Ask again to use the current data.",
  MEMBERSHIP_REMOVED: "The request stopped because organization access changed.",
};
export function CoverageAssistant({ organizationId }: { organizationId: string }) {
  const api = useApi(),
    [params, setParams] = useSearchParams();
  const config = useResource<{ available: boolean; model: string | null }>("/assistant/config");
  const history = useResource<{ items: { id: string; question: string; state: string }[] }>(
    `/organizations/${organizationId}/assistant-runs`,
  );
  const [question, setQuestion] = useState("Which registered vaults lack funded coverage?");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const selected = params.get("assistant");
  const run = useResource<Run>(selected ? `/assistant-runs/${encodeURIComponent(selected)}` : null);
  useEffect(() => {
    if (!run.data || !["QUEUED", "RUNNING"].includes(run.data.state)) return;
    const timer = setInterval(run.refresh, 3000);
    return () => clearInterval(timer);
  }, [run.data?.state, run.refresh]);
  function select(id: string) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      next.set("assistant", id);
      return next;
    });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const next = await api<{ id: string }>(`/organizations/${organizationId}/assistant-runs`, {
        method: "POST",
        body: { question },
        key: requestKey,
      });
      setRequestKey(crypto.randomUUID());
      select(next.id);
      history.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const result = run.data;
  return (
    <section className="panel coverage-assistant">
      <div className="section-heading">
        <h2>Coverage assistant</h2>
        <span>Based on The Graph records</span>
      </div>
      <p>
        Ask about funding coverage and source freshness. The assistant uses public vault records and
        the approved coverage calculation.
      </p>
      {config.data && !config.data.available && (
        <p className="notice">
          The model is not configured yet. Rule-based coverage decisions remain available below.
        </p>
      )}
      <form onSubmit={submit} className="assistant-question">
        <label>
          Coverage question
          <textarea
            required
            minLength={3}
            maxLength={500}
            rows={3}
            value={question}
            disabled={busy}
            onChange={(e) => {
              setQuestion(e.target.value);
              setRequestKey(crypto.randomUUID());
            }}
          />
        </label>
        <small>
          Use this form for coverage questions. Submit private fixture evidence through the bounty
          form.
        </small>
        <button type="submit" className="primary" disabled={busy || !config.data?.available}>
          {busy ? "Saving question…" : "Ask coverage assistant"}
        </button>
      </form>
      {(error || config.error || history.error || run.error) && (
        <p className="notice error" role="alert">
          {error || config.error || history.error || run.error}
        </p>
      )}
      {!!history.data?.items.length && (
        <label className="assistant-history">
          Saved questions
          <select value={selected ?? ""} onChange={(e) => select(e.target.value)}>
            <option value="">Select a saved question</option>
            {history.data.items.map((r) => (
              <option key={r.id} value={r.id}>
                {r.question} · {r.state}
              </option>
            ))}
          </select>
        </label>
      )}
      {run.loading && <p role="status">Loading the saved answer…</p>}
      {result && (
        <article className="assistant-answer" aria-live="polite">
          <div className="section-heading">
            <h3>{result.question}</h3>
            <span className="pill">{result.state}</span>
          </div>
          {["QUEUED", "RUNNING"].includes(result.state) && (
            <p>
              The assistant is checking the saved source records. This page updates when the answer
              is ready.
            </p>
          )}
          {result.state === "STALE" && (
            <p className="notice">
              This answer uses an older snapshot. Ask again before you review a funding action.
            </p>
          )}
          {result.errorCode && (
            <p role="status">
              {failures[result.errorCode] ??
                "This saved request could not complete. Ask again to create a new request."}
            </p>
          )}
          {result.answer && (
            <>
              <p>{result.answer.summary}</p>
              {result.answer.decisions.map((d) => (
                <div className="coverage-decision" key={d.recommendationId}>
                  <strong>
                    {d.status === "ACTIONABLE"
                      ? "Approved policy available"
                      : d.status === "NO_ACTION"
                        ? "Coverage requirement met"
                        : "Funding action unavailable"}
                  </strong>
                  <p>{d.explanation}</p>
                  <dl>
                    <dt>Required test USDC</dt>
                    <dd>{formatMoney(BigInt(d.minimumReward))}</dd>
                    <dt>Funded test USDC</dt>
                    <dd>{formatMoney(BigInt(d.fundedReward))}</dd>
                    <dt>Coverage gap</dt>
                    <dd>{formatMoney(BigInt(d.coverageGap))} test USDC</dd>
                  </dl>
                  <details>
                    <summary>Sources and calculation</summary>
                    <p>Rule: {d.reasonCode.replaceAll("_", " ").toLowerCase()}</p>
                    {result.snapshot.entries
                      .find((e) => e.recommendationId === d.recommendationId)
                      ?.sources.map((source) => (
                        <div className="assistant-source" key={source.id}>
                          <p className="mono">{source.vault}</p>
                          <p>
                            Observed {new Date(source.observedAt).toLocaleString()} at block{" "}
                            {source.observedBlock}. Indexed head: {source.indexedHead}.
                          </p>
                          <small className="mono">Graph deployment: {source.deploymentId}</small>
                          {source.chainId === "1" && (
                            <a
                              href={`https://etherscan.io/block/${source.observedBlock}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View source block
                            </a>
                          )}
                        </div>
                      ))}
                  </details>
                </div>
              ))}
              <p className="muted">
                {result.snapshot.limitation} Model: {result.responseModel ?? result.requestedModel}.
                The assistant cannot execute a funding action.
              </p>
            </>
          )}
        </article>
      )}
    </section>
  );
}
