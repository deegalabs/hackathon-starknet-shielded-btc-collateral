# 🔗 Integration Guide — Shielded BTC Collateral Protocol

This guide shows how to integrate the Shielded Collateral Protocol into your DeFi protocol to accept private BTC collateral.

---

## Overview

Integration requires a single function call:

```cairo
ICollateralVaultDispatcher { contract_address: VAULT_ADDRESS }
    .prove_collateral(user: ContractAddress, threshold: u256) -> bool
```

Return value:
- `true` — user's committed collateral exceeds `threshold`
- `false` — user has no commitment or (production) proof is invalid

---

## Step 1: Add the Interface

```cairo
// In your protocol's src/interfaces/icollateral_vault.cairo

#[starknet::interface]
trait ICollateralVault<TContractState> {
    fn prove_collateral(
        self: @TContractState,
        user: starknet::ContractAddress,
        threshold: u256,
    ) -> bool;

    fn get_commitment(
        self: @TContractState,
        user: starknet::ContractAddress,
    ) -> felt252;
}
```

---

## Step 2: Import in Your Contract

```cairo
use your_protocol::interfaces::icollateral_vault::{
    ICollateralVaultDispatcher,
    ICollateralVaultDispatcherTrait,
};
```

---

## Step 3: Store the Vault Address

```cairo
#[storage]
struct Storage {
    collateral_vault: starknet::ContractAddress,
    // ... your other storage
}

#[constructor]
fn constructor(ref self: ContractState, vault_address: starknet::ContractAddress) {
    self.collateral_vault.write(vault_address);
}
```

---

## Step 4: Verify Collateral in Your Logic

### Lending Protocol Example

```cairo
#[external(v0)]
fn borrow(
    ref self: ContractState,
    borrow_amount: u256,
) {
    let caller = starknet::get_caller_address();

    // Calculate required collateral (e.g., 150% collateralization ratio)
    let required_collateral = borrow_amount * 150_u256 / 100_u256;

    // Verify collateral without learning the user's actual holdings
    let vault = ICollateralVaultDispatcher {
        contract_address: self.collateral_vault.read()
    };
    let has_collateral = vault.prove_collateral(caller, required_collateral);

    assert(has_collateral, 'Insufficient collateral');

    // Proceed with loan
    // ...
}
```

### Derivatives Protocol Example

```cairo
#[external(v0)]
fn open_position(
    ref self: ContractState,
    size: u256,
    leverage: u256,
) {
    let caller = starknet::get_caller_address();

    // Required margin = position_size / leverage
    let required_margin = size / leverage;

    let vault = ICollateralVaultDispatcher {
        contract_address: self.collateral_vault.read()
    };
    assert(
        vault.prove_collateral(caller, required_margin),
        'Insufficient margin'
    );

    // Execute trade
    // ...
}
```

### CDP / Stablecoin Example

```cairo
#[external(v0)]
fn mint_stablecoin(
    ref self: ContractState,
    mint_amount: u256,
) {
    let caller = starknet::get_caller_address();

    // Get BTC price from oracle
    let btc_price = self.oracle.get_btc_usd_price();

    // Required BTC collateral in satoshis (150% ratio, USD-denominated)
    let required_btc_usd = mint_amount * 150_u256 / 100_u256;
    let required_btc_sats = required_btc_usd * 100_000_000_u256 / btc_price;

    let vault = ICollateralVaultDispatcher {
        contract_address: self.collateral_vault.read()
    };
    assert(
        vault.prove_collateral(caller, required_btc_sats),
        'Insufficient BTC collateral'
    );

    // Mint stablecoin
    // ...
}
```

---

## TypeScript Integration (Frontend)

```typescript
import { Contract, CallData } from 'starknet';
import vaultAbi from './abis/CollateralVault.json';

const VAULT_ADDRESS = '0x...'; // Deployed vault address

const vault = new Contract(vaultAbi, VAULT_ADDRESS, provider);

// Check if user has sufficient collateral
async function checkCollateral(
    userAddress: string,
    thresholdSats: bigint
): Promise<boolean> {
    const result = await vault.prove_collateral(userAddress, thresholdSats);
    return result === 1n; // felt252 true = 1
}

// Example: check if user has > 1.5 BTC
const hasSufficientCollateral = await checkCollateral(
    userAddress,
    150_000_000n // 1.5 BTC in satoshis
);
```

---

## Contract Addresses

### Testnet (Sepolia)

| Contract | Address |
|----------|---------|
| CollateralVault | TBD — see [README.md](../README.md) after deploy |
| MockWBTC | TBD |

### Mainnet (Post-Audit)

| Contract | Address |
|----------|---------|
| CollateralVault | TBD |

---

## Questions and Support

- 📧 [dev@deegalabs.com](mailto:dev@deegalabs.com)
- 💬 [Telegram](https://t.me/deegadan)
- 🐦 [@deegalabs](https://twitter.com/deegalabs)
