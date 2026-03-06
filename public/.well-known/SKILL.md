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
- Run a single headless onboarding state machine via `/api/agent/privy/otp/onboard`.
- Start/verify email OTP login for fully headless agent onboarding.
- Provision and use Privy agentic wallets (session-based user authorization).
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

### `POST /api/agent/privy/otp/onboard` (recommended)
Single endpoint state machine for headless email onboarding in chat.

Use `step: "send"` to send OTP:
```json
{
  "step": "send",
  "email": "user@example.com"
}
```

Use `step: "verify"` to verify OTP and auto-setup (recommended):
```json
{
  "step": "verify",
  "email": "user@example.com",
  "code": "123456",
  "autoSetup": true,
  "acceptTerms": true,
  "access": "read_write",
  "keyName": "My Agent",
  "enableLlm": false,
  "createWallet": true,
  "chainType": "ethereum"
}
```

Use `step: "setup"` only if you verified OTP with `autoSetup: false`:
```json
{
  "step": "setup",
  "userJwt": "privy_user_access_jwt",
  "acceptTerms": true,
  "access": "read_write",
  "keyName": "My Agent",
  "enableLlm": false,
  "createWallet": true,
  "chainType": "ethereum"
}
```

Response summary:
- `step: send` -> OTP dispatched and `nextStep: verify`.
- `step: verify` -> returns `userJwt`, `userId`, `wallet`, `session`, `preferences` when `autoSetup=true`.
- `step: setup` -> returns final `wallet`, `session`, and `preferences`.

### `POST /api/agent/privy/otp/send`
Starts headless email OTP login (no browser flow required).

Request:
```json
{
  "email": "user@example.com"
}
```

Response:
- OTP is sent to user email.
- Agent should ask user for OTP code, then call `/api/agent/privy/otp/verify`.

### `POST /api/agent/privy/otp/verify`
Verifies OTP, creates Privy user if missing, and can auto-create first wallet.

Request:
```json
{
  "email": "user@example.com",
  "code": "123456",
  "createWallet": true,
  "chainType": "ethereum",
  "acceptTerms": true,
  "access": "read_write",
  "keyName": "My Agent",
  "enableLlm": false
}
```

Response:
- `userJwt` (Privy access JWT for next calls)
- `userId`
- `wallet` (`id`, `address`) when `createWallet=true`
- optional `session.authorizationKey` and preferences

### `POST /api/agent/privy/agentic/setup`
First-time setup for agentic wallet access using `userJwt` (typically returned by OTP verify endpoint).
Creates wallet if missing, authenticates wallet session, and stores user preferences.
Requires user to have an email linked account (OTP/email login flow).

Request:
```json
{
  "userJwt": "privy_user_access_jwt",
  "acceptTerms": true,
  "access": "read_write",
  "keyName": "My Agent",
  "enableLlm": false,
  "chainType": "ethereum",
  "policyId": "optional_policy_id"
}
```

Response:
- `wallet` (`id`, `address`)
- `session.authorizationKey` (or encrypted key variant) and `expiresAt`
- normalized `preferences`
- For new users: this endpoint creates the first wallet automatically after OTP login succeeds.

### `POST /api/agent/privy/agentic/policy`
Creates an EVM allowlist policy for agent transaction guardrails.

Request:
```json
{
  "userJwt": "privy_user_access_jwt",
  "name": "bitgrass-agent-policy",
  "allowedContractAddresses": [
    "0x95273ead1dc63b4d809018f10c3e659c5fb0b8a5",
    "0xAbdD77516765235e3121773bcB4E33984c604D7C"
  ],
  "maxValueWei": "350000000000000000",
  "chainId": 8453
}
```

Response:
- created `policy.id` and rule details.

### `POST /api/agent/privy/agentic/send-transaction`
Signs and broadcasts an Ethereum transaction via Privy wallet service using user JWT authorization context.
Requires user to have an email linked account (OTP/email login flow).

Request:
```json
{
  "userJwt": "privy_user_access_jwt",
  "walletId": "wallet_xxx",
  "caip2": "eip155:8453",
  "transaction": {
    "to": "0x95273ead1dc63b4d809018f10c3e659c5fb0b8a5",
    "data": "0x...",
    "value": "0"
  }
}
```

Response:
- transaction `hash` and `caip2`.

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

## First-Time Setup
### Headless Email OTP Login (recommended for agents)
When user chats with an external agent (OpenClaw, X bot, etc.), do not ask them to open the dApp UI.

### Clear Step-by-Step Script (for external agents)
Step 1 - Ask email
1. Ask: "What email should I use to create your Bitgrass wallet?"
2. Call `/api/agent/privy/otp/onboard` with:
```json
{
  "step": "send",
  "email": "user@example.com"
}
```
3. Tell user: "I sent a 6-digit OTP to your email. Reply with the OTP."

Step 2 - Collect required preferences before verify
1. Ask Terms confirmation (must be explicit):
   - "Do you accept Bitgrass Terms so I can create and operate your wallet?"
2. Ask access mode:
   - `read_only` or `read_write`.
3. Ask optional preferences:
   - key name (`keyName`) and LLM toggle (`enableLlm`).

Step 3 - Verify OTP + create wallet + finalize setup in one call
1. Call `/api/agent/privy/otp/onboard`:
```json
{
  "step": "verify",
  "email": "user@example.com",
  "code": "123456",
  "autoSetup": true,
  "acceptTerms": true,
  "access": "read_write",
  "keyName": "My Agent",
  "enableLlm": false,
  "createWallet": true,
  "chainType": "ethereum"
}
```
2. Save:
   - `userJwt`
   - `wallet.id`
   - `wallet.address`
3. User is now ready for onchain actions.

Step 4 - Execute actions
1. Build tx via Bitgrass action endpoints.
2. Broadcast via `/api/agent/privy/agentic/send-transaction` using `userJwt + wallet.id`.

Setup command examples:
```bash
curl -X POST "https://dev.bitgrass.com/api/agent/privy/otp/onboard" \
  -H "Content-Type: application/json" \
  -d '{
    "step":"send",
    "email":"user@example.com"
  }'
```

```bash
curl -X POST "https://dev.bitgrass.com/api/agent/privy/otp/onboard" \
  -H "Content-Type: application/json" \
  -d '{
    "step":"verify",
    "email":"user@example.com",
    "code":"123456",
    "autoSetup":true,
    "acceptTerms":true,
    "access":"read_write",
    "keyName":"My Agent",
    "enableLlm":false,
    "createWallet":true,
    "chainType":"ethereum"
  }'
```

```bash
curl -X POST "https://dev.bitgrass.com/api/agent/privy/otp/onboard" \
  -H "Content-Type: application/json" \
  -d '{
    "step":"setup",
    "userJwt":"<privy_user_jwt_from_otp_login>",
    "acceptTerms":true,
    "access":"read_only",
    "keyName":"Research Bot",
    "chainType":"ethereum"
  }'
```

Setup options reference:
- `step`: `send` | `verify` | `setup`.
- `userJwt`: required for `setup`; returned by `verify`.
- `acceptTerms`: required for `setup` and for `verify` when `autoSetup=true`.
- `access`: `read_only` or `read_write`.
- `keyName`: optional display label.
- `enableLlm`: optional preference flag.
- `chainType`: `ethereum` or `solana`.
- `policyId`: optional policy guardrail id.
- `autoSetup`: when `true`, `verify` also runs full setup and wallet session auth.

Policy + execution after setup:
1. Optional: create policy via `/api/agent/privy/agentic/policy`.
2. Build tx using Bitgrass action endpoints.
3. Broadcast with `/api/agent/privy/agentic/send-transaction` (`userJwt + walletId`).

Important notes:
- No pre-existing Privy account is required.
- First-time users are supported end-to-end.
- OTP flow is fully headless: user stays in chat with the agent.
- Transactions are handled by Privy wallet service.
- Do not attempt wallet setup/transaction before OTP verification.

## Agent Workflow
1. Optional: call `/api/agent/chat` to parse user instruction into an intent.
2. Call the matching dedicated endpoint from this skill.
3. If endpoint returns transaction payload(s), submit them from the user wallet on Base.
4. Wait for confirmation and then refresh state with read endpoints.

## Errors
- `400`: invalid body or invalid address.
- `404`: no eligible assets/listings found for requested action.
- `500`: upstream RPC/indexer/provider failure.
