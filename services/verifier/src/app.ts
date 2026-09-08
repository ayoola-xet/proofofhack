import { z } from "zod";
import { bytes32 } from "../../../packages/domain/src/index.ts";
import { internalService } from "../../../packages/service-auth/src/http.ts";
import type { FixtureVerifier } from "./process.ts";
export function createVerifierApp(verifier: FixtureVerifier, workerPublicKey: string) {
  const app = internalService("verifier", { worker: workerPublicKey });
  app.post("/internal/admissions", async (request) =>
    verifier.admit(z.strictObject({ claimId: bytes32 }).parse(request.body).claimId),
  );
  app.post("/internal/assessments", async (request) =>
    verifier.assess(z.strictObject({ claimId: bytes32 }).parse(request.body).claimId),
  );
  return app;
}
