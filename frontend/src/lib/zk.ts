/**
 * ZK Range Proof utilities for ShieldedBTC Collateral Protocol.
 *
 * Architecture:
 *   1. At deposit time – frontend computes BN254 Poseidon2 commitment:
 *        computeBN254Commitment(amount, secret)
 *        → executes commitment_calculator.json (tiny Noir circuit) via noir_js
 *        → returns commitment = poseidon2_permutation([amount, secret, 0, 0], 4)[0]
 *        → commitment is stored on-chain alongside the Stark-field commitment
 *
 *   2. At borrow time – frontend generates a ZK range proof:
 *        generateRangeProof(amount, secret, bn254Commitment, threshold)
 *        → executes range_proof.json witness via noir_js
 *        → generates UltraKeccakZKHonk proof via bb.js WASM
 *        → converts to Starknet calldata via Garaga getZKHonkCallData
 *        → calldata is passed to CollateralVault.prove_collateral()
 *
 * Circuits:
 *   circuits/range_proof/src/main.nr          → public/circuits/range_proof.json
 *   circuits/commitment_calculator/src/main.nr → public/circuits/commitment_calculator.json
 *   VK: public/circuits/vk.b64 (Barretenberg UltraKeccakZKHonk VK)
 *
 * Dependencies:
 *   @noir-lang/noir_js@1.0.0-beta.16
 *   @aztec/bb.js@3.0.0-nightly.20251104
 *   garaga@1.0.1
 */

import { Noir, type CompiledCircuit } from "@noir-lang/noir_js";
import { UltraHonkBackend } from "@aztec/bb.js";
import { getZKHonkCallData, init as initGaraga } from "garaga";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ZKProofResult {
  proof: Uint8Array;
  publicInputs: string[];
  /** Span<felt252> calldata ready for Starknet transaction */
  calldata: string[];
}

export interface CommitmentResult {
  /** Hex-encoded BN254 Poseidon2 commitment (matches circuit output) */
  commitment: string;
}

// ─── Cache ────────────────────────────────────────────────────────────────────

let _rangeCircuitCache: CompiledCircuit | null = null;
let _commitmentCircuitCache: CompiledCircuit | null = null;
let _vkCache: Uint8Array | null = null;
let _garagaInitialized = false;

// ─── Loaders ──────────────────────────────────────────────────────────────────

async function loadRangeCircuit(): Promise<CompiledCircuit> {
  if (_rangeCircuitCache) return _rangeCircuitCache;
  const res = await fetch("/circuits/range_proof.json");
  if (!res.ok) throw new Error(`Failed to load range_proof circuit: ${res.status}`);
  _rangeCircuitCache = (await res.json()) as CompiledCircuit;
  return _rangeCircuitCache;
}

async function loadCommitmentCircuit(): Promise<CompiledCircuit> {
  if (_commitmentCircuitCache) return _commitmentCircuitCache;
  const res = await fetch("/circuits/commitment_calculator.json");
  if (!res.ok) throw new Error(`Failed to load commitment_calculator circuit: ${res.status}`);
  _commitmentCircuitCache = (await res.json()) as CompiledCircuit;
  return _commitmentCircuitCache;
}

async function loadVk(): Promise<Uint8Array> {
  if (_vkCache) return _vkCache;
  const res = await fetch("/circuits/vk.b64");
  if (!res.ok) throw new Error(`Failed to load VK: ${res.status}`);
  const b64 = (await res.text()).trim();
  _vkCache = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return _vkCache;
}

async function ensureGaragaInit(): Promise<void> {
  if (_garagaInitialized) return;
  await initGaraga();
  _garagaInitialized = true;
}

// ─── BN254 Commitment ─────────────────────────────────────────────────────────

/**
 * Compute the BN254 Poseidon2 commitment for (amount, secret).
 *
 * Uses a tiny helper Noir circuit (commitment_calculator.json) that has the
 * exact same hash logic as the range proof circuit:
 *   poseidon2_permutation([amount_field, secret, 0, 0], 4)[0]
 *
 * This guarantees the on-chain commitment matches what the prover uses.
 *
 * @param amount  - BTC amount in satoshis (bigint)
 * @param secret  - 32-byte secret as hex string (0x-prefixed)
 * @returns       - Hex-encoded BN254 Poseidon2 commitment (0x-prefixed, 64 hex chars)
 */
export async function computeBN254Commitment(
  amount: bigint,
  secret: string
): Promise<string> {
  const circuit = await loadCommitmentCircuit();
  const noir = new Noir(circuit);

  const normalizedSecret = secret.startsWith("0x") ? secret : "0x" + secret;

  const inputs = {
    amount: amount.toString(),
    secret: normalizedSecret,
  };

  const { returnValue } = await noir.execute(inputs);

  // returnValue is the pub Field return from main() — a hex string
  const commitment = returnValue as string;
  const hex = commitment.startsWith("0x") ? commitment.slice(2) : commitment;
  return "0x" + hex.padStart(64, "0");
}

// ─── ZK Proof Generation ──────────────────────────────────────────────────────

/**
 * Generate a UltraKeccakZKHonk range proof for the collateral.
 *
 * Proves (in zero-knowledge):
 *   - poseidon2([amount, secret, 0, 0], 4)[0] == commitment  (preimage knowledge)
 *   - amount > threshold                                      (range check)
 *
 * Reveals to verifier: commitment, threshold (already public on-chain)
 * Keeps private:       amount, secret
 *
 * Typical browser proof time: 3–10 seconds (WASM Barretenberg).
 *
 * @param amount          - BTC collateral in satoshis
 * @param secret          - 32-byte secret hex (0x-prefixed, same as used at deposit)
 * @param bn254Commitment - BN254 commitment stored on-chain at deposit time
 * @param threshold       - Minimum required amount in satoshis
 */
export async function generateRangeProof(
  amount: bigint,
  secret: string,
  bn254Commitment: string,
  threshold: bigint
): Promise<ZKProofResult> {
  if (amount <= threshold) {
    throw new Error(
      `Collateral amount (${amount} sats) must be greater than threshold (${threshold} sats)`
    );
  }

  const [circuit, vk] = await Promise.all([
    loadRangeCircuit(),
    loadVk(),
    ensureGaragaInit(),
  ]);

  const noir = new Noir(circuit);

  // UltraHonkBackend: acirBytecode is the base64-encoded bytecode string
  // keccakZK = true → UltraKeccakZKHonk (matches garaga gen --system ultra_keccak_zk_honk)
  const backend = new UltraHonkBackend(circuit.bytecode, {
    threads: navigator.hardwareConcurrency ?? 4,
  });

  try {
    const inputs = {
      amount: amount.toString(),
      secret: secret.startsWith("0x") ? secret : "0x" + secret,
      commitment: bn254Commitment,
      threshold: threshold.toString(),
    };

    // Step 1: Solve circuit — compute witness via ACVM
    const { witness } = await noir.execute(inputs);

    // Step 2: Generate UltraKeccakZKHonk proof via Barretenberg WASM
    // keccakZK: true → matches the Cairo verifier generated by `garaga gen --system ultra_keccak_zk_honk`
    const { proof, publicInputs } = await backend.generateProof(witness, {
      keccakZK: true,
    });

    // Step 3: Convert string[] publicInputs to Uint8Array for Garaga
    // Each field element is 32 bytes (256-bit BN254 field)
    const publicInputsBytes = new Uint8Array(publicInputs.length * 32);
    publicInputs.forEach((pi, i) => {
      const hex = (pi.startsWith("0x") ? pi.slice(2) : pi).padStart(64, "0");
      for (let j = 0; j < 32; j++) {
        publicInputsBytes[i * 32 + j] = parseInt(hex.slice(j * 2, j * 2 + 2), 16);
      }
    });

    // Step 4: Convert proof + publicInputs + VK to Starknet Span<felt252> calldata
    // getZKHonkCallData returns bigint[] to be passed to ZKRangeProofVerifier.verify_range_proof()
    const calldataBigInts = getZKHonkCallData(proof, publicInputsBytes, vk);
    const calldata = calldataBigInts.map((x) => "0x" + x.toString(16));

    return {
      proof,
      publicInputs,
      calldata,
    };
  } finally {
    await backend.destroy();
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure random secret for BN254 field.
 * Uses 31 bytes (248 bits) to safely stay under the BN254 scalar field order.
 */
export function generateBN254Secret(): string {
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  bytes[0] = Math.max(1, bytes[0]); // ensure non-zero
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

/**
 * Encode a satoshi threshold as a Starknet u256 struct { low: felt252, high: felt252 }.
 */
export function thresholdToU256(threshold: bigint): { low: string; high: string } {
  const MAX_U128 = (1n << 128n) - 1n;
  return {
    low: "0x" + (threshold & MAX_U128).toString(16),
    high: "0x" + (threshold >> 128n).toString(16),
  };
}

/**
 * Check if ZK proof generation is supported in this browser.
 * Requires WebAssembly support (all modern browsers).
 */
export function isZKSupported(): boolean {
  return (
    typeof WebAssembly !== "undefined" &&
    typeof WebAssembly.instantiate === "function"
  );
}
