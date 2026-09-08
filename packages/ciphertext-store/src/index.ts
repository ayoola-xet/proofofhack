import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, opendir, realpath, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { keccak256 } from "viem";
import { z } from "zod";
import { bytes32, DomainError } from "../../domain/src/index.ts";

export interface CiphertextStore {
  put(id: string, ciphertext: Uint8Array, expectedHash: string): Promise<void>;
  read(id: string, expectedHash: string): Promise<Uint8Array>;
  remove(id: string): Promise<void>;
}
export interface ManagedCiphertextStore extends CiphertextStore {
  location(): Promise<string>;
  inventory(): AsyncIterable<{ id: string; kind: "sealed" | "pending"; modifiedAt: Date }>;
  removePending(id: string): Promise<void>;
}

// Mount separate evidence and report directories with service-specific permissions.
export class FileCiphertextStore implements CiphertextStore {
  constructor(
    private root: string,
    private maxBytes: number,
  ) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 2_000_000)
      throw new Error("Invalid object size limit.");
    this.root = resolve(root);
  }
  private path(id: string) {
    return resolve(this.root, `${z.uuid().parse(id)}.sealed`);
  }
  async location() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    return realpath(this.root);
  }
  async put(id: string, ciphertext: Uint8Array, expectedHash: string) {
    const file = this.path(id);
    const hash = bytes32.parse(expectedHash);
    if (ciphertext.length < 1 || ciphertext.length > this.maxBytes)
      throw new DomainError("EVIDENCE_SIZE", "The encrypted file is too large.", 413);
    if (keccak256(ciphertext) !== hash)
      throw new DomainError(
        "EVIDENCE_INTEGRITY",
        "The encrypted file does not match its commitment.",
        422,
      );
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const staging = resolve(this.root, `${randomUUID()}.pending`);
    const handle = await open(
      staging,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(ciphertext);
      await handle.sync();
      try {
        await link(staging, file);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const previous = await this.read(id, hash);
        if (previous.length !== ciphertext.length)
          throw new DomainError("EVIDENCE_INTEGRITY", "The stored object differs.", 422);
      }
      const directory = await open(this.root, constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } finally {
      await handle.close();
      await unlink(staging);
    }
  }
  async read(id: string, expectedHash: string) {
    const hash = bytes32.parse(expectedHash);
    const handle = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > this.maxBytes)
        throw new DomainError("EVIDENCE_INTEGRITY", "The stored object is invalid.", 422);
      const bytes = new Uint8Array(await handle.readFile());
      if (keccak256(bytes) !== hash)
        throw new DomainError(
          "EVIDENCE_INTEGRITY",
          "The stored object does not match its commitment.",
          422,
        );
      return bytes;
    } finally {
      await handle.close();
    }
  }
  async remove(id: string) {
    await this.removePath(this.path(id));
  }
  async removePending(id: string) {
    await this.removePath(resolve(this.root, `${z.uuid().parse(id)}.pending`));
  }
  private async removePath(path: string) {
    try {
      await unlink(path);
      const directory = await open(this.root, constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  async *inventory() {
    let directory: Awaited<ReturnType<typeof opendir>>;
    try {
      directory = await opendir(this.root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    for await (const entry of directory) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const match = /^(.+)\.(sealed|pending)$/.exec(entry.name);
      if (!match || !z.uuid().safeParse(match[1]).success) continue;
      try {
        const stat = await lstat(resolve(this.root, entry.name));
        yield { id: match[1], kind: match[2] as "sealed" | "pending", modifiedAt: stat.mtime };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}
