/**
 * useShieldedAccount — Deploy and manage a ShieldedAccount contract instance.
 *
 * Flow:
 *  1. A connected signer (Argent Web Wallet / extension) pays for the deployment.
 *  2. We generate a fresh Stark key pair for the ShieldedAccount.
 *  3. The signer deploys ShieldedAccount via the UDC with the generated public key.
 *  4. We store the private key in sessionStorage (ephemeral — cleared on tab close).
 *  5. WalletContext is updated to use the new ShieldedAccount for all protocol calls.
 *
 * Security note (MVP / hackathon):
 *   The private key is kept in memory and sessionStorage.
 *   In production this should use a hardware enclave, passkey-derived key,
 *   or be managed server-side by the Argent infrastructure.
 */
import { useState, useCallback } from "react";
import { Account, CallData, ec, stark, type AccountInterface, type RpcProvider } from "starknet";
import { CONTRACTS, SHIELDED_ACCOUNT_CLASS_HASH } from "@/lib/config";

export type DeployStatus =
  | "idle"
  | "generating_keys"
  | "deploying"
  | "confirming"
  | "done"
  | "error";

export interface ShieldedAccountInfo {
  address: string;
  publicKey: string;
  vaultAddress: string;
  deployedAt: number;
}

const STORAGE_KEY = "shielded_account_v1";
const PRIVKEY_SESSION_KEY = "shielded_account_privkey";

function loadStoredInfo(): ShieldedAccountInfo | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ShieldedAccountInfo) : null;
  } catch {
    return null;
  }
}

export function useShieldedAccount() {
  const [status, setStatus] = useState<DeployStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [info, setInfo] = useState<ShieldedAccountInfo | null>(loadStoredInfo);

  /**
   * Deploy a new ShieldedAccount using the signer account.
   * After deployment, calls `onSuccess` with the new AccountInterface so the
   * caller (WalletContext) can replace the active account.
   */
  const deploy = useCallback(
    async (
      signer: AccountInterface,
      provider: RpcProvider,
      onSuccess: (account: AccountInterface, addr: string) => void,
    ) => {
      if (!SHIELDED_ACCOUNT_CLASS_HASH) {
        setError(
          "SHIELDED_ACCOUNT_CLASS_HASH not configured. " +
            "Run `scarb build` + `sncast declare` and set VITE_SHIELDED_ACCOUNT_CLASS_HASH in .env",
        );
        setStatus("error");
        return;
      }

      setStatus("generating_keys");
      setError(null);

      try {
        // ── 0. Verify class hash is declared on this network ────────────────
        try {
          await provider.getClassByHash(SHIELDED_ACCOUNT_CLASS_HASH);
        } catch {
          throw new Error(
            `Class hash ${SHIELDED_ACCOUNT_CLASS_HASH} is not declared on the current network. ` +
            `Ensure local devnet is running and the contract was declared via the deploy script.`,
          );
        }

        // ── 1. Generate Stark key pair ──────────────────────────────────────
        const privateKey = stark.randomAddress();
        const publicKey = ec.starkCurve.getStarkKey(privateKey);
        const vaultAddress = CONTRACTS.VAULT || "0x0";

        // ── 2. Deploy via signer's account (UDC) ────────────────────────────
        setStatus("deploying");

        const calldata = CallData.compile({
          owner_public_key: publicKey,
          vault_address: vaultAddress,
        });

        const deployResult = await (signer as Account).deploy({
          classHash: SHIELDED_ACCOUNT_CLASS_HASH,
          constructorCalldata: calldata,
          // salt = publicKey → deterministic address per key pair
          salt: publicKey,
          unique: false,
        });

        const contractAddress = Array.isArray(deployResult.contract_address)
          ? deployResult.contract_address[0]
          : deployResult.contract_address;

        setTxHash(deployResult.transaction_hash);
        setStatus("confirming");

        // ── 3. Wait for inclusion ────────────────────────────────────────────
        await provider.waitForTransaction(deployResult.transaction_hash);

        // ── 4. Persist (session = private key, local = address info) ────────
        sessionStorage.setItem(PRIVKEY_SESSION_KEY, privateKey);

        const accountInfo: ShieldedAccountInfo = {
          address: contractAddress,
          publicKey,
          vaultAddress,
          deployedAt: Date.now(),
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(accountInfo));
        setInfo(accountInfo);

        // ── 5. Create ShieldedAccount instance ──────────────────────────────
        const shieldedAcc = new Account({
          provider,
          address: contractAddress,
          signer: privateKey,
        });

        setStatus("done");
        onSuccess(shieldedAcc as unknown as AccountInterface, contractAddress);
      } catch (err) {
        console.error("ShieldedAccount deploy failed:", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    },
    [],
  );

  /**
   * Restore a previously deployed ShieldedAccount from sessionStorage.
   * Returns null if the private key is no longer in session (browser was closed).
   */
  const restore = useCallback(
    (provider: RpcProvider): AccountInterface | null => {
      const stored = loadStoredInfo();
      const privateKey = sessionStorage.getItem(PRIVKEY_SESSION_KEY);
      if (!stored || !privateKey) return null;
      return new Account({
        provider,
        address: stored.address,
        signer: privateKey,
      }) as unknown as AccountInterface;
    },
    [],
  );

  const clear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(PRIVKEY_SESSION_KEY);
    setInfo(null);
    setStatus("idle");
    setError(null);
    setTxHash(null);
  }, []);

  return { status, error, txHash, info, deploy, restore, clear };
}
