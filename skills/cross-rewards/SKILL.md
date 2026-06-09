---
name: cross-rewards
description: This skill should be used when the user asks to list, view, or manage CROSS Chain reward pools exposed by https://x.crosstoken.io/rewards — multiple single-pool, multi-reward contracts (CrossPool asset = WCROSS; GamePool asset varies, e.g. CROMx). The pool catalog is fetched live from cross-game-reward-api.crosstoken.io. Pass --pool <reward-symbol|address|pool_id> to target a specific pool. Triggers on phrases like "rewards 풀 목록", "보상 수령", "WCROSS pool", "RUBYx pool", "GHUBx rewards", "내 pool 잔고", "내 풀 정보".
version: 0.2.0
license: MIT
---

# CROSS Chain Rewards Staker

A distributable skill that lets Claude read pool/user state and execute the supported reward-pool write commands exposed at `https://x.crosstoken.io/rewards`. Execution path is **EOA + viem** — no ERC-4337 / paymaster.

> **Scope (v0.2):** Multi-pool — the catalog is fetched live from `https://cross-game-reward-api.crosstoken.io/api/v1/pools`. Each pool is its own contract; the pool asset is **WCROSS** for `CrossPool` rows and varies for `GamePool` rows (e.g. CROMx). Reward registry per pool is dynamic — the skill always iterates `getRewardTokens()`. Operator-only variants are **not** exposed. The `--pool <key>` flag routes commands to a specific contract; without it, the skill targets the legacy default `0xd9767038edb5c7ff1735d5a567696947d4907300` (CWT pool).
>
> Deeper protocol details (verified ABI, calldata layouts, custom-error selectors, smart-wallet caveat) live in `references/cross-rewards.md`. Read it only when needed — it stays out of context otherwise.

---

## 1. Activation

Activate when the user wants to:

- **List** every available reward pool with its reward symbol, deposit token, and total deposited
- Inspect a specific pool — depositToken, reward tokens, total deposited, min deposit, paused, their own staked balance, their pending rewards
- Stake / un-stake the deposit token into / out of any reward pool
- Claim accrued reward tokens (sweep all, or a single token by address) for a specific pool
- Optionally wrap native CROSS into WCROSS before depositing (only valid for CrossPool / WCROSS-deposit pools)

Trigger phrases (Korean + English, ≥ 6):

- `"rewards 풀 목록"` / `"내 풀 목록"` / `"list cross reward pools"`
- `"rewards 풀 보여줘"` / `"내 풀 정보"` / `"info CWT pool"`
- `"내 stake 잔고"` / `"show my cross staking balance"`
- `"WCROSS 1.5 예치"` / `"deposit 2 WCROSS to RUBYx pool"`
- `"전부 출금"` / `"withdraw all from SHILTZX pool"`
- `"보상 수령"` / `"harvest GHUBx rewards"`
- `"CWT 보상만 받아줘"` / `"claim only CWT reward"`
- `"WCROSS stake"` / `"wcross deposit"`

If the user names a specific pool by reward symbol (CWT, RUBYx, SHILTZX, CROMx, PINKX, RAINBOWX, BLUEX, DBS, GHUBx, CROSSD, …) or by contract address, route every subcommand with `--pool <key>`. If they ask about web-UI features (front-end APR display, history) tell them this skill is on-chain-only and stop.

---

## 2. Prerequisites — verify before doing anything else

Run these checks in order. Stop and report to the user at the first failure.

```bash
node --version          # require >= 20
```

Then ensure the script's deps are installed (one-time):

```bash
SKILL_DIR="$HOME/.claude/skills/cross-rewards"
[ -d "$SKILL_DIR/node_modules" ] || (cd "$SKILL_DIR" && npm install --silent)
```

---

## 3. Credential resolution — strict priority

Resolve the staking EOA in this order. **Never echo wallet secrets back to the user, never write them into the conversation transcript, never log them, and never ask the user to paste them into chat.**

1. **`./.env` in the user's current working directory** — read `PRIVATE_KEY` and (optionally) `WALLET_ADDRESS`, `CROSS_RPC_URL`, `MAX_STAKE_NOTIONAL`, `CONFIRM_THRESHOLD`, `MIN_GAS_CROSS`, `REWARDS_CONTRACT`.
2. **`$HOME/.claude/skills/cross-rewards/.env`** — same vars, used as the personal default.
3. **Local signer config unavailable** — if both files lack `PRIVATE_KEY`, stop and point the user to `~/.claude/skills/cross-rewards/.env`:

   ```bash
   PRIVATE_KEY=<0x-prefixed-64-hex-secret>
   MAX_STAKE_NOTIONAL=10
   CONFIRM_THRESHOLD=1
   MIN_GAS_CROSS=0.001
   ```

   Then ask them to re-run the request. Do not collect the secret in chat, and do not pass it on the command line.

For personal testing, the default `env` backend reads the key from local
environment variables or a gitignored `.env` file. For team, hosted-agent, or
production funds, prefer Vault Transit, KMS, or HSM-backed signing so the raw
key is not exported to the agent runtime.

Validation: the value must match `^0x[0-9a-fA-F]{64}$`. Reject otherwise without retrying silently.

---

## 4. Safety rails — apply every time

Before submitting any tx (the bundled scripts also enforce these — never bypass):

1. **Chain id check** — every script verifies `eth_chainId == 612055` before broadcasting and aborts otherwise.
2. **`MAX_STAKE_NOTIONAL` cap** — if env sets it, the script aborts when a single deposit's WCROSS amount exceeds it. Recommend `MAX_STAKE_NOTIONAL=10` to new users.
3. **`CONFIRM_THRESHOLD` + `--confirm` gate** — any deposit/withdraw amount > `CONFIRM_THRESHOLD` (default `1` WCROSS) aborts with `{ok:false, error:"awaiting_confirm", parsedIntent}` exit 2 unless invoked with `--confirm`. Re-invoke with `--confirm` ONLY after an explicit user "yes / 진행". For `harvest`, the same gate fires when any single pending reward amount exceeds the threshold.
4. **Native CROSS gas pre-flight** — every write op aborts before signing if the EOA's native CROSS balance < `MIN_GAS_CROSS` (default `0.001`).
5. **`minDepositAmount()` guard** — `deposit.mjs` reads on-chain min and aborts if the requested amount is below it (currently `1.0 WCROSS`).
6. **`--wrap` only when asked** — never silently consume native CROSS. The `--wrap` flag is opt-in. Without it, the write command aborts with `insufficient_wcross` if the configured address has too little WCROSS.
7. **WALLET_ADDRESS mismatch warning** — if the env-declared address doesn't match the address derived from the PK, the JSON envelope includes `signerWarn`; surface that to the user before continuing.

---

## 5. Execution

All subcommands run via Bash and emit a **single JSON object on stdout** (no decorative prose). Parse the envelope and report key fields back. Stderr stays empty unless `DEBUG=1`.

```bash
cd "$HOME/.claude/skills/cross-rewards"
# Load .env — the scripts also auto-load it via dotenv/config, but if you
# resolved a different .env in step 3, use:
#   set -a; source <path-to-env>; set +a; node scripts/<subcommand>.mjs ...
node scripts/<subcommand>.mjs [args]
```

### Pool targeting

Every read/write subcommand (except `pools`) accepts `--pool <key>`. The key may be:

- A **reward-token symbol** (case-insensitive): `CWT`, `RUBYx`, `SHILTZX`, `CROMx`, `PINKX`, `RAINBOWX`, `BLUEX`, `DBS`, `GHUBx`, `CROSSD`, …
- A **contract address** (`0x…`)
- A **pool_id** integer (as returned by `pools`)
- A unique **substring** of `pool_name`

Without `--pool`, commands target the legacy default (`0xd9767038…4907300`, the CWT pool) unless `REWARDS_CONTRACT` env is set. Always run `pools` first when the user is unsure which pool they mean.

### NL → subcommand map

| User says (KR / EN) | Subcommand |
|---|---|
| "rewards 풀 목록" / "list pools" / "내 풀 목록" | `node scripts/pools.mjs` |
| "CWT 풀 정보 보여줘" / "show RUBYx pool info" | `node scripts/info.mjs --pool CWT` (resp. `--pool RUBYx`) |
| "내 잔고 (CWT 풀)" / "show my staking balance for SHILTZX pool" | `node scripts/balance.mjs --pool CWT` |
| "RUBYx 풀에 1.5 WCROSS 예치" / "deposit 1.5 WCROSS to RUBYx pool" *(below CONFIRM_THRESHOLD)* | `node scripts/deposit.mjs 1.5 --pool RUBYx` |
| "5 WCROSS 예치해줘 (CWT 풀)" / "deposit 5 to CWT pool" *(above threshold)* | confirm → `node scripts/deposit.mjs 5 --pool CWT --confirm` |
| "5 WCROSS wrap 후 예치" / "wrap and deposit 5 to CWT pool" | confirm → `node scripts/deposit.mjs 5 --pool CWT --wrap --confirm` |
| "RUBYx 풀에서 전부 출금" / "withdraw all from RUBYx pool" | confirm → `node scripts/withdraw.mjs all --pool RUBYx --confirm` |
| "0.5 WCROSS 출금 (CWT 풀)" / "withdraw 0.5 from CWT pool" *(below threshold)* | `node scripts/withdraw.mjs 0.5 --pool CWT` |
| "GHUBx 풀 보상 수령" / "harvest GHUBx pool" | confirm if any pending > threshold → `node scripts/harvest.mjs --pool GHUBx --confirm` |
| "CWT만 수령" / "claim only CWT in CWT pool" | `node scripts/harvest.mjs <CWT-address> --pool CWT --confirm` |

### Subcommand cheat-sheet

- `pools` — fetch the live pool catalog from cross-game-reward-api. Returns address, type (CrossPool/GamePool), status, deposit symbol, reward symbols, and total notional for every pool. Read-only, no PK needed.
- `info [--pool <key>]` — pool detail + (if PK loaded) user staked + pendingRewards for the resolved pool. Read-only.
- `balance [--pool <key>]` — configured-address snapshot: native CROSS, pool-asset balance, pool position, pending rewards, claimed reward-token balances for the resolved pool.
- `deposit <amount> [--pool <key>] [--wrap] [--confirm]` — approve (if short) → `deposit(amount)` on the resolved pool. `--wrap` only legal when the resolved pool's depositToken is WCROSS; otherwise aborts with `wrap_not_supported`.
- `withdraw <amount|all> [--pool <key>] [--confirm]` — `withdraw(amount)`; `all` reads `balances(addr)` on the resolved pool.
- `harvest [token] [--pool <key>] [--confirm]` — `claimRewards()` (sweep) or `claimReward(token)` (single) on the resolved pool. Pre-reads `pendingRewards`; aborts cleanly with `nothing_to_claim` if everything is zero.

---

## 6. Reporting back

After every action, surface to the user:

- The parsed intent (so they can audit it) — echo the `parsedIntent` field
- `txHash` and the explorer link `https://explorer.crosstoken.io/612055/tx/<hash>`
- Receipt `status` (`success` / `reverted`)
- Address tail (last 6 chars of the EOA address — never the full PK)
- For deposit: `stakedBefore` → `stakedAfter`, plus `wrap` and `approval` sub-objects when present
- For withdraw: `stakedBefore` → `stakedAfter`
- For harvest: `rewardsBefore` → `rewardsAfter` and the updated `walletRewards`

Never include the PK or full env contents in the report. If the envelope contains a non-null `signerWarn`, surface the mismatch to the user before declaring success.

For `awaiting_confirm` errors (exit code 2), summarize the parsed intent, ask the user explicitly for "yes / 진행", and only re-invoke with `--confirm` on confirmation. For `below_min_deposit`, show the on-chain `minDeposit` value back to the user. For `insufficient_native_for_wrap`, show the deficit and gas reserve.

---

## 7. Distribution

This skill folder is the unit of distribution. Recipients:

1. Copy the whole `cross-rewards/` folder into `~/.claude/skills/`
2. Run `cd ~/.claude/skills/cross-rewards && npm install` once (or let the skill do it on first use)
3. Create `~/.claude/skills/cross-rewards/.env` from `.env.example` before using write-path commands

Cross-link: deeper details (chain config, contract addresses, ABI, calldata layout, decoded sample, custom errors, smart-wallet caveat) live in `references/cross-rewards.md`. Lazy-load it only when a script throws an unfamiliar revert or someone is forking the skill.
