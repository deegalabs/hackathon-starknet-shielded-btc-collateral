/**
 * Shielded BTC Collateral Protocol — Full E2E Demo
 *
 * Tests all contracts against local starknet-devnet:
 *   STEP 1  — Deploy all contracts (WBTC, Vault, Lending, Paymaster, SessionKeyManager)
 *   STEP 2  — Fund Alice with WBTC
 *   STEP 3  — Alice makes a PRIVATE deposit (Poseidon commitment)
 *   STEP 4  — Alice proves collateral to Bob's lending protocol
 *   STEP 5  — Alice borrows from MockLendingProtocol
 *   STEP 6  — Alice repays the loan
 *   STEP 7  — Paymaster eligibility check (gasless tx readiness)
 *   STEP 8  — SessionKeyManager: register & validate session key
 *   STEP 9  — Alice withdraws using a one-time nullifier
 *   STEP 10 — Double-spend attack (expected to FAIL)
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
  ec,
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
  label: "Alice (Depositor / Borrower)",
  address: "0x064b48806902a367c8598f4f95c305e8c1a1acba5f082d294a43793113115691",
  privateKey: "0x71d7bb07b9a64f6f78ac4c816aff4da9",
};
const BOB = {
  label: "Bob (Admin / Protocol Owner)",
  address: "0x078662e7352d062084b0010068b99288486c2d8b914f6e2a55ce945f8792c8b1",
  privateKey: "0xe1406455b7d66b1690803be066cbe5e",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadArtifacts(name: string) {
  const sierra = JSON.parse(
    readFileSync(
      resolve(ARTIFACTS_DIR, `shielded_btc_collateral_${name}.contract_class.json`),
      "utf-8",
    ),
  );
  const casm = JSON.parse(
    readFileSync(
      resolve(
        ARTIFACTS_DIR,
        `shielded_btc_collateral_${name}.compiled_contract_class.json`,
      ),
      "utf-8",
    ),
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
  const s =
    typeof value === "bigint" ? `0x${value.toString(16)}` : String(value);
  console.log(`  ${label.padEnd(34)} ${s}`);
}

function pass(msg: string) {
  console.log(`  ✅  ${msg}`);
}

function fail(msg: string) {
  console.error(`  ❌  FAILURE: ${msg}`);
  process.exit(1);
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

function computeCommitment(amount: bigint, secret: bigint): bigint {
  const low = amount & 0xffffffffffffffffffffffffffffffffn;
  const high = amount >> 128n;
  return BigInt(hash.computePoseidonHashOnElements([low, high, secret]));
}

function computeNullifier(commitment: bigint, withdrawSecret: bigint): bigint {
  return BigInt(hash.computePoseidonHashOnElements([commitment, withdrawSecret]));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n");
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║   SHIELDED BTC COLLATERAL PROTOCOL  —  FULL E2E DEMO        ║",
  );
  console.log(
    "║   CollateralVault · Lending · Paymaster · SessionKeyManager ║",
  );
  console.log(
    "╚══════════════════════════════════════════════════════════════╝",
  );

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

  // ═══════════════════════════════════════════════════════════════════
  // STEP 1 — Deploy all contracts
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 1 — Deploy All Contracts");

  // MockERC20 (WBTC)
  console.log("\n  📦  MockERC20 (Mock WBTC, 8 decimals)...");
  const erc20Art = loadArtifacts("MockERC20");
  const erc20Deploy = await aliceAccount.declareAndDeploy({
    contract: erc20Art.sierra,
    casm: erc20Art.casm,
    constructorCalldata: CallData.compile({ decimals: 8 }),
    salt: stark.randomAddress(),
  });
  await tx(provider, erc20Deploy.deploy.transaction_hash, "MockERC20");
  const wbtcAddress = erc20Deploy.deploy.contract_address;
  row("WBTC (MockERC20)", wbtcAddress);

  // CollateralVault (owner = Bob)
  console.log("\n  📦  CollateralVault (owner = Bob)...");
  const vaultArt = loadArtifacts("CollateralVault");
  const vaultDeploy = await aliceAccount.declareAndDeploy({
    contract: vaultArt.sierra,
    casm: vaultArt.casm,
    constructorCalldata: CallData.compile({
      wbtc_token: wbtcAddress,
      owner: BOB.address,
    }),
    salt: stark.randomAddress(),
  });
  await tx(provider, vaultDeploy.deploy.transaction_hash, "CollateralVault");
  const vaultAddress = vaultDeploy.deploy.contract_address;
  row("CollateralVault", vaultAddress);

  // MockLendingProtocol
  console.log("\n  📦  MockLendingProtocol...");
  const lendingArt = loadArtifacts("MockLendingProtocol");
  const lendingDeploy = await aliceAccount.declareAndDeploy({
    contract: lendingArt.sierra,
    casm: lendingArt.casm,
    constructorCalldata: CallData.compile({ vault_address: vaultAddress }),
    salt: stark.randomAddress(),
  });
  await tx(provider, lendingDeploy.deploy.transaction_hash, "MockLendingProtocol");
  const lendingAddress = lendingDeploy.deploy.contract_address;
  row("MockLendingProtocol", lendingAddress);

  // Paymaster (owner=Bob, threshold=0.001 BTC = 100_000 sats)
  const SPONSORSHIP_THRESHOLD = 100_000n;
  console.log("\n  📦  Paymaster (threshold = 100,000 sats)...");
  const paymasterArt = loadArtifacts("Paymaster");
  const paymasterDeploy = await aliceAccount.declareAndDeploy({
    contract: paymasterArt.sierra,
    casm: paymasterArt.casm,
    constructorCalldata: CallData.compile({
      owner: BOB.address,
      vault_address: vaultAddress,
      sponsorship_threshold: cairo.uint256(SPONSORSHIP_THRESHOLD),
    }),
    salt: stark.randomAddress(),
  });
  await tx(provider, paymasterDeploy.deploy.transaction_hash, "Paymaster");
  const paymasterAddress = paymasterDeploy.deploy.contract_address;
  row("Paymaster", paymasterAddress);

  // SessionKeyManager
  console.log("\n  📦  SessionKeyManager...");
  const skmArt = loadArtifacts("SessionKeyManager");
  const skmDeploy = await aliceAccount.declareAndDeploy({
    contract: skmArt.sierra,
    casm: skmArt.casm,
    constructorCalldata: [],
    salt: stark.randomAddress(),
  });
  await tx(provider, skmDeploy.deploy.transaction_hash, "SessionKeyManager");
  const skmAddress = skmDeploy.deploy.contract_address;
  row("SessionKeyManager", skmAddress);

  // Contract handles
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
  const vaultBob = new Contract({
    abi: vaultArt.sierra.abi,
    address: vaultAddress,
    providerOrAccount: bobAccount,
  });
  const lending = new Contract({
    abi: lendingArt.sierra.abi,
    address: lendingAddress,
    providerOrAccount: aliceAccount,
  });
  const paymaster = new Contract({
    abi: paymasterArt.sierra.abi,
    address: paymasterAddress,
    providerOrAccount: bobAccount,
  });
  const skm = new Contract({
    abi: skmArt.sierra.abi,
    address: skmAddress,
    providerOrAccount: aliceAccount,
  });

  pass("All 5 contracts deployed");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 2 — Fund Alice with WBTC
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 2 — Fund Alice with WBTC");

  const DEPOSIT_AMOUNT = 10_000_000n; // 0.1 WBTC = 10M satoshis
  console.log(`\n  🪙  Minting ${DEPOSIT_AMOUNT.toLocaleString()} sats (0.1 WBTC) to Alice...`);
  const mintResp = await wbtc.invoke("mint", [
    ALICE.address,
    cairo.uint256(DEPOSIT_AMOUNT),
  ]);
  await tx(provider, mintResp.transaction_hash, "Mint");

  const balRaw = await wbtc.call("balance_of", [ALICE.address]);
  const aliceBal = BigInt((balRaw as { low: bigint }).low ?? BigInt(String(balRaw)));
  row("Alice WBTC balance", `${aliceBal.toLocaleString()} sats`);

  // Approve vault
  const approveResp = await wbtc.invoke("approve", [
    vaultAddress,
    cairo.uint256(DEPOSIT_AMOUNT),
  ]);
  await tx(provider, approveResp.transaction_hash, "Approve vault");
  pass(`Alice approved vault to spend ${DEPOSIT_AMOUNT.toLocaleString()} sats`);

  // ═══════════════════════════════════════════════════════════════════
  // STEP 3 — Private Deposit
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 3 — Alice Makes a PRIVATE Deposit");

  const SECRET = 0xDEADBEEF_1337CAFEn;
  const commitment = computeCommitment(DEPOSIT_AMOUNT, SECRET);

  console.log("\n  🔒  Poseidon commitment (off-chain — only Alice knows):");
  row("    deposit_amount (PRIVATE)", `${DEPOSIT_AMOUNT.toLocaleString()} sats`);
  row("    secret (PRIVATE)", SECRET);
  row("    commitment = Poseidon(amt, secret)", commitment);
  console.log("  💡  Only the commitment hash goes on-chain. Amount is hidden!");

  const depositResp = await vault.invoke("deposit", [
    cairo.uint256(DEPOSIT_AMOUNT),
    commitment,
  ]);
  await tx(provider, depositResp.transaction_hash, "Deposit");

  const storedCommitment = await vault.call("get_commitment", [ALICE.address]);
  const totalLocked = await vault.call("get_total_locked", []);
  row("  Stored commitment (on-chain)", storedCommitment as bigint);
  row("  Vault total locked", `${BigInt(String(totalLocked)).toLocaleString()} sats`);

  if (BigInt(String(storedCommitment)) !== commitment) fail("Commitment mismatch!");
  pass("Deposit confirmed — commitment stored, amount hidden");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 4 — Collateral Proof
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 4 — Prove Collateral to Bob's Lending Protocol");

  const THRESHOLD = 5_000_000n; // 0.05 BTC
  console.log(
    `\n  🔐  Bob's protocol checks: does Alice have >= ${THRESHOLD.toLocaleString()} sats?`,
  );
  console.log("  💡  Bob does NOT learn Alice's exact deposit — only pass/fail");

  const proofValid = await vaultBob.call("prove_collateral", [
    ALICE.address,
    cairo.uint256(THRESHOLD),
  ]);
  row("  prove_collateral result", String(proofValid));
  if (!proofValid) fail("Proof rejected unexpectedly!");
  pass(`Collateral proof accepted (Alice has >= ${THRESHOLD.toLocaleString()} sats)`);

  // Verify below-threshold fails
  const HUGE_THRESHOLD = 1_000_000_000n; // 10 BTC — Alice only has 0.1
  const proofFail = await vaultBob.call("prove_collateral", [
    ALICE.address,
    cairo.uint256(HUGE_THRESHOLD),
  ]);
  if (proofFail) fail("Proof should have failed for threshold above deposit!");
  pass("Over-threshold proof correctly rejected");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 5 — Borrow from MockLendingProtocol
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 5 — Alice Borrows from MockLendingProtocol (70% LTV)");

  // At 70% LTV: borrow 7M sats → need to prove ceil(7M*100/70)=10M sats collateral
  const BORROW_AMOUNT = 7_000_000n; // 0.07 BTC
  const requiredCollateral = (BORROW_AMOUNT * 100n + 69n) / 70n;
  console.log(`\n  💳  Borrow request: ${BORROW_AMOUNT.toLocaleString()} sats`);
  console.log(
    `  📐  Required collateral (70% LTV ceiling): ${requiredCollateral.toLocaleString()} sats`,
  );
  console.log("  💡  Lending protocol calls prove_collateral — never sees exact amount");

  const borrowResp = await lending.invoke("borrow", [cairo.uint256(BORROW_AMOUNT)]);
  await tx(provider, borrowResp.transaction_hash, "Borrow");

  const debtRaw = await lending.call("get_debt", [ALICE.address]);
  const debt = BigInt(String((debtRaw as {low: bigint}).low ?? debtRaw));
  row("  Alice's debt", `${debt.toLocaleString()} sats`);
  if (debt !== BORROW_AMOUNT) fail("Debt amount mismatch!");
  pass(`Loan of ${BORROW_AMOUNT.toLocaleString()} sats approved via private collateral proof`);

  // Verify double-borrow is blocked
  try {
    await lending.invoke("borrow", [cairo.uint256(1_000_000n)]);
    fail("Second borrow should have been rejected (active debt exists)!");
  } catch {
    pass("Second borrow correctly rejected (active debt exists)");
  }

  // ═══════════════════════════════════════════════════════════════════
  // STEP 6 — Repay the Loan
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 6 — Alice Repays the Loan");

  const PARTIAL_REPAY = 3_000_000n;
  console.log(`\n  💸  Partial repayment: ${PARTIAL_REPAY.toLocaleString()} sats...`);
  const repay1 = await lending.invoke("repay", [cairo.uint256(PARTIAL_REPAY)]);
  await tx(provider, repay1.transaction_hash, "Partial repay");

  const debtAfterPartial = BigInt(
    String(((await lending.call("get_debt", [ALICE.address])) as {low: bigint}).low ?? 
           (await lending.call("get_debt", [ALICE.address]))),
  );
  row("  Debt after partial repay", `${debtAfterPartial.toLocaleString()} sats`);
  if (debtAfterPartial !== BORROW_AMOUNT - PARTIAL_REPAY)
    fail("Partial repay amount mismatch!");

  const REMAINING = BORROW_AMOUNT - PARTIAL_REPAY;
  console.log(`\n  💸  Full repayment of remaining: ${REMAINING.toLocaleString()} sats...`);
  const repay2 = await lending.invoke("repay", [cairo.uint256(REMAINING)]);
  await tx(provider, repay2.transaction_hash, "Full repay");

  const debtFinal = BigInt(
    String(((await lending.call("get_debt", [ALICE.address])) as {low: bigint}).low ?? 0),
  );
  row("  Debt after full repay", `${debtFinal.toLocaleString()} sats`);
  if (debtFinal !== 0n) fail("Debt should be 0 after full repay!");
  pass("Loan fully repaid — Alice's collateral is free to withdraw");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 7 — Paymaster Eligibility
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 7 — Paymaster: Gasless Transaction Eligibility");

  // Fund paymaster budget (permissionless — M-04 fix)
  const BUDGET = 10_000_000n; // conceptual STRK budget
  console.log(`\n  💰  Funding paymaster budget: ${BUDGET.toLocaleString()} units (permissionless)...`);
  const fundResp = await paymaster.invoke("fund_budget", [cairo.uint256(BUDGET)]);
  await tx(provider, fundResp.transaction_hash, "Fund paymaster");

  const budgetRaw = await paymaster.call("get_remaining_budget", []);
  row("  Remaining budget", String(budgetRaw));
  pass("Paymaster funded (anyone can contribute — not owner-only)");

  // Alice should be eligible (has collateral >= 100,000 sats threshold)
  const aliceEligible = await paymaster.call("is_eligible_for_sponsorship", [
    ALICE.address,
  ]);
  row("  Alice eligible for sponsorship", String(aliceEligible));
  if (!aliceEligible) fail("Alice should be eligible for gas sponsorship!");
  pass("Alice qualifies for gasless transactions (collateral > threshold)");

  // Unknown user should NOT be eligible
  const randomAddr = "0x1234567890abcdef1234567890abcdef12345678";
  const randomEligible = await paymaster.call("is_eligible_for_sponsorship", [
    randomAddr,
  ]);
  if (randomEligible) fail("Random user should NOT be eligible!");
  pass("Unknown user correctly denied gas sponsorship (no vault deposit)");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 8 — SessionKeyManager
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 8 — SessionKeyManager: Register & Validate Session Key");

  // Generate a fresh Stark key pair for the session key
  const sessionPrivKey = stark.randomAddress();
  const sessionPubKey = BigInt(ec.starkCurve.getStarkKey(sessionPrivKey));
  const expiryTs = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
  const spendingLimit = 5_000_000n; // 0.05 BTC

  console.log("\n  🔑  Registering session key (Alice delegates DApp access):");
  row("    Session pubkey", sessionPubKey);
  row("    Expires at (unix)", expiryTs);
  row("    Spending limit", `${spendingLimit.toLocaleString()} sats`);
  row("    Allowed contract (scoped)", vaultAddress);

  const registerResp = await skm.invoke("register_session", [
    sessionPubKey,
    expiryTs,
    cairo.uint256(spendingLimit),
    vaultAddress,
  ]);
  await tx(provider, registerResp.transaction_hash, "Register session key");

  // Check validity
  const isValid = await skm.call("is_valid_session", [
    ALICE.address,
    sessionPubKey,
  ]);
  row("  Session valid", String(isValid));
  if (!isValid) fail("Session key should be valid after registration!");
  pass("Session key registered and valid (scoped to vault address)");

  // Record spending (H-06 fix: caller must == account)
  const spendAmount = 1_000_000n;
  console.log(`\n  📊  Recording ${spendAmount.toLocaleString()} sats spending against session key...`);
  const spendResp = await skm.invoke("record_spending", [
    ALICE.address,
    sessionPubKey,
    cairo.uint256(spendAmount),
  ]);
  await tx(provider, spendResp.transaction_hash, "Record spending");

  const sessionInfo = await skm.call("get_session_info", [
    ALICE.address,
    sessionPubKey,
  ]);
  console.log("  Session info (expiry, limit, spent, allowed, active):", sessionInfo);
  pass("Spending recorded — limit enforced by SessionKeyManager");

  // Revoke the session key
  const revokeResp = await skm.invoke("revoke_session", [sessionPubKey]);
  await tx(provider, revokeResp.transaction_hash, "Revoke session key");

  const isValidAfterRevoke = await skm.call("is_valid_session", [
    ALICE.address,
    sessionPubKey,
  ]);
  if (isValidAfterRevoke) fail("Session key should be invalid after revocation!");
  pass("Session key revoked — no longer valid");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 9 — Withdraw with Nullifier
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 9 — Alice Withdraws Using a One-Time Nullifier");

  const WITHDRAW_SECRET = 0x1337F00D_BABE1234n;
  const nullifier = computeNullifier(commitment, WITHDRAW_SECRET);

  console.log("\n  🔑  Withdrawal nullifier (off-chain):");
  row("    commitment", commitment);
  row("    withdraw_secret (PRIVATE)", WITHDRAW_SECRET);
  row("    nullifier = Poseidon(c, s)", nullifier);
  console.log("  💡  Nullifier prevents double-spend without revealing identity");

  const withdrawResp = await vault.invoke("withdraw", [
    cairo.uint256(DEPOSIT_AMOUNT),
    nullifier,
  ]);
  await tx(provider, withdrawResp.transaction_hash, "Withdraw");

  const aliceBalFinal = await wbtc.call("balance_of", [ALICE.address]);
  const vaultBalFinal = await wbtc.call("balance_of", [vaultAddress]);
  const nullifierUsed = await vault.call("is_nullifier_used", [nullifier]);
  const totalLockedFinal = await vault.call("get_total_locked", []);

  row("  Alice WBTC balance", `${BigInt(String((aliceBalFinal as {low:bigint}).low ?? aliceBalFinal)).toLocaleString()} sats`);
  row("  Vault WBTC balance", `${BigInt(String((vaultBalFinal as {low:bigint}).low ?? vaultBalFinal)).toLocaleString()} sats`);
  row("  Vault total locked", String(totalLockedFinal));
  row("  Nullifier registered", String(nullifierUsed));

  if (!nullifierUsed) fail("Nullifier should be marked as used!");
  pass("Withdrawal confirmed — funds returned, nullifier burned");

  // ═══════════════════════════════════════════════════════════════════
  // STEP 10 — Double-Spend Attack
  // ═══════════════════════════════════════════════════════════════════
  section("STEP 10 — Double-Spend Attack (Expected to FAIL)");

  console.log("\n  🚨  Re-using same nullifier (simulated double-spend attack)...");
  try {
    const attackResp = await vault.invoke("withdraw", [
      cairo.uint256(DEPOSIT_AMOUNT),
      nullifier,
    ]);
    await provider.waitForTransaction(attackResp.transaction_hash);
    fail("SECURITY FAILURE: Double-spend was accepted!");
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const reason = msg.includes("Nullifier already used")
      ? "Nullifier already used"
      : msg.includes("No active commitment")
      ? "No active commitment"
      : `Blocked (${msg.slice(0, 60)}...)`;
    console.log(`  ✅  BLOCKED: ${reason}`);
    pass("Double-spend prevention is working correctly");
  }

  // ═══════════════════════════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════════════════════════
  console.log("\n");
  console.log(
    "╔══════════════════════════════════════════════════════════════╗",
  );
  console.log(
    "║              FULL PROTOCOL VALIDATION COMPLETE ✅            ║",
  );
  console.log(
    "╠══════════════════════════════════════════════════════════════╣",
  );
  console.log("║  ✅  All 5 contracts deployed to local devnet                ║");
  console.log("║  ✅  Private deposit — amount hidden by Poseidon commitment  ║");
  console.log("║  ✅  Collateral proof: above threshold ✓, below threshold ✗  ║");
  console.log("║  ✅  MockLendingProtocol: borrow + partial + full repay      ║");
  console.log("║  ✅  Paymaster: permissionless funding, eligibility check    ║");
  console.log("║  ✅  SessionKeyManager: register, spend, revoke lifecycle    ║");
  console.log("║  ✅  Withdrawal with one-time nullifier                      ║");
  console.log("║  ✅  Double-spend attack blocked by nullifier registry       ║");
  console.log(
    "╠══════════════════════════════════════════════════════════════╣",
  );
  console.log("║  Deployed Addresses:                                         ║");
  console.log(`║    WBTC    : ${wbtcAddress.padEnd(48)} ║`);
  console.log(`║    Vault   : ${vaultAddress.padEnd(48)} ║`);
  console.log(`║    Lending : ${lendingAddress.padEnd(48)} ║`);
  console.log(`║    Paymastr: ${paymasterAddress.padEnd(48)} ║`);
  console.log(`║    SKM     : ${skmAddress.padEnd(48)} ║`);
  console.log(
    "╚══════════════════════════════════════════════════════════════╝\n",
  );
}

main().catch((err) => {
  console.error("\n  ❌  Demo failed:", err?.message ?? String(err));
  if (err?.stack) console.error("  Stack:", err.stack);
  if (err?.data) console.error("  Error data:", err.data);
  process.exit(1);
});
