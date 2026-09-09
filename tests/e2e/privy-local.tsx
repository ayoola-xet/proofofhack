import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

type Identity = { token: string; subject: string; address: string; displayName: string };
declare global {
  interface Window {
    __PROOFOFHACK_E2E_IDENTITY__?: Identity;
  }
}
type Session = {
  ready: boolean;
  authenticated: boolean;
  login: () => void;
  logout: () => Promise<void>;
  getAccessToken: () => Promise<string | null>;
};
const SessionContext = createContext<Session | null>(null);
export function PrivyProvider({ children }: { children: ReactNode; [key: string]: unknown }) {
  if (!import.meta.env.DEV || !["127.0.0.1", "localhost"].includes(window.location.hostname))
    throw new Error("The local browser identity adapter cannot run here.");
  const identity = window.__PROOFOFHACK_E2E_IDENTITY__;
  if (!identity?.subject.startsWith("local:seed:"))
    throw new Error("A local seed identity is required.");
  const [authenticated, setAuthenticated] = useState(
    () => sessionStorage.getItem("proofofhack-local-e2e-session") === "active",
  );
  const login = useCallback(() => {
    sessionStorage.setItem("proofofhack-local-e2e-session", "active");
    setAuthenticated(true);
  }, []);
  const logout = useCallback(async () => {
    sessionStorage.removeItem("proofofhack-local-e2e-session");
    setAuthenticated(false);
  }, []);
  const getAccessToken = useCallback(
    async () => (authenticated ? identity.token : null),
    [authenticated],
  );
  const session = useMemo(
    () => ({ ready: true, authenticated, login, logout, getAccessToken }),
    [authenticated, login, logout, getAccessToken],
  );
  return (
    <SessionContext.Provider value={session}>
      <div
        role="note"
        style={{ padding: "8px", textAlign: "center", background: "#fff0c2", color: "#31260b" }}
      >
        LOCAL BROWSER TEST · Simulated login · Local chain 31337 · No live sponsor account
      </div>
      {children}
    </SessionContext.Provider>
  );
}
export function usePrivy() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("The local session provider is missing.");
  return session;
}
const unavailable = async () => {
  throw new Error("Live wallet actions are outside this local browser test.");
};
export const useSignMessage = () => ({ signMessage: unavailable });
export const useSendTransaction = () => ({ sendTransaction: unavailable });
export const useCreateWallet = () => ({ createWallet: unavailable });
export const useWallets = () => ({ wallets: [], ready: true });
