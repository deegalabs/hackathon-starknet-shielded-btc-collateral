import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { connect, disconnect as getStarknetDisconnect } from "@starknet-io/get-starknet";
import { connect as starknetkitConnect } from "starknetkit";
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

export type ConnectMethod = "extension" | "email" | null;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wallet = await connect({ modalMode: "alwaysAsk" }) as any;
      if (!wallet?.account) return;
      setAccount(wallet.account as AccountInterface);
      setAddress((wallet.selectedAddress ?? wallet.account.address) as string);
      setWalletName((wallet.name ?? "Wallet") as string);
      setConnectMethod("extension");
    } catch (err) {
      console.error("Extension wallet connect failed:", err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  /**
   * Connect via email / passkey using Argent Web Wallet.
   * No browser extension needed — perfect for BTC holders new to Starknet.
   */
  const connectEmail = useCallback(async () => {
    setIsConnecting(true);
    try {
      const { connector, connectorData } = await starknetkitConnect({
        connectors: [
          new WebWalletConnector({ url: "https://web.argent.xyz" }),
        ],
        modalMode: "alwaysAsk",
        dappName: "Shielded BTC Collateral",
      });

      if (!connector || !connectorData?.account) return;

      // Get the starknet.js AccountInterface from the connector
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const acc = await (connector as any).account(provider) as AccountInterface;
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

  const handleDisconnect = useCallback(async () => {
    try {
      await getStarknetDisconnect({ clearLastWallet: true });
    } catch {
      // starknetkit may manage its own disconnect
    }
    setAccount(null);
    setAddress(null);
    setWalletName(null);
    setConnectMethod(null);
    setContracts(buildContracts(provider));
  }, []);

  // Auto-reconnect extension wallet on page load
  useEffect(() => {
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wallet = await connect({ modalMode: "neverAsk" }) as any;
        if (wallet?.account) {
          setAccount(wallet.account as AccountInterface);
          setAddress((wallet.selectedAddress ?? wallet.account.address) as string);
          setWalletName((wallet.name ?? "Wallet") as string);
          setConnectMethod("extension");
        }
      } catch {
        // No wallet previously connected
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
