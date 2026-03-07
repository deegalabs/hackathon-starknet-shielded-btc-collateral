import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { connect, disconnect as getStarknetDisconnect } from "@starknet-io/get-starknet";
import { Contract, RpcProvider, type AccountInterface, type Abi } from "starknet";
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

function makeContract(
  abi: Abi,
  address: string,
  signerOrProvider: AccountInterface | RpcProvider,
): Contract | null {
  if (!address) return null;
  // starknet.js v9 uses options-object constructor
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
  const [isConnecting, setIsConnecting] = useState(false);
  const [contracts, setContracts] = useState(() => buildContracts(provider));

  useEffect(() => {
    setContracts(buildContracts(account ?? provider));
  }, [account]);

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wallet = await connect({ modalMode: "alwaysAsk" }) as any;
      if (!wallet?.account) return;
      setAccount(wallet.account as AccountInterface);
      setAddress((wallet.selectedAddress ?? wallet.account.address) as string);
      setWalletName((wallet.name ?? "Wallet") as string);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wallet = await connect({ modalMode: "neverAsk" }) as any;
        if (wallet?.account) {
          setAccount(wallet.account as AccountInterface);
          setAddress((wallet.selectedAddress ?? wallet.account.address) as string);
          setWalletName((wallet.name ?? "Wallet") as string);
        }
      } catch {
        // No wallet was previously connected
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
