# CROSS Chain Rewards Staker — Reference

Loaded by Claude only when the SKILL needs underlying contract details (e.g. user asks about ABI, the script throws an unfamiliar revert, or someone is forking the skill).

Discovery probe date: **2026-04-29** at block `31,975,369` (`0x1e7e5c9`).

## Chain

| Field | Value |
|---|---|
| Chain ID | `612055` |
| Default RPC | `https://mainnet.crosstoken.io:22001/` |
| Native token | CROSS (18 decimals) |
| Block explorer | `https://explorer.crosstoken.io/612055` (tx URL: `.../tx/<hash>`) |

Override RPC with `CROSS_RPC_URL`.

## Rewards Contract

| Field | Value |
|---|---|
| Proxy address | `0xd9767038edb5c7ff1735d5a567696947d4907300` |
| Implementation (EIP-1967) | `0xfa8128657a6f1334055ce1acd728fcd9acf00845` |
| Proxy pattern | UUPS (ERC-1967) — minimal-proxy bytecode delegating to impl slot `0x360894…d382bbc` |
| `UPGRADE_INTERFACE_VERSION()` | `"5.0.0"` (OpenZeppelin v5) |
| Owner | `0x22c1522276855b028c31a731ba10d125811af37c` |
| Initialized at block | `31,872,994` |
| Pool status | `0` (active) |
| Paused | `false` |

> The implementation may upgrade. `_chain.mjs` should re-read the EIP-1967 implementation slot at startup if the on-chain ABI ever drifts from this snapshot.

## Confirmed Contract Family

**Custom single-pool, multi-reward staker** — *NOT* MasterChef and *NOT* Synthetix.

Distinctive shape:
- One **deposit token** (singular — `depositToken()`, not per-pool).
- A registry of **N reward tokens** (`getRewardTokens()`, `rewardTokenAt(uint256)`, `rewardTokenCount()`, `addRewardToken`, `removeRewardToken`).
- User state keyed by address only (no `pid` / no `poolInfo`).
- Per-reward-token claim path (`claimReward(address)`) plus a sweep path (`claimRewards()`).
- Operator-style admin paths (`depositFor`, `withdrawFor`, `claimRewardFor`, `claimRewardsFor`).
- Hard `minDepositAmount()` enforced on `deposit` (currently `1.0 WCROSS`).

## Verified ABI Fragments

Each function below was confirmed by either (a) a non-reverting `eth_call` returning the expected shape, or (b) a revert with a typed custom error proving the selector reaches the dispatcher and the calldata layout is accepted.

> Custom errors observed (raw): `0xb873d8a6` (deposit-below-min, returns `(provided, min)`), `0x4d88352e` (withdraw/claim guard, returns one uint), `0xe07c8dba` = `UUPSUnauthorizedCallContext()` (returned only when calling `proxiableUUID()` on the proxy itself — expected).

```jsonc
[
  // ---- Pool state (read) ----
  { "type": "function", "name": "depositToken",     "stateMutability": "view", "inputs": [], "outputs": [{ "type": "address" }] },
  { "type": "function", "name": "getRewardTokens",  "stateMutability": "view", "inputs": [], "outputs": [{ "type": "address[]" }] },
  { "type": "function", "name": "rewardTokenCount", "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "name": "rewardTokenAt",    "stateMutability": "view", "inputs": [{ "type": "uint256" }], "outputs": [{ "type": "address" }] },
  { "type": "function", "name": "isRewardToken",    "stateMutability": "view", "inputs": [{ "type": "address" }], "outputs": [{ "type": "bool" }] },
  { "type": "function", "name": "totalDeposited",   "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "name": "minDepositAmount", "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "name": "poolStatus",       "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint8" }] },
  { "type": "function", "name": "paused",           "stateMutability": "view", "inputs": [], "outputs": [{ "type": "bool" }] },
  { "type": "function", "name": "owner",            "stateMutability": "view", "inputs": [], "outputs": [{ "type": "address" }] },
  { "type": "function", "name": "initializedAt",    "stateMutability": "view", "inputs": [], "outputs": [{ "type": "uint256" }] },

  // ---- User state (read) ----
  { "type": "function", "name": "balances",        "stateMutability": "view", "inputs": [{ "name": "user", "type": "address" }], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "name": "pendingRewards",  "stateMutability": "view", "inputs": [{ "name": "user", "type": "address" }], "outputs": [{ "type": "address[]" }, { "type": "uint256[]" }] },
  { "type": "function", "name": "pendingReward",   "stateMutability": "view", "inputs": [{ "name": "user", "type": "address" }, { "name": "rewardToken", "type": "address" }], "outputs": [{ "type": "uint256" }] },
  { "type": "function", "name": "userRewards",     "stateMutability": "view", "inputs": [{ "name": "user", "type": "address" }, { "name": "rewardToken", "type": "address" }], "outputs": [{ "type": "uint256" }, { "type": "uint256" }] /* 64-byte return; second slot likely rewardDebt — names unverified */ },
  { "type": "function", "name": "getReclaimableAmount", "stateMutability": "view", "inputs": [{ "type": "address" }], "outputs": [{ "type": "uint256" }] },

  // ---- User actions (write) ----
  { "type": "function", "name": "deposit",        "stateMutability": "nonpayable", "inputs": [{ "name": "amount", "type": "uint256" }], "outputs": [] },
  { "type": "function", "name": "withdraw",       "stateMutability": "nonpayable", "inputs": [{ "name": "amount", "type": "uint256" }], "outputs": [] },
  { "type": "function", "name": "claimReward",    "stateMutability": "nonpayable", "inputs": [{ "name": "rewardToken", "type": "address" }], "outputs": [] },
  { "type": "function", "name": "claimRewards",   "stateMutability": "nonpayable", "inputs": [], "outputs": [] },

  // ---- Operator-only actions (selectors confirmed; behavior may revert for non-operators) ----
  { "type": "function", "name": "depositFor",       "stateMutability": "nonpayable", "inputs": [{ "type": "address" }, { "type": "uint256" }], "outputs": [] },
  { "type": "function", "name": "withdrawFor",      "stateMutability": "nonpayable", "inputs": [{ "type": "address" }, { "type": "uint256" }], "outputs": [] },
  { "type": "function", "name": "claimRewardFor",   "stateMutability": "nonpayable", "inputs": [{ "type": "address" }, { "type": "address" }], "outputs": [] },
  { "type": "function", "name": "claimRewardsFor",  "stateMutability": "nonpayable", "inputs": [{ "type": "address" }], "outputs": [] }
]
```

> Functions present in the dispatcher but **NOT** included above (admin-only, not relevant to user CLI): `addRewardToken(address)`, `removeRewardToken(address)`, `setPoolStatus(uint8)`, `updateMinDepositAmount(uint256)`, `reclaimTokens(address,address)`, `upgradeToAndCall(address,bytes)`. Two selectors remain semantically unidentified (`0x1af8acec`, `0x35482379`, `0x9b80c3f2`, `0xf4e24740`); they are not on the user path and are excluded from the verified ABI.

## Calldata Layout

For the three primary write paths the user CLI will hit:

| Op | Selector | Layout (after selector, each slot = 32 bytes) | Notes |
|---|---|---|---|
| `deposit(amount)` | `0xb6b55f25` | `amount` | Caller MUST first `approve(REWARDS_CONTRACT, amount)` on the deposit token. Reverts with custom error `0xb873d8a6(provided, min)` if `amount < minDepositAmount()`. |
| `withdraw(amount)` | `0x2e1a7d4d` | `amount` | Reverts with custom error `0x4d88352e(amount)` on bad amount (`0` or `> balances(user)`). |
| `claimReward(rewardToken)` | `0xd279c191` | `rewardToken (address, left-padded to 32B)` | Per-reward-token claim. Reverts with `0x4d88352e` if no claimable amount. |
| `claimRewards()` | `0x372500ab` | (empty) | Sweeps all reward tokens for caller. Reverts with `0x4d88352e(0)` if nothing to claim. |

The `withdraw(0) → harvest` MasterChef trick **does not work** here — `withdraw(0)` reverts. Use `claimReward` / `claimRewards` to harvest.

## Token Table

### Deposit token (single)

| Field | Value |
|---|---|
| Address | `0x642060e8b44c8f2d6d2974a71a0ca8f995cafbda` |
| Name | `Wrapped CROSS` |
| Symbol | `WCROSS` |
| Decimals | `18` |
| Total supply (snapshot) | `5,194,531.7196 WCROSS` |

> Users will need WCROSS, not native CROSS. If we want a one-shot UX from native CROSS we must add a `wrap()` step via WCROSS's `deposit()` payable (out-of-scope for this reference; flag in Phase 2 if user requests).

### Reward tokens (registry length = 1 at probe time)

| Index | Address | Name | Symbol | Decimals |
|---|---|---|---|---|
| 0 | `0x0a57e254cafeeaccbe84f6f230888a3a3841aecd` | `Chaos World Token` | `CWT` | `18` |

> Registry size may change. Always iterate `getRewardTokens()` rather than hardcoding.

## Sample Pool State (at probe time)

The contract is a **single pool** — no `pid`. Snapshot:

| Field | Value |
|---|---|
| `totalDeposited()` | `1,192,914.99 WCROSS` (`0xfc9c0d1a9e8173ab0000`) |
| `minDepositAmount()` | `1.0 WCROSS` (`1e18`) |
| `paused()` | `false` |
| `poolStatus()` | `0` |
| `getRewardTokens()` | `[ 0x0a57e254cafeeaccbe84f6f230888a3a3841aecd ]` |
| `rewardTokenCount()` | `1` |
| `balances(0x…0001)` (sentinel non-staker) | `0` |
| `pendingRewards(0x…0001)` | `(address[], uint256[])` of length 1, amount `0` |
| `pendingReward(0x…0001, CWT)` | `0` |

Decoded shape verification for `pendingRewards`:
```
0x0000…0040  // offset to address[]
  0x0000…0080  // offset to uint256[]
  0x0000…0001  // address[].length = 1
  0x…0a57e254…aecd  // address[0] = CWT
  0x0000…0001  // uint256[].length = 1
  0x0000…0000  // uint256[0] = 0
```

Confirms `pendingRewards` returns parallel arrays `(address[] rewardTokens, uint256[] amounts)`.

## Smart-wallet caveat

This contract is a UUPS-upgradable OZ-v5 contract. We have **not** observed the DEX-style `0xa7392345` smart-wallet rejection here — the contract appears to accept calls from contract `msg.sender` (no `tx.origin == msg.sender` guard found in the dispatcher snippet). However:

- ERC-4337 / smart-wallet relays remain **untested** against this contract in this skill's v0.1 scope.
- `skill-cross-dex-trade`'s `0xa7392345` paragraph still applies if a user later combines a DEX swap (rejected from contract callers) with a deposit (works from contract callers) inside one bundled UserOperation: only the DEX leg fails.
- v0.1 of `skill-cross-rewards` is **EOA-only** (private key + viem wallet client), matching `skill-cross-dex-trade`. ERC-4337 / paymaster / bundler is out of scope.

## Open questions for next phase

1. **APR / emission schedule.** No `rewardPerBlock`, `rewardRate`, `periodFinish`, or similar global emission view was found in the ABI. Reward accrual mechanics may be push-based (admin pushes rewards via `reclaimTokens` / a separate event-emitter) rather than per-block continuous. **Phase 2 should NOT attempt to display APR** until we trace `Deposit`/`Reward`/`RewardAdded` events from a recent block range. If the user asks for APR, return "unavailable from on-chain state alone — fetch from the official front-end API or off-chain calculator."
2. **`userRewards(user, rewardToken)` field meaning.** Returns 64 bytes (two uint256 slots). Likely `(rewardDebt, accumulated)` or `(paid, accruedSnapshot)`. Phase 3 read scripts should rely on `pendingRewards` / `pendingReward` (whose semantics are unambiguous) and treat `userRewards` as opaque diagnostic-only output.
3. **`harvest` UX.** No dedicated `harvest()` selector exists. The skill's `harvest` subcommand should call `claimRewards()` (sweep all) by default and offer `claimReward(<token>)` for single-token harvesting. The MasterChef-style `withdraw(0)` shortcut does **not** work.
4. **WCROSS wrap UX.** The deposit token is WCROSS, not native CROSS. Phase 2 must decide: (a) require user to pre-wrap, or (b) add an opt-in `--wrap` flag that calls `WCROSS.deposit()` payable before the staker `deposit`. Recommendation: (a) for v0.1, document the requirement loudly in `SKILL.md`.
5. **Operator vs user paths.** `depositFor` / `withdrawFor` / `claimRewardFor` / `claimRewardsFor` likely revert for non-operators. Phase 2 should NOT expose them in the user CLI; if exposed at all, gate behind a `--operator` flag.
6. **Single-pool vs multi-pool URL pattern.** The `/rewards/<addr>` URL on `x.crosstoken.io` may host other staker addresses with the same ABI. Phase 2's `REWARDS_CONTRACT` env var should support override; the default is the address documented above.
