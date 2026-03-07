import { useCallback, useState } from "react";
import { cairo, ec, stark } from "starknet";
import { useWallet } from "@/context/WalletContext";
import type { TxState } from "./useVault";

export interface SessionKeyInfo {
  pubKey: string;
  expiryTimestamp: number;
  spendingLimit: bigint;
  spent: bigint;
  allowedContract: string;
  isActive: boolean;
  isValid: boolean;
}

function extractU256(val: unknown): bigint {
  const obj = val as Record<string, unknown>;
  return obj?.low !== undefined ? BigInt(String(obj.low)) : BigInt(String(val));
}

export function useSessionKeys() {
  const { account, address, contracts, provider } = useWallet();
  const [tx, setTx] = useState<TxState>({ status: "idle", hash: null, message: null });

  const generateKeyPair = useCallback(() => {
    const privateKey = stark.randomAddress();
    const publicKey = ec.starkCurve.getStarkKey(privateKey);
    return { privateKey, publicKey };
  }, []);

  const registerSession = useCallback(
    async (
      sessionPubKey: string,
      expiryTimestamp: number,
      spendingLimit: bigint,
      allowedContract: string,
    ) => {
      if (!account || !contracts.skm) return;
      setTx({ status: "pending", hash: null, message: "Registering session key..." });
      try {
        const regTx = await contracts.skm.invoke("register_session", [
          sessionPubKey,
          expiryTimestamp,
          cairo.uint256(spendingLimit),
          allowedContract,
        ]);
        await provider.waitForTransaction(regTx.transaction_hash);
        setTx({ status: "success", hash: regTx.transaction_hash, message: "Session key registered!" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Registration failed";
        setTx({ status: "error", hash: null, message: msg });
      }
    },
    [account, contracts, provider],
  );

  const revokeSession = useCallback(
    async (sessionPubKey: string) => {
      if (!account || !contracts.skm) return;
      setTx({ status: "pending", hash: null, message: "Revoking session key..." });
      try {
        const revokeTx = await contracts.skm.invoke("revoke_session", [sessionPubKey]);
        await provider.waitForTransaction(revokeTx.transaction_hash);
        setTx({ status: "success", hash: revokeTx.transaction_hash, message: "Session key revoked!" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Revocation failed";
        setTx({ status: "error", hash: null, message: msg });
      }
    },
    [account, contracts, provider],
  );

  const getSessionInfo = useCallback(
    async (sessionPubKey: string): Promise<SessionKeyInfo | null> => {
      if (!contracts.skm || !address) return null;
      try {
        const [isValid, info] = await Promise.all([
          contracts.skm.is_valid_session(address, sessionPubKey),
          contracts.skm.get_session_info(address, sessionPubKey),
        ]);
        const [expiry, limit, spent, allowedContract, isActive] = info as [
          bigint, unknown, unknown, string, boolean
        ];
        return {
          pubKey: sessionPubKey,
          expiryTimestamp: Number(expiry),
          spendingLimit: extractU256(limit),
          spent: extractU256(spent),
          allowedContract: String(allowedContract),
          isActive: Boolean(isActive),
          isValid: Boolean(isValid),
        };
      } catch {
        return null;
      }
    },
    [address, contracts],
  );

  const resetTx = useCallback(() => {
    setTx({ status: "idle", hash: null, message: null });
  }, []);

  return { tx, generateKeyPair, registerSession, revokeSession, getSessionInfo, resetTx };
}
