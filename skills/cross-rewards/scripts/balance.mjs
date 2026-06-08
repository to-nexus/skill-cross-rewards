#!/usr/bin/env node
// balance.mjs — wallet-level snapshot for the resolved EOA.
//
// Output: ONE JSON object on stdout. Reads:
//   - native CROSS balance (gas)
//   - WCROSS balance (depositToken read on-chain)
//   - staked WCROSS in the rewards contract (balances(addr))
//   - per-reward-token pending amounts (pendingRewards(addr))
//   - per-reward-token wallet ERC-20 balances (so the user can see what they've already claimed)

import 'dotenv/config';
import { formatEther, formatUnits, getAddress } from 'viem';
import { getPublicClient, ensureChainId, getRewardsContract } from './_chain.mjs';
import { ERC20_ABI, REWARDS_ABI } from './_abi.mjs';
import { loadAccount, walletTail } from './_signer.mjs';
import { extractPoolFlag, resolvePool } from './_pools.mjs';

const { poolKey } = extractPoolFlag(process.argv.slice(2));
const parsedIntent = { command: 'balance', poolKey };

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
  const [name, symbol, decimals] = await Promise.all([
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'name' }).catch(() => null),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
  ]);
  return { address, name, symbol, decimals: Number(decimals) };
}

async function main() {
  const publicClient = getPublicClient();
  await ensureChainId(publicClient);

  const { account } = loadAccount();
  let poolHint = null;
  let rewardsContract;
  if (poolKey) {
    poolHint = await resolvePool(poolKey);
    rewardsContract = poolHint.address;
  } else {
    rewardsContract = getRewardsContract();
  }

  const [depositTokenAddr, rewardTokensRaw] = await Promise.all([
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'depositToken' }),
    publicClient.readContract({ address: rewardsContract, abi: REWARDS_ABI, functionName: 'getRewardTokens' }),
  ]);

  const depositToken = getAddress(depositTokenAddr);
  const rewardTokens = (rewardTokensRaw ?? []).map((t) => getAddress(t));

  const [depositTokenMeta, ...rewardMetas] = await Promise.all([
    readTokenMeta(publicClient, depositToken),
    ...rewardTokens.map((t) => readTokenMeta(publicClient, t)),
  ]);

  const [native, walletWCROSS, staked, pending, ...rewardWalletBals] = await Promise.all([
    publicClient.getBalance({ address: account.address }),
    publicClient.readContract({
      address: depositToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    }),
    publicClient.readContract({
      address: rewardsContract, abi: REWARDS_ABI, functionName: 'balances', args: [account.address],
    }),
    publicClient.readContract({
      address: rewardsContract, abi: REWARDS_ABI, functionName: 'pendingRewards', args: [account.address],
    }),
    ...rewardTokens.map((t) =>
      publicClient.readContract({ address: t, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })
    ),
  ]);

  const [pendingTokens, pendingAmounts] = pending;
  const pendingRewards = pendingTokens.map((tok, i) => {
    const meta = rewardMetas.find((m) => m.address.toLowerCase() === tok.toLowerCase()) || {
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

  const walletRewards = rewardMetas.map((meta, i) => ({
    token: meta.address,
    symbol: meta.symbol,
    decimals: meta.decimals,
    balanceWei: rewardWalletBals[i].toString(),
    balance: formatUnits(rewardWalletBals[i], meta.decimals),
  }));

  const depositDecimals = depositTokenMeta.decimals ?? 18;

  emit({
    ok: true,
    parsedIntent,
    chainId: 612055,
    rewardsContract,
    poolHint: poolHint ? {
      poolId: poolHint.poolId, name: poolHint.name, type: poolHint.type, status: poolHint.status,
    } : null,
    address: account.address,
    walletTail: walletTail(account.address),
    nativeCROSSWei: native.toString(),
    nativeCROSS: formatEther(native),
    walletDepositTokenWei: walletWCROSS.toString(),
    walletDepositToken: formatUnits(walletWCROSS, depositDecimals),
    depositToken: depositTokenMeta,
    stakedWei: staked.toString(),
    staked: formatUnits(staked, depositDecimals),
    pendingRewards,
    walletRewards,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.message || err) + '\n');
  emit(envelopeError(err));
  process.exit(1);
});
