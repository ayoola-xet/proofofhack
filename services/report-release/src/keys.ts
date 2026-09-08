import { constants } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { keccak256, toHex } from "viem";
import { z } from "zod";
import { createEncryptionKeyPair } from "../../../packages/crypto-envelope/src/index.ts";
import { bytes32 } from "../../../packages/domain/src/index.ts";
import { first } from "../../api/src/context.ts";

export class OrganizationKeyStore {
  constructor(private directory: string) {
    this.directory = resolve(directory);
  }
  async read(keyId: string) {
    const file = await open(
      resolve(this.directory, `${bytes32.parse(keyId)}.json`),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stats = await file.stat();
      if (!stats.isFile() || stats.size > 4096 || (stats.mode & 0o077) !== 0)
        throw new Error("Report keys require private file permissions.");
      return z
        .strictObject({
          testnetOnly: z.literal(true),
          organizationId: z.uuid(),
          keyId: bytes32,
          publicKey: z.string(),
          privateKey: z.string(),
        })
        .parse(JSON.parse(await file.readFile("utf8")));
    } finally {
      await file.close();
    }
  }
  async ensure(pool: Pool, organizationId: string) {
    z.uuid().parse(organizationId);
    const c = await pool.connect();
    try {
      await c.query("begin");
      await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
        `report-key:${organizationId}`,
      ]);
      await first(c, "select id from organizations where id=$1", [organizationId]);
      const existing = (
        await c.query(
          "select key_id,public_key from organization_keys where organization_id=$1 and status='ACTIVE'",
          [organizationId],
        )
      ).rows[0];
      if (existing) {
        const key = await this.read(existing.key_id);
        if (key.organizationId !== organizationId || key.publicKey !== existing.public_key)
          throw new Error("Organization report key mismatch.");
        await c.query("commit");
        return {
          keyId: existing.key_id as `0x${string}`,
          publicKey: existing.public_key as string,
        };
      }
      const pair = await createEncryptionKeyPair();
      const keyId = keccak256(toHex(pair.publicKey));
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const file = await open(
        resolve(this.directory, `${keyId}.json`),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await file.writeFile(JSON.stringify({ testnetOnly: true, organizationId, keyId, ...pair }));
        await file.sync();
      } finally {
        await file.close();
      }
      const directory = await open(this.directory, constants.O_RDONLY);
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      const saved = await this.read(keyId);
      if (saved.publicKey !== pair.publicKey) throw new Error("Report key read-back failed.");
      await c.query(
        "insert into organization_keys(key_id,organization_id,public_key) values($1,$2,$3)",
        [keyId, organizationId, pair.publicKey],
      );
      await c.query("commit");
      return { keyId, publicKey: pair.publicKey };
    } catch (error) {
      await c.query("rollback");
      throw error;
    } finally {
      c.release();
    }
  }
}
