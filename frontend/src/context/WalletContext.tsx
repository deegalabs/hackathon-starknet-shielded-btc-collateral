import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { connect, disconnect as getStarknetDisconnect } from "@starknet-io/get-starknet";
import { Contract, RpcProvider, type AccountInterface } from "starknet";
import { RPC_URL, CONTRACTS } from "@/lib/config";
import {
  VAULT_ABI,
  ERC20_ABI,
  LENDING_ABI,
  PAYMASTER_ABI,
  SESSION_KEY_MANAGER_ABI,
} from "@/lib/abis";

interface WalletContextType {
  account: AccountInterface | null;
  address: string | null;
  isConnecting: boolean;
  isConnected: boolean;
  walletName: string | null;
  provider: RpcProvider;
  // Contract handles (read from provider, write from account)
  contracts: {
    vault: Contract | null;
    wbtc: Contract | null;
    lending: Contract | null;
    paymaster: Contract | null;
    skm: Contract | null;
  };
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const provider = new RpcProvider({ nodeUrl: RPC_URL });

const WalletContext = createContext<WalletContextType>({
  account: null,
  address: null,
  isConnecting: false,
  isConnected: false,
  walletName: null,
  provider,
  contracts: { vault: null, wbtc: null, lending: null, paymaster: null, skm: null },
  connect: async () => {},
  disconnect: async () => {},
});

function buildContracts(signerOrProvider: AccountInterface | RpcProvider) {
  return {
    vault: CONTRACTS.VAULT
      ? new Contract(VAULT_ABI as never[], CONTRACTS.VAULT, signerOrProvider)
      : null,
    wbtc: CONTRACTS.WBTC
      ? new Contract(ERC20_ABI as never[], CONTRACTS.WBTC, signerOrProvider)
      : null,
    lending: CONTRACTS.LENDING
      ? new Contract(LENDING_ABI as never[], CONTRACTS.LENDING, signerOrProvider)
      : null,
    paymaster: CONTRACTS.PAYMASTER
      ? new Contract(PAYMASTER_ABI as never[], CONTRACTS.PAYMASTER, signerOrProvider)
      : null,
    skm: CONTRACTS.SESSION_KEY_MANAGER
      ? new Contract(
          SESSION_KEY_MANAGER_ABI as never[],
          CONTRACTS.SESSION_KEY_MANAGER,
          signerOrProvider,
        )
      : null,
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<AccountInterface | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [contracts, setContracts] = useState(() => buildContracts(provider));

  // Rebuild contracts when account changes
  useEffect(() => {
    setContracts(buildContracts(account ?? provider));
  }, [account]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      const wallet = await connect({ modalMode: "alwaysAsk" });
      if (!wallet?.account) return;
      setAccount(wallet.account as AccountInterface);
      setAddress(wallet.selectedAddress ?? wallet.account.address);
      setWalletName(wallet.name ?? "Wallet");
    } catch (err) {
      console.error("Wallet connect failed:", err);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const handleDisconnect = useCallback(async () => {
    await getStarknetDisconnect({ clearLastWallet: true });
    setAccount(null);
    setAddress(null);
    setWalletName(null);
    setContracts(buildContracts(provider));
  }, []);

  // Auto-reconnect on load if wallet was previously connected
  useEffect(() => {
    (async () => {
      try {
        const wallet = await connect({ modalMode: "neverAsk" });
        if (wallet?.account) {
          setAccount(wallet.account as AccountInterface);
          setAddress(wallet.selectedAddress ?? wallet.account.address);
          setWalletName(wallet.name ?? "Wallet");
        }
      } catch {
        // No wallet was previously connected — that's fine
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
        provider,
        contracts,
        connect: handleConnect,
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
