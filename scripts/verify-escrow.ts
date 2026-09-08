import "dotenv/config";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { type Address, createPublicClient, type Hash, http, keccak256 } from "viem";

const chainId = 5042002;
const contract = "0x01742711ee569a0186349e54cffe805209808292" as Address;
const transactionHash =
  "0xfb959bbe3be6c7c15afe536412e9c7df9689257a706efd0cab4cbab288282fd0" as Hash;
const asset = "0x3600000000000000000000000000000000000000";
const client = createPublicClient({ transport: http("https://rpc.testnet.arc.io") });
if ((await client.getChainId()) !== chainId) throw new Error("Wrong settlement chain.");
const artifact = JSON.parse(
  await readFile("contracts/out/BountyEscrow.sol/BountyEscrow.json", "utf8"),
);
const receipt = await client.getTransactionReceipt({ hash: transactionHash });
const [block, code, configuredAsset, liability] = await Promise.all([
  client.getBlock({ blockNumber: receipt.blockNumber }),
  client.getCode({ address: contract }),
  client.readContract({ address: contract, abi: artifact.abi, functionName: "asset" }),
  client.readContract({ address: contract, abi: artifact.abi, functionName: "totalLiability" }),
]);
if (
  receipt.status !== "success" ||
  block.hash !== receipt.blockHash ||
  !code ||
  code === "0x" ||
  String(configuredAsset).toLowerCase() !== asset ||
  liability !== 0n
)
  throw new Error("The deployed escrow did not pass its initial checks.");
const evidence = {
  capturedAt: new Date().toISOString(),
  chainId,
  contract,
  asset,
  transactionHash,
  blockNumber: receipt.blockNumber.toString(),
  blockHash: block.hash,
  runtimeCodeHash: keccak256(code),
  totalLiability: String(liability),
  transactionStatus: receipt.status,
  provider: "Circle Agent Stack",
  network: "Arc Testnet",
};
await mkdir("evidence/arc", { recursive: true });
await writeFile("evidence/arc/escrow-deployment.json", `${JSON.stringify(evidence, null, 2)}\n`);
const env = await readFile(".env", "utf8");
const updated = /^ESCROW_ADDRESS=.*$/m.test(env)
  ? env.replace(/^ESCROW_ADDRESS=.*$/m, `ESCROW_ADDRESS=${contract}`)
  : `${env.trimEnd()}\nESCROW_ADDRESS=${contract}\n`;
await writeFile(".env", updated, { mode: 0o600 });
await chmod(".env", 0o600);
process.stdout.write(
  "Arc escrow receipt, canonical block, deployed code, USDC asset, and zero initial liability verified.\n",
);
