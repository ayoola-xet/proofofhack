import { keccak256 } from "viem";
export function verifyReportBytes(bytes: Uint8Array, expectedHash: string) {
  if (
    !/^0x[0-9a-fA-F]{64}$/.test(expectedHash) ||
    bytes.length > 1048576 ||
    keccak256(bytes) !== expectedHash.toLowerCase()
  )
    throw new Error("The downloaded report does not match its saved hash. No file was saved.");
}
