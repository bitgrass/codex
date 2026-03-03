---
name: bitgrass-plot-purchase
description: Agent skill for purchasing Bitgrass tokenized land plots on Base by calling dedicated quote and transaction endpoints.
---

# Bitgrass Plot Purchase Skill

## Agent App
- Domain: `https://dev.bitgrass.com`
- Skill URL: `https://dev.bitgrass.com/.well-known/SKILL.md`
- Network: Base mainnet (`chainId: 8453`)

## What This Skill Does
- Purchases Bitgrass plot NFTs in 3 tiers:
- `Standard` (100m2): public mint on SeaDrop.
- `Premium` (500m2): secondary listing purchase via Seaport/OpenSea fulfillment.
- `Legendary` (1000m2): secondary listing purchase via Seaport/OpenSea fulfillment.

## Contracts
- NFT contract: `0x95273ead1dc63b4d809018f10c3e659c5fb0b8a5`
- SeaDrop contract: `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5`
- SeaDrop conduit: `0x0000a26b00c1F0DF003000390027140000fAa719`

## Endpoints

### `POST /api/agent/plots/quote`
Builds a tier quote without creating side effects.

Request:
```json
{
  "tier": "Standard",
  "quantity": 1
}
```

Response:
- `Standard`: returns SeaDrop mint price (`unitPriceWei`, `totalPriceWei`).
- `Premium` or `Legendary`: returns best active listing (`orderHash`, `protocolAddress`, `tokenId`, `priceWei`).

Side effects:
- None.

Auth:
- None.

### `POST /api/agent/plots/transaction`
Builds the exact transaction payload to submit from the agent wallet.

Request:
```json
{
  "tier": "Premium",
  "buyerAddress": "0xYourAgentWalletAddress",
  "orderHash": "0xOptionalOrderHashFromQuote"
}
```

Response:
- `Standard`: returns SeaDrop transaction fields `to`, `data`, `value`.
- `Premium` or `Legendary`: returns Seaport fulfillment transaction fields:
- `to`, `value`, and either:
- direct `data`, or
- `function` + `inputData` to call on the Seaport contract.

Side effects:
- None at API level. The side effect occurs when the returned transaction is signed and broadcast.

Auth:
- None.

## Agent Execution Flow
1. Call `POST https://dev.bitgrass.com/api/agent/plots/quote` with desired tier.
2. Call `POST https://dev.bitgrass.com/api/agent/plots/transaction` with `buyerAddress` (and `orderHash` if provided).
3. Submit the returned transaction on Base (`chainId: 8453`) from the same buyer wallet.
4. Wait for transaction confirmation and verify NFT transfer.

## Errors
- `400`: invalid request body or invalid address.
- `404`: no active listing available for requested tier.
- `500`: upstream/provider/config issue.

## Notes
- Transactions are irreversible once broadcast.
- Ensure the agent wallet holds enough ETH for price plus gas.
