#!/usr/bin/env node
// info.mjs — read-only single-pool view + (if PK is available) per-user state.
//
// Output: ONE JSON object on stdout, no decorative prose. Errors emit a
// {ok:false, error, parsedIntent} envelope and exit 1.
//
// Reads:
//   depositToken, getRewardTokens, totalDeposited, minDepositAmount,
//   poolStatus, paused, owner, initializedAt
//   For each reward token: name, symbol, decimals
//   If PRIVATE_KEY is set: balances(addr), pendingRewards(addr)

import 'dotenv/config';
import { formatUnits, getAddress } from 'viem';
import { getPublicClient, ensureChainId, getRewardsContract } from './_chain.mjs';
import { ERC20_ABI, REWARDS_ABI } from './_abi.mjs';
import { loadAccount, walletTail } from './_signer.mjs';
import { extractPoolFlag, resolvePool } from './_pools.mjs';

const { poolKey } = extractPoolFlag(process.argv.slice(2));
const parsedIntent = { command: 'info', poolKey };

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

async function readTokenMeta(publicClient, address) {
  try {
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'name' }).catch(() => null),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
      publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
    ]);
    return { address, name, symbol, decimals: Number(decimals) };
  } catch {
    return { address, name: null, symbol: null, decimals: 18 };
  }
}

async function main() {
  const publicClient = getPublicClient();
  await ensureChainId(publicClient);

  let poolHint = null;
  let rewardsContract;
  if (poolKey) {
    poolHint = await resolvePool(poolKey);
    rewardsContract = poolHint.address;
  } else {
    rewardsContract = getRewardsContract();
  }

  // Pool-level reads — multicall-friendly via Promise.all.
  const [
    depositToken,
    rewardTokens,
    totalDeposited,
    minDepositAmount,
    poolStatus,
    paused,
    owner,
    initializedAt,
  ] = await Promise.all([
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'depositToken' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'getRewardTokens' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'totalDeposited' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'minDepositAmount' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'poolStatus' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'paused' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'owner' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'initializedAt' }),
  ]);

  const depositTokenMeta = await readTokenMeta(publicClient, getAddress(depositToken));
  const rewardTokenMetas = await Promise.all(
    (rewardTokens ?? []).map((t) => readTokenMeta(publicClient, getAddress(t)))
  );
  const depositDecimals = depositTokenMeta.decimals ?? 18;

  // Optional user view — only if PRIVATE_KEY is set. Read-only: no signing.
  let user = null;
  try {
    const { account } = loadAccount();
    const [staked, pending] = await Promise.all([
      publicClient.readContract({
        address: rewardsContract, abi: REWARDS_ABI, functionName: 'balances', args: [account.address],
      }),
      publicClient.readContract({
        address: rewardsContract, abi: REWARDS_ABI, functionName: 'pendingRewards', args: [account.address],
      }),
    ]);
    const [pendingTokens, pendingAmounts] = pending;
    const pendingRewards = pendingTokens.map((tok, i) => {
      const meta = rewardTokenMetas.find((m) => m.address.toLowerCase() === tok.toLowerCase()) || {
        address: getAddress(tok), symbol: null, decimals: 18,
      };
      return {
        token: meta.address,
        symbol: meta.symbol,
        decimals: meta.decimals,
        amountWei: pendingAmounts[i].toString(),
        amount: formatUnits(pendingAmounts[i], meta.decimals),
      };
    });
    user = {
      address: account.address,
      walletTail: walletTail(account.address),
      stakedWei: staked.toString(),
      staked: formatUnits(staked, depositDecimals),
      pendingRewards,
    };
  } catch (err) {
    // PK not available or invalid — that's fine for `info`. We still emit the
    // pool view with user=null.
    if (err?.code !== 'missing_pk' && err?.code !== 'bad_pk_format') throw err;
    user = null;
  }

  emit({
    ok: true,
    parsedIntent,
    chainId: 612055,
    rewardsContract,
    poolHint: poolHint ? {
      poolId: poolHint.poolId, name: poolHint.name, type: poolHint.type, status: poolHint.status,
    } : null,
    pool: {
      depositToken: depositTokenMeta,
      rewardTokens: rewardTokenMetas,
      totalDepositedWei: totalDeposited.toString(),
      totalDeposited: formatUnits(totalDeposited, depositDecimals),
      minDepositAmountWei: minDepositAmount.toString(),
      minDepositAmount: formatUnits(minDepositAmount, depositDecimals),
      poolStatus: Number(poolStatus),
      paused,
      owner,
      initializedAtBlock: initializedAt.toString(),
    },
    user,
    note:
      'APR/emission rate is not exposed via on-chain views on this contract. ' +
      'Treat reward accrual as opaque; use pendingRewards() for current claimable.',
  });
}

main().catch((err) => {
  if (process.env.DEBUG) {
    process.stderr.write(String(err?.stack || err) + '\n');
  }
  emit(envelopeError(err));
  process.exit(1);
});
