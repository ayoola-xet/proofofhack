import { z } from "zod";
import { bytes32 } from "../../../packages/domain/src/index.ts";
import { internalService } from "../../../packages/service-auth/src/http.ts";

export type ClaimVerifier = {
  admit(claimId: string): Promise<{ payload: unknown; signature: unknown }>;
  assess(claimId: string): Promise<{ payload: unknown; signature: unknown }>;
};
export function createVerifierApp(
  verifier: ClaimVerifier,
  workerPublicKey: string,
  name = "verifier",
) {
  const app = internalService(name, { worker: workerPublicKey });
  app.post("/internal/admissions", async (request) =>
    verifier.admit(z.strictObject({ claimId: bytes32 }).parse(request.body).claimId),
  );
  app.post("/internal/assessments", async (request) =>
    verifier.assess(z.strictObject({ claimId: bytes32 }).parse(request.body).claimId),
  );
  return app;
}
