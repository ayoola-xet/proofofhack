import { PrivyClient } from "@privy-io/node";
import { address, DomainError } from "../../domain/src/index.ts";
export type VerifiedWallet = { providerWalletId: string; address: string };
export interface WalletIdentityProvider {
  userWallets(subject: string): Promise<VerifiedWallet[]>;
}
export class PrivyWalletIdentity implements WalletIdentityProvider {
  private client: PrivyClient;
  constructor(appId: string, appSecret: string) {
    this.client = new PrivyClient({ appId, appSecret, timeout: 15000, maxRetries: 1 });
  }
  async userWallets(subject: string): Promise<VerifiedWallet[]> {
    if (!subject.startsWith("did:privy:"))
      throw new DomainError("UNAUTHENTICATED", "Use a Privy account.", 401);
    const user = await this.client.users()._get(subject);
    if (user.id !== subject)
      throw new DomainError("PROVIDER_MISMATCH", "The wallet owner cannot be verified.", 503);
    return user.linked_accounts.flatMap((account) => {
      if (
        account.type !== "wallet" ||
        account.chain_type !== "ethereum" ||
        account.wallet_client_type !== "privy" ||
        !("id" in account) ||
        !account.id
      )
        return [];
      return [{ providerWalletId: account.id, address: address.parse(account.address) }];
    });
  }
}
