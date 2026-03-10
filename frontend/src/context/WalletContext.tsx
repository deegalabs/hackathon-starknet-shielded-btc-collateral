import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { connect, disconnect as getStarknetDisconnect } from "@starknet-io/get-starknet";
import { WebWalletConnector } from "starknetkit/webwallet";
import { Contract, RpcProvider, type AccountInterface, type Abi } from "starknet";
import { RPC_URL, CONTRACTS } from "@/lib/config";
import {
  VAULT_ABI,
  ERC20_ABI,
  LENDING_ABI,
  PAYMASTER_ABI,
  SESSION_KEY_MANAGER_ABI,
} from "@/lib/abis";

export type ConnectMethod = "extension" | "email" | "shielded" | null;

interface WalletContextType {
  account: AccountInterface | null;
  address: string | null;
  isConnecting: boolean;
  isConnected: boolean;
  walletName: string | null;
  connectMethod: ConnectMethod;
  provider: RpcProvider;
  contracts: {
    vault: Contract | null;
    wbtc: Contract | null;
    lending: Contract | null;
    paymaster: Contract | null;
    skm: Contract | null;
  };
  /** Connect Argent X / Braavos browser extension */
  connectExtension: () => Promise<void>;
  /** Connect via email / passkey using Argent Web Wallet (no install needed) */
  connectEmail: () => Promise<void>;
  /**
   * Switch the active account to a deployed ShieldedAccount.
   * Called by AccountSetup after a successful deploy.
   */
  switchToShieldedAccount: (account: AccountInterface, address: string) => void;
  disconnect: () => Promise<void>;
}

const provider = new RpcProvider({ nodeUrl: RPC_URL });

const WalletContext = createContext<WalletContextType>({
  account: null,
  address: null,
  isConnecting: false,
  isConnected: false,
  walletName: null,
  connectMethod: null,
  provider,
  contracts: { vault: null, wbtc: null, lending: null, paymaster: null, skm: null },
  connectExtension: async () => {},
  connectEmail: async () => {},
  switchToShieldedAccount: () => {},
  disconnect: async () => {},
});

function makeContract(
  abi: Abi,
  address: string,
  signerOrProvider: AccountInterface | RpcProvider,
): Contract | null {
  if (!address) return null;
  return new Contract({ abi, address, providerOrAccount: signerOrProvider });
}

function buildContracts(signerOrProvider: AccountInterface | RpcProvider) {
  return {
    vault: makeContract(VAULT_ABI as unknown as Abi, CONTRACTS.VAULT, signerOrProvider),
    wbtc: makeContract(ERC20_ABI as unknown as Abi, CONTRACTS.WBTC, signerOrProvider),
    lending: makeContract(LENDING_ABI as unknown as Abi, CONTRACTS.LENDING, signerOrProvider),
    paymaster: makeContract(PAYMASTER_ABI as unknown as Abi, CONTRACTS.PAYMASTER, signerOrProvider),
    skm: makeContract(SESSION_KEY_MANAGER_ABI as unknown as Abi, CONTRACTS.SESSION_KEY_MANAGER, signerOrProvider),
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountInterface | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [connectMethod, setConnectMethod] = useState<ConnectMethod>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [contracts, setContracts] = useState(() => buildContracts(provider));

  useEffect(() => {
    setContracts(buildContracts(account ?? provider));
  }, [account]);

  /** Connect Argent X / Braavos extension via get-starknet */
  const connectExtension = useCallback(async () => {
    setIsConnecting(true);
    try {
      // alwaysAsk: shows the wallet picker modal — user explicitly chose to connect
      // include: only show known Starknet wallets to prevent MetaMask snap from appearing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wallet = await connect({
        modalMode: "alwaysAsk",
        include: ["argentX", "braavos", "argentMobile"],
      }) as any;
      if (!wallet) return;

      // get-starknet v4: wallet may not be enabled yet — call enable() to
      // trigger the permission popup and populate wallet.account
      if (!wallet.account || !wallet.isConnected) {
        await wallet.enable({ starknetVersion: "v5" }).catch(() => wallet.enable());
      }

      const acc = wallet.account;
      const addr = wallet.selectedAddress ?? acc?.address;
      if (!acc || !addr) return;

      setAccount(acc as AccountInterface);
      setAddress(addr as string);
      setWalletName((wallet.name ?? "Wallet") as string);
      setConnectMethod("extension");
      // Use our own key (different from get-starknet's internal gsw-last-wallet)
      // to avoid collisions with the library's own auto-reconnect logic
      localStorage.setItem("shielded-btc-last-wallet", wallet.id ?? wallet.name ?? "extension");
    } catch (err) {
      console.error("Extension wallet connect failed:", err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * Connect via email / passkey using Argent Web Wallet.
   * Calls the WebWalletConnector directly — bypasses the starknetkit modal
   * which has a version mismatch (starknetkit v3 expects starknet@^8).
   * The connector opens the Argent Web Wallet popup on its own.
   */
  const connectEmail = useCallback(async () => {
    setIsConnecting(true);
    try {
      const webWalletConnector = new WebWalletConnector({
        url: "https://web.argent.xyz",
      });

      const connectorData = await webWalletConnector.connect();
      if (!connectorData?.account) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc = await (webWalletConnector as any).account(provider) as AccountInterface;
      if (!acc) return;

      setAccount(acc);
      setAddress(connectorData.account);
      setWalletName("Argent Web Wallet");
      setConnectMethod("email");
    } catch (err) {
      console.error("Email wallet connect failed:", err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * Called by AccountSetup after deploying a ShieldedAccount.
   * Replaces the active account so all hooks (useVault, useLending, …) use
   * the protocol-native smart contract account from this point on.
   */
  const switchToShieldedAccount = useCallback(
    (shieldedAcc: AccountInterface, shieldedAddr: string) => {
      setAccount(shieldedAcc);
      setAddress(shieldedAddr);
      setWalletName("ShieldedAccount");
      setConnectMethod("shielded");
    },
    [],
  );

  const handleDisconnect = useCallback(async () => {
    try {
      await getStarknetDisconnect({ clearLastWallet: true });
    } catch {
      // starknetkit may manage its own disconnect
    }
    localStorage.removeItem("shielded-btc-last-wallet");
    // Also clear get-starknet's internal key in case it was set
    localStorage.removeItem("gsw-last-wallet");
    setAccount(null);
    setAddress(null);
    setWalletName(null);
    setConnectMethod(null);
    setContracts(buildContracts(provider));
  }, []);

  // Auto-reconnect only if user explicitly connected before (our own key, not get-starknet's)
  // We use "shielded-btc-last-wallet" to avoid collisions with the library's gsw-last-wallet,
  // which could cause silent reconnects and MetaMask popup on fresh page loads.
  useEffect(() => {
    const lastWallet = localStorage.getItem("shielded-btc-last-wallet");
    if (!lastWallet) return;

    (async () => {
      try {
        // neverAsk: silently attempt reconnect, never show a modal or popup
        // include: only Starknet-native wallets — prevents MetaMask Snap from triggering
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wallet = await connect({
          modalMode: "neverAsk",
          include: ["argentX", "braavos", "argentMobile"],
        }) as any;
        if (!wallet) return;

        // Do NOT call wallet.enable() in silent reconnect — it can trigger
        // permission popups. Only reconnect if the wallet is already authorized.
        if (!wallet.isConnected || !wallet.account) {
          // Previously connected wallet is no longer authorized — clear stored key
          localStorage.removeItem("shielded-btc-last-wallet");
          return;
        }

        const acc = wallet.account;
        const addr = wallet.selectedAddress ?? acc?.address;
        if (acc && addr) {
          setAccount(acc as AccountInterface);
          setAddress(addr as string);
          setWalletName((wallet.name ?? "Wallet") as string);
          setConnectMethod("extension");
        }
      } catch {
        // Wallet no longer available — clear stale key
        localStorage.removeItem("shielded-btc-last-wallet");
      }
    })();
  }, []);

  return (
    <WalletContext.Provider
      value={{
        account,
        address,
        isConnecting,
        isConnected: !!account,
        walletName,
        connectMethod,
        provider,
        contracts,
        connectExtension,
        connectEmail,
        switchToShieldedAccount,
        disconnect: handleDisconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
