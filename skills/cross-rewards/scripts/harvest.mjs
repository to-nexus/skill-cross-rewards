#!/usr/bin/env node
// harvest.mjs — claim accrued reward tokens.
//
// Args:
//   [token]              optional reward token address; if omitted, sweeps all via claimRewards()
//   --confirm            required when ANY pending reward token amount > CONFIRM_THRESHOLD
//                        (we use parsed reward decimals here — most reward tokens are 18d)
//
// Flow:
//   1. parse args
//   2. read pendingRewards(addr) (rewardsBefore)
//   3. confirm gate — if any pending amount > CONFIRM_THRESHOLD WCROSS-equivalent units, demand --confirm
//      (NB: this is a coarse heuristic — tokens may not be priced 1:1; skill is intentionally cautious)
//   4. write claimRewards() OR claimReward(token)
//   5. read pendingRewards(addr) (rewardsAfter) and walletReward balances
//   6. emit JSON envelope including rewardsBefore / rewardsAfter

import 'dotenv/config';
import { formatEther, formatUnits, getAddress, parseEther, isAddress } from 'viem';
import { getPublicClient, ensureChainId, getRewardsContract, explorerTx } from './_chain.mjs';
import { REWARDS_ABI, ERC20_ABI } from './_abi.mjs';
import { makeSigner, walletTail } from './_signer.mjs';
import { extractPoolFlag, resolvePool } from './_pools.mjs';

const { poolKey, rest: argsNoPool } = extractPoolFlag(process.argv.slice(2));
const flags = new Set(argsNoPool.filter((a) => a.startsWith('--')));
const positional = argsNoPool.filter((a) => !a.startsWith('--'));
const tokenArg = positional[0];
const confirm = flags.has('--confirm');

const parsedIntent = {
  command: 'harvest',
  poolKey,
  token: tokenArg ?? null,
  confirm,
};

function emit(envelope) {
  process.stdout.write(JSON.stringify(envelope));
}

function envelopeError(err) {
  return {
    ok: false,
    error: err?.code || err?.shortMessage || err?.message || 'unknown_error',
    message: err?.shortMessage || err?.message || String(err),
    parsedIntent,
  };
}

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function readTokenMeta(publicClient, address) {
  const [name, symbol, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'name' }).catch(() => null),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
  ]);
  return { address, name, symbol, decimals: Number(decimals) };
}

async function readPendingFor(publicClient, rewardsContract, account, rewardMetas) {
  const pending = await publicClient.readContract({
    address: rewardsContract, abi: REWARDS_ABI, functionName: 'pendingRewards', args: [account],
  });
  const [tokens, amounts] = pending;
  return tokens.map((tok, i) => {
    const meta = rewardMetas.find((m) => m.address.toLowerCase() === tok.toLowerCase()) || {
      address: getAddress(tok), symbol: null, decimals: 18,
    };
    return {
      token: meta.address,
      symbol: meta.symbol,
      decimals: meta.decimals,
      amountWei: amounts[i].toString(),
      amount: formatUnits(amounts[i], meta.decimals),
    };
  });
}

async function main() {
  let target = null;
  if (tokenArg) {
    if (!isAddress(tokenArg)) {
      const err = new Error(`invalid token address "${tokenArg}"`);
      err.code = 'bad_token';
      throw err;
    }
    target = getAddress(tokenArg);
  }

  const publicClient = getPublicClient();
  const { account, walletClient, warn: signerWarn } = makeSigner();

  let poolHint = null;
  let rewardsContract;
  if (poolKey) {
    poolHint = await resolvePool(poolKey);
    rewardsContract = poolHint.address;
  } else {
    rewardsContract = getRewardsContract();
  }

  await ensureChainId(publicClient);

  // Min gas guard
  const minGas = envNumber('MIN_GAS_CROSS', 0.001);
  const native = await publicClient.getBalance({ address: account.address });
  if (native < parseEther(String(minGas))) {
    const err = new Error(`native CROSS balance ${formatEther(native)} < MIN_GAS_CROSS ${minGas}`);
    err.code = 'insufficient_gas';
    throw err;
  }

  // Token metadata for all registered reward tokens
  const rewardTokensRaw = await publicClient.readContract({
    address: rewardsContract, abi: REWARDS_ABI, functionName: 'getRewardTokens',
  });
  const rewardTokens = (rewardTokensRaw ?? []).map((t) => getAddress(t));
  const rewardMetas = await Promise.all(rewardTokens.map((t) => readTokenMeta(publicClient, t)));

  if (target) {
    const known = rewardTokens.some((t) => t.toLowerCase() === target.toLowerCase());
    if (!known) {
      const err = new Error(`token ${target} is not in getRewardTokens() registry`);
      err.code = 'unknown_reward_token';
      throw err;
    }
  }

  // Read pending before
  const rewardsBefore = await readPendingFor(publicClient, rewardsContract, account.address, rewardMetas);

  // Confirm-gate: if any single pending amount > CONFIRM_THRESHOLD (in token-native units),
  // demand --confirm. Coarse but conservative.
  const confirmThreshold = envNumber('CONFIRM_THRESHOLD', 1);
  const overThreshold = rewardsBefore.find((r) => Number(r.amount) > confirmThreshold);
  if (overThreshold && !confirm) {
    const err = new Error('awaiting_confirm');
    err.code = 'awaiting_confirm';
    err.parsedIntent = parsedIntent;
    err.exitCode = 2;
    err.overThreshold = overThreshold;
    throw err;
  }

  // No-op short-circuit: if there is nothing to claim, the contract reverts
  // with custom error 0x4d88352e. Surface a clean envelope instead.
  const hasAny = rewardsBefore.some((r) => BigInt(r.amountWei) > 0n);
  if (!hasAny) {
    emit({
      ok: false,
      parsedIntent,
      error: 'nothing_to_claim',
      message: 'pendingRewards is zero across all registered reward tokens',
      address: account.address,
      walletTail: walletTail(account.address),
      rewardsBefore,
    });
    process.exit(1);
  }

  await ensureChainId(publicClient); // re-check just before broadcast

  let hash;
  if (target) {
    hash = await walletClient.writeContract({
      address: rewardsContract,
      abi: REWARDS_ABI,
      functionName: 'claimReward',
      args: [target],
    });
  } else {
    hash = await walletClient.writeContract({
      address: rewardsContract,
      abi: REWARDS_ABI,
      functionName: 'claimRewards',
      args: [],
    });
  }
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const rewardsAfter = await readPendingFor(publicClient, rewardsContract, account.address, rewardMetas);
  const walletRewards = await Promise.all(
    rewardMetas.map(async (meta) => {
      const bal = await publicClient.readContract({
        address: meta.address, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
      });
      return {
        token: meta.address,
        symbol: meta.symbol,
        decimals: meta.decimals,
        balanceWei: bal.toString(),
        balance: formatUnits(bal, meta.decimals),
      };
    })
  );

  emit({
    ok: receipt.status === 'success',
    parsedIntent,
    chainId: 612055,
    rewardsContract,
    poolHint: poolHint ? { poolId: poolHint.poolId, name: poolHint.name, type: poolHint.type } : null,
    address: account.address,
    walletTail: walletTail(account.address),
    txHash: hash,
    status: receipt.status,
    explorer: explorerTx(hash),
    mode: target ? 'claimReward' : 'claimRewards',
    target,
    rewardsBefore,
    rewardsAfter,
    walletRewards,
    signerWarn,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.stack || err) + '\n');
  emit(envelopeError(err));
  process.exit(err?.exitCode || 1);
});
