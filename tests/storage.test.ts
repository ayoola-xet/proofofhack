import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { keccak256 } from "viem";
import { describe, expect, it } from "vitest";
import { FileCiphertextStore } from "../packages/ciphertext-store/src/index.ts";
import { serviceToken, verifyServiceToken } from "../packages/service-auth/src/index.ts";

describe("Bounded confidential storage", () => {
  it("Checks integrity, repeat writes, path isolation, and deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "vulnproof-store-"));
    const store = new FileCiphertextStore(root, 256);
    const id = randomUUID();
    const bytes = new Uint8Array([4, 8, 15, 16, 23, 42]);
    const hash = keccak256(bytes);
    try {
      await Promise.all(Array.from({ length: 8 }, () => store.put(id, bytes, hash)));
      await store.put(id, bytes, hash);
      expect(await store.read(id, hash)).toEqual(bytes);
      await expect(store.read("../../etc/passwd", hash)).rejects.toThrow();
      await expect(
        store.put(id, new Uint8Array([1]), keccak256(new Uint8Array([1]))),
      ).rejects.toThrow();
      await expect(store.put(randomUUID(), new Uint8Array(257), hash)).rejects.toThrow();
      const linkId = randomUUID();
      await symlink(join(root, `${id}.sealed`), join(root, `${linkId}.sealed`));
      await expect(store.read(linkId, hash)).rejects.toThrow();
      await store.remove(id);
      await store.remove(id);
      await expect(readFile(join(root, `${id}.sealed`))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("Binds internal service requests to their signer and audience", async () => {
    const pair = await generateKeyPair("EdDSA", { extractable: true });
    const other = await generateKeyPair("EdDSA", { extractable: true });
    const privateKey = await exportPKCS8(pair.privateKey);
    const publicKey = await exportSPKI(pair.publicKey);
    const token = await serviceToken(privateKey, "settlement-worker", "report-release");
    expect(
      (await verifyServiceToken(token, publicKey, "settlement-worker", "report-release")).aud,
    ).toBe("report-release");
    await expect(
      verifyServiceToken(token, publicKey, "settlement-worker", "verifier"),
    ).rejects.toThrow();
    await expect(
      verifyServiceToken(
        token,
        await exportSPKI(other.publicKey),
        "settlement-worker",
        "report-release",
      ),
    ).rejects.toThrow();
    await expect(
      verifyServiceToken("invalid", publicKey, "settlement-worker", "report-release"),
    ).rejects.toThrow();
  });
});
