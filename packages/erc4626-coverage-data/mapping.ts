import { dataSource, ethereum, BigInt as GraphBigInt } from "@graphprotocol/graph-ts";
import { Deposit, ERC4626, Withdraw } from "./generated/SavingsDAI/ERC4626";
import { SourceCursor, Vault, VaultFlow, VaultObservation } from "./generated/schema";

function observe(block: ethereum.Block): Vault {
  const address = dataSource.address();
  const chainId = dataSource.context().getString("chainId");
  const id = `${chainId}:${address.toHexString()}`;
  let vault = Vault.load(id);
  if (vault == null) {
    vault = new Vault(id);
    vault.chainId = GraphBigInt.fromString(chainId);
    vault.address = address;
    vault.firstObservedBlock = block.number;
    vault.implementationLabel = dataSource.context().getString("implementationLabel");
  }
  const contract = ERC4626.bind(address);
  const asset = contract.try_asset();
  const shareDecimals = contract.try_decimals();
  if (!asset.reverted) {
    vault.asset = asset.value;
    const decimals = ERC4626.bind(asset.value).try_decimals();
    if (!decimals.reverted) vault.assetDecimals = decimals.value;
  }
  if (!shareDecimals.reverted) vault.shareDecimals = shareDecimals.value;
  const observationId = `${id}:${block.number.toString()}`;
  if (VaultObservation.load(observationId) == null) {
    const observation = new VaultObservation(observationId);
    observation.vault = id;
    observation.blockNumber = block.number;
    observation.blockHash = block.hash;
    observation.blockTimestamp = block.timestamp;
    observation.schemaVersion = "1";
    const assets = contract.try_totalAssets();
    const supply = contract.try_totalSupply();
    if (!assets.reverted) observation.totalAssets = assets.value;
    if (!supply.reverted) observation.totalSupply = supply.value;
    observation.readStatus =
      assets.reverted || supply.reverted || asset.reverted || shareDecimals.reverted
        ? "PARTIAL"
        : "OK";
    observation.save();
  }
  vault.latestObservation = observationId;
  vault.save();
  const cursor = new SourceCursor(chainId);
  cursor.chainId = GraphBigInt.fromString(chainId);
  cursor.blockNumber = block.number;
  cursor.blockHash = block.hash;
  cursor.blockTimestamp = block.timestamp;
  cursor.save();
  return vault;
}
export function handleBlock(block: ethereum.Block): void {
  observe(block);
}
export function handleDeposit(event: Deposit): void {
  const vault = observe(event.block);
  const flow = new VaultFlow(
    `${vault.chainId.toString()}:${event.transaction.hash.toHexString()}:${event.logIndex.toString()}`,
  );
  flow.vault = vault.id;
  flow.kind = "DEPOSIT";
  flow.sender = event.params.sender;
  flow.owner = event.params.owner;
  flow.receiver = event.params.owner;
  flow.assets = event.params.assets;
  flow.shares = event.params.shares;
  flow.transactionHash = event.transaction.hash;
  flow.logIndex = event.logIndex;
  flow.blockNumber = event.block.number;
  flow.save();
}
export function handleWithdraw(event: Withdraw): void {
  const vault = observe(event.block);
  const flow = new VaultFlow(
    `${vault.chainId.toString()}:${event.transaction.hash.toHexString()}:${event.logIndex.toString()}`,
  );
  flow.vault = vault.id;
  flow.kind = "WITHDRAWAL";
  flow.sender = event.params.sender;
  flow.owner = event.params.owner;
  flow.receiver = event.params.receiver;
  flow.assets = event.params.assets;
  flow.shares = event.params.shares;
  flow.transactionHash = event.transaction.hash;
  flow.logIndex = event.logIndex;
  flow.blockNumber = event.block.number;
  flow.save();
}
