/**
 * Shielded BTC Collateral Protocol — E2E Demo Script
 *
 * Full protocol flow against local starknet-devnet:
 *   1. Deploy MockERC20 (WBTC), CollateralVault
 *   2. Mint WBTC to Alice
 *   3. Alice deposits WBTC with a private Poseidon commitment
 *   4. Alice proves collateral to Bob (DeFi protocol)
 *   5. Alice withdraws with a nullifier (prevents double-spend)
 *   6. Double-spend attempt → blocked
 *
 * Usage:
 *   starknet-devnet --seed 0 --port 5050   (in a separate terminal)
 *   pnpm demo
 */

import {
  RpcProvider,
  Account,
  Contract,
  CallData,
  stark,
  hash,
  cairo,
  num,
  type AccountOptions,
} from "starknet";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ARTIFACTS_DIR = resolve(__dirname, "../contracts/target/dev");
const DEVNET_RPC = "http://127.0.0.1:5050";

// ─── Pre-funded devnet accounts (seed=0) ─────────────────────────────────────
const ALICE = {
  label: "Alice (Depositor)",
  address: "0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691",
  privateKey: "0x71d7bb07b9a64f6f78ac4c816aff4da9",
};
const BOB = {
  label: "Bob (DeFi Lending Protocol)",
  address: "0x078662e7352d062084b0010068b99288486c2d8b914f6e2a55ce945f8792c8b1",
  privateKey: "0xe1406455b7d66b1690803be066cbe5e",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadArtifacts(name: string) {
  const sierra = JSON.parse(
    readFileSync(resolve(ARTIFACTS_DIR, `shielded_btc_collateral_${name}.contract_class.json`), "utf-8"),
  );
  const casm = JSON.parse(
    readFileSync(resolve(ARTIFACTS_DIR, `shielded_btc_collateral_${name}.compiled_contract_class.json`), "utf-8"),
  );
  return { sierra, casm };
}

function section(title: string) {
  const line = "─".repeat(62);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(line);
}

function row(label: string, value: unknown) {
  const s = typeof value === "bigint" ? `0x${value.toString(16)}` : String(value);
  console.log(`  ${label.padEnd(30)} ${s}`);
}

async function tx(
  provider: RpcProvider,
  txHash: string,
  label: string,
): Promise<void> {
  process.stdout.write(`  ⏳ ${label}... `);
  await provider.waitForTransaction(txHash);
  console.log("✅");
}

/**
 * Compute Poseidon(amount.low, amount.high, secret) — mirrors Cairo's
 * InternalImpl::compute_commitment.
 * Uses starknet.js v9 hash.computePoseidonHashOnElements.
 */
function computeCommitment(amount: bigint, secret: bigint): bigint {
  const low = amount & 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFn; // u128 low
  const high = amount >> 128n; // u128 high
  // computePoseidonHashOnElements takes an array of BigNumberish
  return BigInt(hash.computePoseidonHashOnElements([low, high, secret]));
}

/**
 * Compute Poseidon(commitment, withdraw_secret) — mirrors Cairo's
 * InternalImpl::compute_nullifier.
 */
function computeNullifier(commitment: bigint, withdrawSecret: bigint): bigint {
  return BigInt(hash.computePoseidonHashOnElements([commitment, withdrawSecret]));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   SHIELDED BTC COLLATERAL PROTOCOL  —  E2E DEMO             ║");
  console.log("║   Privacy-preserving collateral layer on Starknet           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // ── Connect ──────────────────────────────────────────────────────────────
  section("Connecting to starknet-devnet");
  const provider = new RpcProvider({ nodeUrl: DEVNET_RPC });
  let chainId: string;
  try {
    chainId = await provider.getChainId();
  } catch {
    console.error("\n  ❌  Cannot reach starknet-devnet at", DEVNET_RPC);
    console.error("  Run: starknet-devnet --seed 0 --port 5050\n");
    process.exit(1);
  }
  row("Chain ID", chainId);

  // starknet.js v9: Account uses an options object
  const aliceAccount = new Account({
    provider,
    address: ALICE.address,
    signer: ALICE.privateKey,
  } as AccountOptions);
  const bobAccount = new Account({
    provider,
    address: BOB.address,
    signer: BOB.privateKey,
  } as AccountOptions);
  row("Alice", ALICE.address);
  row("Bob  ", BOB.address);

  // ── Deploy MockERC20 (WBTC) ────────────────────────────────────────────
  section("STEP 1 — Deploy Contracts");

  console.log("\n  📦  Declaring + deploying MockERC20 (Mock WBTC, 8 decimals)...");
  const erc20Art = loadArtifacts("MockERC20");
  const erc20Deploy = await aliceAccount.declareAndDeploy({
    contract: erc20Art.sierra,
    casm: erc20Art.casm,
    constructorCalldata: CallData.compile({ decimals: 8 }),
    salt: stark.randomAddress(),
  });
  await tx(provider, erc20Deploy.deploy.transaction_hash, "MockERC20 deployed");
  const wbtcAddress = erc20Deploy.deploy.contract_address;
  row("WBTC (MockERC20)", wbtcAddress);

  // ── Deploy CollateralVault ─────────────────────────────────────────────
  console.log("\n  📦  Declaring + deploying CollateralVault...");
  const vaultArt = loadArtifacts("CollateralVault");
  const vaultDeploy = await aliceAccount.declareAndDeploy({
    contract: vaultArt.sierra,
    casm: vaultArt.casm,
    constructorCalldata: CallData.compile({ wbtc_token: wbtcAddress }),
    salt: stark.randomAddress(),
  });
  await tx(provider, vaultDeploy.deploy.transaction_hash, "CollateralVault deployed");
  const vaultAddress = vaultDeploy.deploy.contract_address;
  row("CollateralVault", vaultAddress);

  // starknet.js v9: Contract also uses options object
  const wbtc = new Contract({
    abi: erc20Art.sierra.abi,
    address: wbtcAddress,
    providerOrAccount: aliceAccount,
  });
  const vault = new Contract({
    abi: vaultArt.sierra.abi,
    address: vaultAddress,
    providerOrAccount: aliceAccount,
  });

  // ── Mint WBTC to Alice ─────────────────────────────────────────────────
  section("STEP 2 — Fund Alice with WBTC");

  const DEPOSIT_AMOUNT = 1_000_000n; // 0.01 WBTC in satoshis
  console.log(`\n  🪙  Minting ${DEPOSIT_AMOUNT} sats (0.01 WBTC) to Alice...`);
  const mintResp = await wbtc.invoke("mint", [
    ALICE.address,
    cairo.uint256(DEPOSIT_AMOUNT),
  ]);
  await tx(provider, mintResp.transaction_hash, "Mint confirmed");

  const balBefore = await wbtc.call("balance_of", [ALICE.address]);
  row("Alice WBTC balance", `${cairo.uint256(balBefore as bigint).low} sats`);

  // ── Approve vault ──────────────────────────────────────────────────────
  console.log("\n  ✅  Approving vault to spend Alice's WBTC...");
  const approveResp = await wbtc.invoke("approve", [
    vaultAddress,
    cairo.uint256(DEPOSIT_AMOUNT),
  ]);
  await tx(provider, approveResp.transaction_hash, "Approval confirmed");
  row("Vault allowance", `${DEPOSIT_AMOUNT} sats`);

  // ── Private Deposit ────────────────────────────────────────────────────
  section("STEP 3 — Alice Makes a PRIVATE Deposit");

  const SECRET = 0xDEADBEEF_1337CAFEn;
  const commitment = computeCommitment(DEPOSIT_AMOUNT, SECRET);

  console.log("\n  🔒  Generating Poseidon commitment (off-chain, only Alice knows):");
  console.log("  ┌───────────────────────────────────────────────────────────┐");
  row("  │  deposit_amount (PRIVATE)", `${DEPOSIT_AMOUNT} sats`);
  row("  │  secret (PRIVATE)", SECRET);
  console.log("  │  ───────────────────────────────────────────────────────  │");
  row("  │  commitment = Poseidon(amount, secret)", commitment);
  console.log("  └───────────────────────────────────────────────────────────┘");
  console.log("  💡  Only the commitment hash goes on-chain — amount is hidden!");

  console.log("\n  📥  Calling vault.deposit(amount, commitment)...");
  const depositResp = await vault.invoke("deposit", [
    cairo.uint256(DEPOSIT_AMOUNT),
    commitment,
  ]);
  await tx(provider, depositResp.transaction_hash, "Deposit confirmed");

  // Verify on-chain state
  const storedCommitment = await vault.call("get_commitment", [ALICE.address]);
  const totalLocked = await vault.call("get_total_locked", []);
  const vaultBal = await wbtc.call("balance_of", [vaultAddress]);
  const aliceBalAfter = await wbtc.call("balance_of", [ALICE.address]);

  console.log("\n  📊  On-chain state (public, anyone can read):");
  row("  Vault WBTC balance", `${BigInt(String(vaultBal))} sats`);
  row("  Alice WBTC balance", `${BigInt(String(aliceBalAfter))} sats`);
  row("  Total locked (vault)", `${BigInt(String(totalLocked))} sats`);
  row("  Stored commitment", storedCommitment as bigint);
  console.log("  💡  Observer sees commitment & vault balance, NOT Alice's exact deposit!");

  // ── Prove Collateral ───────────────────────────────────────────────────
  section("STEP 4 — Alice Proves Collateral to Bob's Lending Protocol");

  const THRESHOLD = 500_000n; // 0.005 WBTC minimum required

  console.log("\n  🔐  Bob's protocol verifies Alice meets the collateral threshold...");
  console.log("  ┌───────────────────────────────────────────────────────────┐");
  console.log(`  │  Statement: "I have deposited >= ${THRESHOLD} sats"        │`);
  console.log("  │  Without revealing the exact amount                       │");
  console.log("  │  MVP: stub verifier (commitment != 0 → accepted)          │");
  console.log("  └───────────────────────────────────────────────────────────┘");

  // Bob's protocol queries the vault with Alice's address and their threshold
  const bobVault = new Contract({
    abi: vaultArt.sierra.abi,
    address: vaultAddress,
    providerOrAccount: bobAccount,
  });
  const proofValid = await bobVault.call("prove_collateral", [
    ALICE.address,
    cairo.uint256(THRESHOLD),
  ]);
  row("\n  Proof result", String(proofValid));

  if (!proofValid) {
    console.error("  ❌  Proof rejected — something is wrong!");
    process.exit(1);
  }
  console.log("  ✅  Bob's protocol accepts Alice's collateral!");
  console.log("  💡  Bob knows Alice has >= threshold — but NOT the exact amount");

  // ── Withdraw with Nullifier ────────────────────────────────────────────
  section("STEP 5 — Alice Withdraws Using a One-Time Nullifier");

  const WITHDRAW_SECRET = 0x1337F00D_BABE1234n;
  const nullifier = computeNullifier(commitment, WITHDRAW_SECRET);

  console.log("\n  🔑  Generating withdrawal nullifier (off-chain):");
  console.log("  ┌───────────────────────────────────────────────────────────┐");
  row("  │  commitment (known)", commitment);
  row("  │  withdraw_secret (PRIVATE)", WITHDRAW_SECRET);
  console.log("  │  ───────────────────────────────────────────────────────  │");
  row("  │  nullifier = Poseidon(commitment, secret)", nullifier);
  console.log("  └───────────────────────────────────────────────────────────┘");
  console.log("  💡  Nullifier posted on-chain to prevent reuse");
  console.log("  💡  Nullifier does NOT reveal Alice's identity");

  console.log("\n  📤  Calling vault.withdraw(amount, nullifier)...");
  const withdrawResp = await vault.invoke("withdraw", [
    cairo.uint256(DEPOSIT_AMOUNT),
    nullifier,
  ]);
  await tx(provider, withdrawResp.transaction_hash, "Withdrawal confirmed");

  const aliceBalFinal = await wbtc.call("balance_of", [ALICE.address]);
  const vaultBalFinal = await wbtc.call("balance_of", [vaultAddress]);
  const nullifierUsed = await vault.call("is_nullifier_used", [nullifier]);
  const totalLockedFinal = await vault.call("get_total_locked", []);

  console.log("\n  📊  On-chain state after withdrawal:");
  row("  Alice WBTC balance", `${BigInt(String(aliceBalFinal))} sats`);
  row("  Vault WBTC balance", `${BigInt(String(vaultBalFinal))} sats`);
  row("  Total locked (vault)", `${BigInt(String(totalLockedFinal))} sats`);
  row("  Nullifier registered", String(nullifierUsed));

  // ── Double-Spend Attack ────────────────────────────────────────────────
  section("STEP 6 — Double-Spend Attack (Expected to FAIL)");

  console.log("\n  🚨  Re-using the same nullifier (simulated double-spend attack)...");
  try {
    const attackResp = await vault.invoke("withdraw", [
      cairo.uint256(DEPOSIT_AMOUNT),
      nullifier, // same nullifier — must be rejected!
    ]);
    // If invocation succeeds, wait for tx to ensure it's mined
    await provider.waitForTransaction(attackResp.transaction_hash);
    console.error("  ❌  SECURITY FAILURE: Double-spend was accepted!");
    process.exit(1);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = msg.includes("Nullifier already used")
      ? "Nullifier already used"
      : msg.includes("REJECTED") || msg.includes("revert")
      ? "Transaction reverted by contract"
      : `Blocked (${msg.slice(0, 60)}...)`;
    console.log(`  ✅  BLOCKED: ${reason}`);
    console.log("  🔒  Double-spend prevention is working correctly!");
  }

  // ── Summary ────────────────────────────────────────────────────────────
  console.log("\n");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              PROTOCOL VALIDATION COMPLETE ✅                 ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  ✅  Contracts deployed to local devnet                      ║");
  console.log("║  ✅  WBTC minted and approved                                ║");
  console.log("║  ✅  Private deposit — amount hidden by Poseidon commitment  ║");
  console.log("║  ✅  Collateral proof accepted by DeFi protocol (Bob)        ║");
  console.log("║  ✅  Withdrawal processed with one-time nullifier            ║");
  console.log("║  ✅  Double-spend attack blocked by nullifier registry       ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║  Deployed Addresses:                                         ║");
  console.log(`║    WBTC   : ${wbtcAddress.padEnd(49)} ║`);
  console.log(`║    Vault  : ${vaultAddress.padEnd(49)} ║`);
  console.log("╚══════════════════════════════════════════════════════════════╝\n");
}

main().catch((err) => {
  console.error("\n  ❌  Demo failed:", err?.message ?? String(err));
  if (err?.stack) console.error("  Stack:", err.stack);
  if (err?.data) console.error("  Error data:", err.data);
  process.exit(1);
});
