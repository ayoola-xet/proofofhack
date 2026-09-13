import { Sandbox } from "@vercel/sandbox";
import { encodeAbiParameters, type Hex, keccak256, parseAbiParameters } from "viem";
import { arcClient, arcTestnet } from "../../../packages/chain/src/arc.ts";
import { hashCanonical } from "../../../packages/crypto-envelope/src/index.ts";
import {
  bytes32,
  FINDING_EVIDENCE_SCOPE,
  FINDING_VERIFIER_MODE,
  type FindingEvidence,
  findingEvidenceSchema,
  GENERAL_FINDING_ADAPTER_ID,
  hashPolicy,
  policySchema,
  severity as severitySchema,
} from "../../../packages/domain/src/index.ts";

export type SandboxResult = {
  ran: boolean;
  passed: boolean;
  touchedScope: boolean;
  simulated: boolean;
  logs: string;
  measuredImpact: bigint | null;
};

export type AiVerdict = {
  valid: boolean;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  reasoning: string;
  confidence: number;
};

const IMPACT_LOG_PATTERN = /PROOFOFHACK_IMPACT_USDC\s+(\d+)/;
// The Vercel Sandbox runtime is linux/x86_64 (Amazon Linux).
const ARC_FOUNDRY_RELEASE_URL =
  "https://github.com/circlefin/arc-foundry/releases/download/v0.8.0-1/arc-foundry-v0.8.0-1-x86_64-unknown-linux-gnu.tar.gz";

function sandboxCredentials() {
  const token = process.env.VERCEL_TOKEN,
    teamId = process.env.VERCEL_TEAM_ID,
    projectId = process.env.VERCEL_PROJECT_ID;
  return token && teamId && projectId ? { token, teamId, projectId } : {};
}

/** Stands in for real sandbox execution ONLY when FINDING_SANDBOX_SIMULATE=true.
 * This exists because Arc requires a patched Foundry build ("Arc Foundry") to
 * fork its custom native-USDC precompiles, and no build of it compatible with
 * the sandbox's glibc is available yet — see the comment in runSandboxPoc. It
 * does NOT execute the PoC. It checks (via plain string matching, not a trace)
 * whether the PoC even references the in-scope address, and otherwise defers
 * entirely to the AI judge, which still makes a real, live model call. This
 * must never silently become the default: the moment a compatible arc-forge
 * binary exists, unset FINDING_SANDBOX_SIMULATE and delete this function. */
async function simulateSandboxPoc(
  evidence: FindingEvidence,
  scopeAddress: Hex,
): Promise<SandboxResult> {
  const touchedScope = evidence.pocCode.toLowerCase().includes(scopeAddress.toLowerCase());
  return {
    ran: true,
    passed: touchedScope,
    touchedScope,
    simulated: true,
    logs: "SIMULATED: sandbox execution was not actually performed (FINDING_SANDBOX_SIMULATE=true). This checked only whether the PoC source text references the in-scope address; it did not run the PoC or measure a real impact. The AI judge's verdict below is a real, live call.",
    measuredImpact: null,
  };
}

/** Runs a submitted Foundry PoC test in an isolated Vercel Sandbox microVM, forked
 * from the verifier's own trusted Arc testnet RPC so the PoC runs against real
 * on-chain state, and checks that it actually interacted with the in-scope
 * contract rather than exploiting an unrelated, self-deployed mock. Also extracts
 * any measured USDC impact the PoC reports via a console2.log convention. */
export async function runSandboxPoc(
  evidence: FindingEvidence,
  scopeAddress: Hex,
  forkBlockNumber?: string,
): Promise<SandboxResult> {
  if (evidence.pocLanguage === "none" || !evidence.pocCode.trim())
    return {
      ran: false,
      passed: false,
      touchedScope: false,
      simulated: false,
      logs: "",
      measuredImpact: null,
    };
  if (process.env.FINDING_SANDBOX_SIMULATE === "true")
    return simulateSandboxPoc(evidence, scopeAddress);
  let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | undefined;
  try {
    sandbox = await Sandbox.create({
      ...sandboxCredentials(),
      runtime: "node24",
      timeout: 180_000,
    });
  } catch (error) {
    return {
      ran: false,
      passed: false,
      touchedScope: false,
      simulated: false,
      logs: error instanceof Error ? error.message : "The sandbox environment is unavailable.",
      measuredImpact: null,
    };
  }
  try {
    const block = forkBlockNumber ?? String(await arcClient().getBlockNumber());
    // Vanilla Foundry cannot fork Arc: Arc has custom native-USDC precompiles
    // (e.g. the address the ERC20 view proxies to) that vanilla revm doesn't
    // know about and fails to execute, reverting every token transfer on a
    // fork regardless of whether the submitted exploit is real. Arc's own
    // patched Foundry build ("Arc Foundry") adds that precompile support.
    await sandbox.runCommand("sh", [
      "-c",
      [
        `curl -sL -o /tmp/arc-foundry.tar.gz ${ARC_FOUNDRY_RELEASE_URL}`,
        "mkdir -p ~/.local/bin",
        "tar -xzf /tmp/arc-foundry.tar.gz -C /tmp",
        "mv /tmp/forge ~/.local/bin/arc-forge",
        "mv /tmp/cast ~/.local/bin/arc-cast",
        "mv /tmp/anvil ~/.local/bin/arc-anvil",
        "chmod +x ~/.local/bin/arc-forge ~/.local/bin/arc-cast ~/.local/bin/arc-anvil",
      ].join(" && "),
    ]);
    await sandbox.runCommand("mkdir", ["-p", "poc/src", "poc/test"]);
    const configHeredoc = [
      "cat > poc/foundry.toml << 'PROOFOFHACK_EOF'",
      "[profile.default]",
      "src = 'src'",
      "out = 'out'",
      "libs = ['lib']",
      "[profile.arc]",
      "network = 'arc'",
      "PROOFOFHACK_EOF",
    ].join("\n");
    await sandbox.runCommand("sh", ["-c", `cd poc && ${configHeredoc}`]);
    const testHeredoc = [
      "cat > poc/test/Poc.t.sol << 'PROOFOFHACK_EOF'",
      evidence.pocCode,
      "PROOFOFHACK_EOF",
    ].join("\n");
    await sandbox.runCommand("sh", ["-c", testHeredoc]);
    await sandbox.runCommand("sh", [
      "-c",
      "cd poc && ~/.local/bin/arc-forge install foundry-rs/forge-std --no-commit || true",
    ]);
    const rpc = arcTestnet.rpcUrls.default.http[0];
    const result = await sandbox.runCommand("sh", [
      "-c",
      `cd poc && FOUNDRY_PROFILE=arc ~/.local/bin/arc-forge test --fork-url '${rpc}' --fork-block-number ${block} --json -vvvvv 2>&1 || true`,
    ]);
    const logs = await result.stdout();
    const passed = /"success":\s*true/.test(logs) && !/"success":\s*false/.test(logs);
    const touchedScope = logs.toLowerCase().includes(scopeAddress.toLowerCase());
    const match = logs.match(IMPACT_LOG_PATTERN);
    return {
      ran: true,
      passed,
      touchedScope,
      simulated: false,
      logs: logs.slice(0, 20000),
      measuredImpact: match ? BigInt(match[1]) : null,
    };
  } catch (error) {
    return {
      ran: true,
      passed: false,
      touchedScope: false,
      simulated: false,
      logs: error instanceof Error ? error.message : "Sandbox execution failed.",
      measuredImpact: null,
    };
  } finally {
    await sandbox?.stop();
  }
}

/** Asks a free OpenRouter model to sanity-check validity and assign a severity
 * when the sandbox alone can't produce a conclusive measured impact. */
export async function judgeWithAI(
  evidence: FindingEvidence,
  sandbox: SandboxResult,
  affectedComponent: string,
  scopeAddress: Hex,
): Promise<AiVerdict> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey)
    return {
      valid: false,
      severity: "LOW",
      reasoning: "OPENROUTER_API_KEY is not configured; cannot render an AI verdict.",
      confidence: 0,
    };
  const model = process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-super-120b-a12b:free";
  const prompt = [
    "You are a smart contract security triage assistant for a bug bounty platform.",
    "Judge whether the submitted finding is a real, valid vulnerability and assign a severity.",
    `In-scope contract address: ${scopeAddress}. Only findings that plausibly affect this exact contract qualify.`,
    `Affected component: ${affectedComponent}`,
    `Researcher write-up:\n${evidence.writeup}`,
    evidence.pocLanguage === "solidity-foundry"
      ? `Proof-of-concept source:\n${evidence.pocCode}`
      : "No executable proof of concept was submitted.",
    sandbox.simulated
      ? "Sandbox execution was NOT actually performed for this submission (known infrastructure gap, not a statement about this PoC). Judge this submission on the write-up and PoC source alone."
      : sandbox.ran
        ? `Sandbox execution result: ${sandbox.passed ? "the PoC test passed" : "the PoC test did not pass"} on a fork of the real chain at the in-scope address. The PoC ${sandbox.touchedScope ? "did" : "did NOT"} interact with the in-scope contract address during execution.${
            sandbox.measuredImpact !== null
              ? ` Measured impact: ${sandbox.measuredImpact} (base units).`
              : ""
          }`
        : "No sandbox execution was run.",
    "",
    'Respond with ONLY a JSON object: {"valid": boolean, "severity": "CRITICAL"|"HIGH"|"MEDIUM"|"LOW", "reasoning": string, "confidence": number between 0 and 1}.',
  ].join("\n\n");
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });
  if (!response.ok)
    return {
      valid: false,
      severity: "LOW",
      reasoning: `The AI judge is unavailable (HTTP ${response.status}).`,
      confidence: 0,
    };
  const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(jsonMatch?.[0] ?? text);
    return {
      valid: Boolean(parsed.valid),
      severity: severitySchema.parse(parsed.severity),
      reasoning: String(parsed.reasoning ?? "").slice(0, 4000),
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    };
  } catch {
    return {
      valid: false,
      severity: "LOW",
      reasoning: "The AI judge returned a response that could not be parsed.",
      confidence: 0,
    };
  }
}

const severityFraction: Record<string, number> = {
  CRITICAL: 1,
  HIGH: 0.6,
  MEDIUM: 0.3,
  LOW: 0.1,
};

export type FindingAssessors = {
  runSandbox: typeof runSandboxPoc;
  judgeAi: typeof judgeWithAI;
};
const defaultAssessors: FindingAssessors = { runSandbox: runSandboxPoc, judgeAi: judgeWithAI };

export async function assessFinding(
  evidenceInput: unknown,
  policyInput: unknown,
  context: { claimId: Hex; bountyId: Hex; assessedAt: bigint },
  tier: { minReward: bigint; maxReward: bigint },
  affectedComponent: string,
  assessors: FindingAssessors = defaultAssessors,
) {
  const evidence = findingEvidenceSchema.parse(evidenceInput);
  const policy = policySchema.parse(policyInput);
  if (hashPolicy(policy) !== context.bountyId) throw new Error("Policy commitment mismatch.");
  if (policy.adapterId !== GENERAL_FINDING_ADAPTER_ID)
    throw new Error("Unsupported finding adapter.");
  const scopeAddress = policy.sourceVault;
  const sandbox = await assessors.runSandbox(evidence, scopeAddress, evidence.forkBlockNumber);
  const ai = await assessors.judgeAi(evidence, sandbox, affectedComponent, scopeAddress);
  // A submitted PoC that never interacts with the real in-scope contract is
  // rejected outright, regardless of what the AI judge thinks: it demonstrates
  // nothing about the actual target and is a strong sign of a fabricated exploit
  // against an unrelated, self-deployed mock.
  const pocSubmitted = evidence.pocLanguage === "solidity-foundry" && sandbox.ran;
  const scopeViolation = pocSubmitted && !sandbox.touchedScope;
  const sandboxConfident =
    sandbox.ran && sandbox.passed && sandbox.touchedScope && sandbox.measuredImpact !== null;
  const valid = !scopeViolation && (sandboxConfident || ai.valid);
  let reward = 0n;
  let severityOut: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" = ai.severity;
  if (valid) {
    if (sandboxConfident && sandbox.measuredImpact !== null) {
      const capped =
        sandbox.measuredImpact > tier.maxReward ? tier.maxReward : sandbox.measuredImpact;
      reward = capped < tier.minReward ? tier.minReward : capped;
      severityOut = ai.severity;
    } else {
      const fraction = Math.max(severityFraction[ai.severity] ?? 0.1, 0.1) * ai.confidence;
      const span = tier.maxReward - tier.minReward;
      reward = tier.minReward + (span * BigInt(Math.round(fraction * 1000))) / 1000n;
    }
    if (reward > tier.maxReward) reward = tier.maxReward;
    if (reward < tier.minReward) reward = tier.minReward;
  }
  const outcome = valid ? "QUALIFIES" : "DOES_NOT_QUALIFY";
  const report = {
    schemaVersion: "1",
    evidenceScope: FINDING_EVIDENCE_SCOPE,
    verifierMode: FINDING_VERIFIER_MODE,
    claimId: bytes32.parse(context.claimId),
    bountyId: bytes32.parse(context.bountyId),
    policyHash: context.bountyId,
    affectedComponent,
    writeup: evidence.writeup,
    pocLanguage: evidence.pocLanguage,
    pocCode: evidence.pocCode,
    scopeAddress,
    scopeViolation,
    sandbox: {
      ran: sandbox.ran,
      passed: sandbox.passed,
      touchedScope: sandbox.touchedScope,
      logs: sandbox.logs,
    },
    aiVerdict: {
      valid: ai.valid,
      severity: ai.severity,
      reasoning: ai.reasoning,
      confidence: ai.confidence.toString(),
    },
    measuredImpact: sandbox.measuredImpact?.toString() ?? null,
    outcome,
    severity: valid ? severityOut : null,
    reward: reward.toString(),
    assessedAt: context.assessedAt.toString(),
    limitation:
      "This verdict was produced automatically by sandbox execution and AI review, without human triage.",
  };
  return {
    report,
    reportHash: hashCanonical(report),
    caseNullifier: keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, bytes32"), [
        context.bountyId,
        bytes32.parse(context.claimId),
      ]),
    ),
    reward,
    valid,
    severity: valid ? severityOut : null,
    measuredImpact: sandbox.measuredImpact,
  };
}
