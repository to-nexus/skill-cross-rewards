// _guard.mjs — pre-flight safety rails for write transactions.
//
// Every write op in this skill flows through enforceWriteGuards() which:
//   1. Checks the connected RPC's chain id (must be 612055)
//   2. Confirms the EOA holds at least MIN_GAS_CROSS native CROSS for gas
//   3. Caps user-specified amount against MAX_STAKE_NOTIONAL (env, optional)
//   4. Demands --confirm if amount > CONFIRM_THRESHOLD (env, default 1)
//   5. For deposits, enforces minDepositAmount() read on-chain
//
// Each failure raises a typed error with `.code` so the caller can map it
// to a stable error string in the JSON envelope.

import { formatEther, parseEther } from 'viem';
import { ensureChainId } from './_chain.mjs';
import { REWARDS_ABI } from './_abi.mjs';

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    const err = new Error(`${name} must be a non-negative number, got "${raw}"`);
    err.code = 'bad_env';
    throw err;
  }
  return n;
}

/**
 * Run all pre-flight guards. Throws on the first failure.
 *
 * @param {object} args
 * @param {object} args.publicClient
 * @param {`0x${string}`} args.account     EOA address
 * @param {bigint}  args.amountWei         user-specified amount in wei (the WCROSS the
 *                                         user wants to deposit / withdraw / etc.)
 * @param {string}  args.amountHuman       same amount in WCROSS units (string)
 * @param {boolean} args.confirm           --confirm flag was passed
 * @param {object}  args.parsedIntent      shape echoed back into errors for transparency
 * @param {boolean} [args.checkMinDeposit=false]  enable on-chain minDepositAmount check (deposit only)
 * @param {`0x${string}`} [args.rewardsContract] needed if checkMinDeposit
 */
export async function enforceWriteGuards({
  publicClient,
  account,
  amountWei,
  amountHuman,
  confirm,
  parsedIntent,
  checkMinDeposit = false,
  rewardsContract,
}) {
  // 1. chain-id
  await ensureChainId(publicClient);

  // 2. native gas pre-flight
  const minGas = envNumber('MIN_GAS_CROSS', 0.001);
  const native = await publicClient.getBalance({ address: account });
  if (native < parseEther(String(minGas))) {
    const err = new Error(
      `native CROSS balance ${formatEther(native)} < MIN_GAS_CROSS ${minGas}`
    );
    err.code = 'insufficient_gas';
    err.parsedIntent = parsedIntent;
    throw err;
  }

  // 3. MAX_STAKE_NOTIONAL cap (only meaningful when amount > 0)
  const capRaw = process.env.MAX_STAKE_NOTIONAL;
  if (capRaw !== undefined && capRaw !== '') {
    const cap = Number(capRaw);
    if (!Number.isFinite(cap) || cap < 0) {
      const err = new Error(`MAX_STAKE_NOTIONAL must be non-negative, got "${capRaw}"`);
      err.code = 'bad_env';
      throw err;
    }
    if (Number(amountHuman) > cap) {
      const err = new Error(
        `amount ${amountHuman} WCROSS exceeds MAX_STAKE_NOTIONAL=${cap}`
      );
      err.code = 'cap_exceeded';
      err.parsedIntent = parsedIntent;
      throw err;
    }
  }

  // 4. --confirm gate
  const confirmThreshold = envNumber('CONFIRM_THRESHOLD', 1);
  if (Number(amountHuman) > confirmThreshold && !confirm) {
    const err = new Error('awaiting_confirm');
    err.code = 'awaiting_confirm';
    err.parsedIntent = parsedIntent;
    err.exitCode = 2;
    throw err;
  }

  // 5. minDepositAmount enforcement (deposit-only)
  if (checkMinDeposit) {
    if (!rewardsContract) {
      const err = new Error('rewardsContract address required for minDeposit check');
      err.code = 'guard_misconfigured';
      throw err;
    }
    const min = await publicClient.readContract({
      address: rewardsContract,
      abi: REWARDS_ABI,
      functionName: 'minDepositAmount',
    });
    if (amountWei < min) {
      const err = new Error(
        `amount ${amountHuman} WCROSS below minDepositAmount ${formatEther(min)} WCROSS`
      );
      err.code = 'below_min_deposit';
      err.parsedIntent = parsedIntent;
      err.minDeposit = formatEther(min);
      throw err;
    }
  }
}
