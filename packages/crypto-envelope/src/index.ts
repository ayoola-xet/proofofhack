import sodium from "libsodium-wrappers-sumo";
import { keccak256, toHex } from "viem";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  throw new Error(
    "Canonical records accept strings, booleans, null, arrays, and plain objects. Encode integers as strings.",
  );
}
export const hashCanonical = (value: unknown) => keccak256(toHex(canonicalJson(value)));
export async function createEncryptionKeyPair() {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  return {
    publicKey: sodium.to_base64(pair.publicKey),
    privateKey: sodium.to_base64(pair.privateKey),
  };
}
export async function seal(plaintext: Uint8Array, publicKey: string): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_box_seal(plaintext, sodium.from_base64(publicKey));
}
export async function unseal(
  ciphertext: Uint8Array,
  keys: { publicKey: string; privateKey: string },
): Promise<Uint8Array> {
  await sodium.ready;
  return sodium.crypto_box_seal_open(
    ciphertext,
    sodium.from_base64(keys.publicKey),
    sodium.from_base64(keys.privateKey),
  );
}
export async function encryptReport(plaintext: Uint8Array, releasePublicKey: string) {
  await sodium.ready;
  const key = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  try {
    return {
      ciphertext: sodium.to_base64(sodium.crypto_secretbox_easy(plaintext, nonce, key)),
      nonce: sodium.to_base64(nonce),
      wrappedKey: sodium.to_base64(await seal(key, releasePublicKey)),
    };
  } finally {
    sodium.memzero(key);
  }
}
export async function decryptReport(
  envelope: { ciphertext: string; nonce: string; wrappedKey: string },
  releaseKeys: { publicKey: string; privateKey: string },
): Promise<Uint8Array> {
  await sodium.ready;
  const key = await unseal(sodium.from_base64(envelope.wrappedKey), releaseKeys);
  try {
    return sodium.crypto_secretbox_open_easy(
      sodium.from_base64(envelope.ciphertext),
      sodium.from_base64(envelope.nonce),
      key,
    );
  } finally {
    sodium.memzero(key);
  }
}
