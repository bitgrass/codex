---
name: bitgrass-agent-actions
description: Agent skill for Bitgrass on Base. Supports chat intent parsing plus dedicated endpoints for plot purchase, staking, unstaking, BCO2 rewards, wallet reads, leaderboard reads, transfer tx building, and swap quotes.
---

# Bitgrass Agent Actions Skill

## Agent App
- Domain: `https://dev.bitgrass.com`
- Skill URL: `https://dev.bitgrass.com/.well-known/SKILL.md`
- Network: Base mainnet (`chainId: 8453`)

## Supported Functions
- Parse user intent using `chat`.
- Buy plots (`Standard`, `Premium`, `Legendary`).
- Stake and unstake plots by token IDs, tier, or all.
- Check current and total BCO2 earnings.
- Build claim BCO2 transactions.
- Check wallet balances and NFT plots.
- Check leaderboard rank, top users, and BTG claim amount.
- Build ETH/USDC transfer transactions.
- Fetch ETH/USDC swap quotes.

## Contracts
- NFT contract: `0x95273ead1dc63b4d809018f10c3e659c5fb0b8a5`
- SeaDrop contract: `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5`
- SeaDrop conduit: `0x0000a26b00c1F0DF003000390027140000fAa719`
- Legendary staking pool: `0xAbdD77516765235e3121773bcB4E33984c604D7C`
- Premium staking pool: `0xCe6409e0146ffFa252Dbb3105c1D5285c73b4274`
- Standard staking pool: `0xE70886Db1d0F52B3B8Ced3538E048d8263C16302`
- Reward token (BCO2): `0x20429F731096e359910921994A267d32ef576720`
- USDC (Base): `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Endpoints

### `POST /api/agent/chat`
Parses natural language into an intent object. Does not execute transactions.

Request:
```json
{
  "message": "stake all my standard plots",
  "walletConnected": true,
  "address": "0xYourAgentWalletAddress"
}
```

Response:
- `reply` text.
- `intent` object (`swap`, `transfer`, `balance`, `nfts`, `current_earnings`, `total_earned`, `claim_bco2`, `leaderboard_rank`, `leaderboard_top`, `btg_claim`, `stake`, `unstake`, `buy_plot`, or `unknown`).

### `POST /api/agent/swap/quote`
Fetches a swap quote for `ETH <-> USDC`.

Request:
```json
{
  "amount": "0.01",
  "fromSymbol": "ETH",
  "toSymbol": "USDC"
}
```

Response:
- Normalized request fields.
- Raw quote payload in `quote`.

### `POST /api/agent/transfer/transaction`
Builds transaction payload for ETH or USDC transfer.

Request:
```json
{
  "symbol": "USDC",
  "amount": "10",
  "toAddress": "0xRecipientAddress"
}
```

Response:
- `transaction.to`
- `transaction.data`
- `transaction.value`

### `POST /api/agent/wallet/balance`
Returns ETH and USDC balances.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress"
}
```

Response:
- `balances.ETH` and `balances.USDC` (raw + formatted).

### `POST /api/agent/wallet/nfts`
Returns wallet plot NFTs with staked/available status.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress",
  "limit": 80
}
```

Response:
- `items[]` with `tokenId`, `name`, `image`, `status`.

### `POST /api/agent/rewards/current`
Returns current claimable BCO2 from staking pools.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress"
}
```

Response:
- Current rewards by pool and total.

### `POST /api/agent/rewards/total`
Returns total historically earned BCO2 (indexed transfers).

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress"
}
```

Response:
- Historical totals by pool and overall.

### `POST /api/agent/rewards/claim/transaction`
Builds claim transactions for pools with non-zero rewards.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress"
}
```

Response:
- `transactions[]` (one `claimRewards()` tx per eligible pool).
- `claimable` totals.

### `POST /api/agent/leaderboard/top`
Returns top leaderboard users.

Request:
```json
{
  "count": 10
}
```

Response:
- Ranked rows with `legendary`, `premium`, `standard`, `btgClaim`.

### `POST /api/agent/leaderboard/rank`
Returns leaderboard rank for a wallet.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress"
}
```

Response:
- `found`, `rank`, `total`, and row details.

### `POST /api/agent/leaderboard/btg-claim`
Returns BTG claim amount for a wallet from leaderboard row.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress"
}
```

Response:
- `btgClaim`, plus rank/row metadata.

### `POST /api/agent/plots/quote`
Builds quote for plot purchase.

Request:
```json
{
  "tier": "Premium",
  "quantity": 1
}
```

### `POST /api/agent/plots/transaction`
Builds purchase transaction payload.

Request:
```json
{
  "tier": "Premium",
  "buyerAddress": "0xYourAgentWalletAddress",
  "orderHash": "0xOptionalOrderHashFromQuote"
}
```

### `POST /api/agent/staking/status`
Returns staked token IDs and pending rewards by pool.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress"
}
```

### `POST /api/agent/staking/stake/transaction`
Builds approval + stake transactions grouped by pool.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress",
  "stakeAll": true,
  "tier": "Standard"
}
```

### `POST /api/agent/staking/unstake/transaction`
Builds unstake transactions grouped by pool.

Request:
```json
{
  "walletAddress": "0xYourAgentWalletAddress",
  "unstakeAll": true,
  "tier": "Standard"
}
```

## Execution Rules
- Execute transactions only after user confirmation.
- For endpoints returning `transactions[]`, execute in returned order.
- Use Base chain `8453` for all transactions.
- Treat all onchain actions as irreversible.

## Agent Workflow
1. Optional: call `/api/agent/chat` to parse user instruction into an intent.
2. Call the matching dedicated endpoint from this skill.
3. If endpoint returns transaction payload(s), submit them from the user wallet on Base.
4. Wait for confirmation and then refresh state with read endpoints.

## Errors
- `400`: invalid body or invalid address.
- `404`: no eligible assets/listings found for requested action.
- `500`: upstream RPC/indexer/provider failure.
