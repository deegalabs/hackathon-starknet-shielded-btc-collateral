export const NETWORK = (import.meta.env.VITE_NETWORK as string) || "devnet";
export const RPC_URL =
  (import.meta.env.VITE_RPC_URL as string) || "http://127.0.0.1:5050";

export const CONTRACTS = {
  WBTC: (import.meta.env.VITE_WBTC_ADDRESS as string) || "",
  VAULT: (import.meta.env.VITE_VAULT_ADDRESS as string) || "",
  LENDING: (import.meta.env.VITE_LENDING_ADDRESS as string) || "",
  PAYMASTER: (import.meta.env.VITE_PAYMASTER_ADDRESS as string) || "",
  SESSION_KEY_MANAGER:
    (import.meta.env.VITE_SESSION_KEY_MANAGER_ADDRESS as string) || "",
} as const;

/**
 * Class hash of the declared ShieldedAccount Cairo contract.
 * Run `scarb build` then `sncast declare` to get this value.
 * Set VITE_SHIELDED_ACCOUNT_CLASS_HASH in .env
 */
export const SHIELDED_ACCOUNT_CLASS_HASH =
  (import.meta.env.VITE_SHIELDED_ACCOUNT_CLASS_HASH as string) || "";

export const NETWORK_LABELS: Record<string, string> = {
  devnet: "Local Devnet",
  sepolia: "Starknet Sepolia",
  mainnet: "Starknet Mainnet",
};

/** Convert satoshis (u256 BigInt) to BTC string */
export function satsToBtc(sats: bigint): string {
  if (sats === 0n) return "0.00000000";
  const btc = Number(sats) / 1e8;
  return btc.toFixed(8);
}

/** Convert BTC string to satoshis BigInt */
export function btcToSats(btc: string): bigint {
  const val = parseFloat(btc);
  if (isNaN(val) || val <= 0) return 0n;
  return BigInt(Math.round(val * 1e8));
}

/** Shorten an address for display: 0x1234...abcd */
export function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
