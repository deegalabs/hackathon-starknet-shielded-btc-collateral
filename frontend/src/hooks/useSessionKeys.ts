import { useCallback, useState } from "react";
import { cairo, ec, stark } from "starknet";
import { useWallet } from "@/context/WalletContext";
import { shortAddr } from "@/lib/config";
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
    ): Promise<boolean> => {
      if (!account || !contracts.skm) {
        setTx({ status: "error", hash: null, message: "Session Key Manager not configured" });
        return false;
      }
      setTx({ status: "pending", hash: null, message: "Registering session key..." });
      try {
        const regTx = await contracts.skm.invoke("register_session", [
          sessionPubKey,
          expiryTimestamp,
          cairo.uint256(spendingLimit),
          allowedContract,
        ]);
        setTx({ status: "pending", hash: regTx.transaction_hash, message: "Waiting confirmation..." });
        await provider.waitForTransaction(regTx.transaction_hash, {
          retryInterval: 4000,
          successStates: ["ACCEPTED_ON_L2", "ACCEPTED_ON_L1"],
        });
        setTx({
          status: "success",
          hash: regTx.transaction_hash,
          message: `Session key registered! Key: ${shortAddr(sessionPubKey)}`,
        });
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Registration failed";
        setTx({ status: "error", hash: null, message: msg });
        return false;
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
      const key = sessionPubKey.trim().startsWith("0x")
        ? sessionPubKey.trim()
        : `0x${sessionPubKey.trim()}`;
      try {
        const [isValid, info] = await Promise.all([
          contracts.skm.is_valid_session(address, key),
          contracts.skm.get_session_info(address, key),
        ]);
        // starknet.js may return tuple as array or as object (e.g. { 0: x, 1: y, ... })
        const raw = info as unknown;
        let expiry: unknown, limit: unknown, spent: unknown, allowedContract: unknown, isActive: unknown;
        if (Array.isArray(raw)) {
          [expiry, limit, spent, allowedContract, isActive] = raw;
        } else if (raw && typeof raw === "object" && "0" in raw) {
          const o = raw as Record<string, unknown>;
          expiry = o[0] ?? o.expiry_timestamp;
          limit = o[1] ?? o.spending_limit;
          spent = o[2] ?? o.spent;
          allowedContract = o[3] ?? o.allowed_contract;
          isActive = o[4] ?? o.is_active;
        } else {
          console.error("[SessionKeys] get_session_info unexpected shape:", raw);
          return null;
        }
        return {
          pubKey: key,
          expiryTimestamp: Number(expiry),
          spendingLimit: extractU256(limit),
          spent: extractU256(spent),
          allowedContract: String(allowedContract),
          isActive: Boolean(isActive),
          isValid: Boolean(isValid),
        };
      } catch (err) {
        console.error("[SessionKeys] getSessionInfo failed:", err);
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
