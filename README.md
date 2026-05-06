# cross-rewards

A Claude Code skill that drives the **CROSS Chain rewards staker** at `0xd9767038edb5c7ff1735d5a567696947d4907300` — a custom single-pool, multi-reward contract on **CROSS Chain** (chain id `612055`). Stake WCROSS, claim accrued reward tokens (e.g. CWT), and read pool/user state via natural language.

- **Stack:** EOA + viem (no ERC-4337, no paymaster)
- **Staker:** rewards contract `0xd9767038edb5c7ff1735d5a567696947d4907300` (UUPS proxy, OZ v5)
- **Deposit token:** `WCROSS` (`0x642060e8b44c8f2d6d2974a71a0ca8f995cafbda`, 18 decimals)
- **Reward tokens (registry):** dynamic — currently `[CWT]` at probe time, always read via `getRewardTokens()`
- **Subcommands:** `info`, `pools` (alias), `balance`, `deposit`, `withdraw`, `harvest`
- **Distribution:** standalone Claude skill **and** wrapped as a Claude Code plugin

> ⚠️ **This skill signs and broadcasts real transactions with the private key you provide.** Test with `minDepositAmount()` (currently 1 WCROSS). Set `MAX_STAKE_NOTIONAL` in `.env`. Read `skills/cross-rewards/scripts/*.mjs` before using.

---

## Install — Recommended (via Marketplace)

```bash
/plugin marketplace add github.com/to-nexus/cross-skills-suite
/plugin install cross-rewards@cross-skills-suite
```

Part of the [CROSS Skills Suite](https://github.com/to-nexus/cross-skills-suite) — installs alongside `cross-dex-trade`, `cross-prediction`, and other CROSS Chain ecosystem skills.

---

## Install — Standalone

### Option 1 — Plain skill (one user, fastest)

```bash
git clone <this-repo> /tmp/skill-cross-rewards
bash /tmp/skill-cross-rewards/install.sh        # symlinks into ~/.claude/skills/
```

Or manually:
```bash
cp -r skills/cross-rewards ~/.claude/skills/
cd ~/.claude/skills/cross-rewards && npm install
```

### Option 2 — Claude Code plugin (marketplace-installable)

If you maintain a marketplace, add an entry pointing at this repo:

```json
{
  "name": "cross-rewards",
  "source": { "source": "github", "repo": "to-nexus/skill-cross-rewards" },
  "category": "blockchain"
}
```

End users then run `/plugin marketplace add <your-marketplace>` then `/plugin install cross-rewards`.

---

## Configuration

Copy the template and fill in your wallet:
```bash
cp skills/cross-rewards/.env.example skills/cross-rewards/.env
chmod 600 skills/cross-rewards/.env
```

| Variable | Required | Default | Notes |
|---|---|---|---|
| `PRIVATE_KEY` | yes | — | EOA signer, `0x` + 64 hex chars |
| `MAX_STAKE_NOTIONAL` | recommended | unset | Per-deposit WCROSS cap; deposit aborts above this |
| `CONFIRM_THRESHOLD` | recommended | `1` | Deposits/withdraws above this require `--confirm` |
| `MIN_GAS_CROSS` | no | `0.001` | Native CROSS minimum for gas — aborts before signing if short |
| `REWARDS_CONTRACT` | no | `0xd9767038…7300` | Override only if pointing at a different staker proxy |
| `CROSS_RPC_URL` | no | `https://mainnet.crosstoken.io:22001/` | Override only if you have a private RPC |
| `WALLET_ADDRESS` | no | derived from PK | Cross-check; mismatch warns |

The skill resolves `.env` from (in order): cwd → `~/.claude/skills/cross-rewards/` → asks once.

---

## Quick start

Inside Claude Code, just describe the action in plain language. The skill activates on phrases like:
- "내 rewards 풀 보여줘"
- "show my cross staking balance"
- "1.5 WCROSS 예치해"
- "deposit 2 WCROSS into the rewards pool"
- "withdraw all from cross rewards"
- "보상 수령 / harvest cross rewards"

Direct CLI (skipping Claude):
```bash
cd ~/.claude/skills/cross-rewards
PRIVATE_KEY=0x... node scripts/info.mjs
PRIVATE_KEY=0x... node scripts/balance.mjs
PRIVATE_KEY=0x... node scripts/deposit.mjs 1 --confirm
PRIVATE_KEY=0x... node scripts/deposit.mjs 1 --wrap --confirm   # wraps native CROSS deficit
PRIVATE_KEY=0x... node scripts/withdraw.mjs all --confirm
PRIVATE_KEY=0x... node scripts/harvest.mjs --confirm
PRIVATE_KEY=0x... node scripts/harvest.mjs 0x0a57e254cafeeaccbe84f6f230888a3a3841aecd --confirm
```

All commands emit a single JSON object on stdout (`txHash`, `status`, `explorer`, `walletTail`, `parsedIntent`).

---

## What it does

- Reads single-pool state: `depositToken`, `getRewardTokens`, `totalDeposited`, `minDepositAmount`, `paused`, `poolStatus`, `owner`, `initializedAt`
- Reads user state: `balances(addr)`, `pendingRewards(addr)`, `pendingReward(addr, token)`
- Approves WCROSS to the staker (max-uint, one-time, only if allowance is short)
- `deposit(amount)` — with optional `--wrap` to wrap native CROSS first via `WCROSS.deposit() payable`
- `withdraw(amount|all)` — `all` reads `balances(addr)` and withdraws the full balance
- `claimRewards()` (sweep all reward tokens) and `claimReward(token)` (single token)
- Pre-flight: chain-id guard, native CROSS gas balance, MAX_STAKE_NOTIONAL, `--confirm` gate above CONFIRM_THRESHOLD, `minDepositAmount()` enforcement

---

## What it does NOT do

- **No MasterChef-style harvest shortcut.** The contract has no `harvest()` and `withdraw(0)` reverts — use `claimRewards()` / `claimReward(token)`.
- **No multi-pool batching.** This is a single-pool contract. The `<poolId>` argument seen in earlier drafts was removed.
- **No auto-compound or auto-restake loops.** Use `da:cron` if you want a scheduled harvest.
- **No web-UI scraping.** Pure on-chain RPC + viem.
- **No ERC-4337 / smart-wallet relaying.** EOA only in v0.1.
- **No APR display.** No `rewardPerBlock`/`periodFinish` view exists on this contract; treat APR as out-of-scope until off-chain accrual semantics are traced.
- **No operator paths exposed.** `depositFor` / `withdrawFor` / `claimRewardFor` / `claimRewardsFor` are deliberately not in the user CLI.

---

## Layout

```
skill-cross-rewards/                    # repo root = plugin
├── .claude-plugin/
│   └── plugin.json                     # plugin manifest (Option 2)
├── install.sh                          # symlink installer (Option 1)
├── README.md
├── LICENSE
└── skills/
    └── cross-rewards/                  # the skill itself
        ├── SKILL.md                    # what Claude reads to drive staking
        ├── package.json                # viem + dotenv
        ├── .env.example
        ├── scripts/
        │   ├── _chain.mjs              # publicClient, walletClient, chainId guard
        │   ├── _signer.mjs             # PK → wallet client + address; mismatch warn
        │   ├── _abi.mjs                # verified ABI fragments (rewards + WCROSS + ERC20)
        │   ├── _approval.mjs           # WCROSS allowance + max-uint approve
        │   ├── _guard.mjs              # chain, gas, cap, confirm, minDeposit gates
        │   ├── _wrap.mjs               # WCROSS.deposit() payable wrapper
        │   ├── info.mjs                # pool detail + user view
        │   ├── pools.mjs               # legacy alias → info
        │   ├── balance.mjs             # walletWCROSS, nativeCROSS, staked, pending
        │   ├── deposit.mjs             # <amount> [--wrap] [--confirm]
        │   ├── withdraw.mjs            # <amount|all> [--confirm]
        │   └── harvest.mjs             # [token] [--confirm]
        └── references/
            └── cross-rewards.md        # ABI + decoded sample (lazy-loaded)
```

---

## Safety model

The skill enforces five independent rails:

1. **Chain-id check.** Every write tx aborts unless `eth_chainId == 612055`.
2. **MAX_STAKE_NOTIONAL.** If env is set, deposit aborts when amount exceeds it.
3. **CONFIRM_THRESHOLD + `--confirm` gate.** Any deposit/withdraw notional > `CONFIRM_THRESHOLD` (default 1 WCROSS) aborts with `awaiting_confirm` unless `--confirm` is passed. SKILL.md re-invokes only after explicit user "yes".
4. **Native CROSS gas pre-flight.** Aborts if balance < `MIN_GAS_CROSS` (default 0.001).
5. **`minDepositAmount()` guard.** Reads on-chain min and aborts deposit if requested amount is below it.

The private key never appears in the Claude transcript unless the user pastes it in directly. Even then it's passed via `process.env` to the spawned `node`, never echoed back.

---

## License

[MIT](LICENSE) — but read the disclaimer at the bottom of the LICENSE file before using.
