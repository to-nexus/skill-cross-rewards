#!/usr/bin/env node
// withdraw.mjs — un-stake WCROSS from the rewards contract.
//
// Args:
//   <amount|all>         required ("all" reads balances(addr) and uses the full balance)
//   --confirm            required when amount > CONFIRM_THRESHOLD
//
// Flow:
//   1. parse args → parsedIntent (resolve "all" against balances(addr))
//   2. enforceWriteGuards (chain, gas, cap, confirm)  — minDeposit does NOT apply to withdraw
//   3. rewards.withdraw(amount)
//   4. emit JSON envelope

import 'dotenv/config';
import { formatUnits, parseUnits, getAddress } from 'viem';
import { getPublicClient, ensureChainId, getRewardsContract, explorerTx } from './_chain.mjs';
import { REWARDS_ABI, ERC20_ABI } from './_abi.mjs';
import { makeSigner, walletTail } from './_signer.mjs';
import { enforceWriteGuards } from './_guard.mjs';
import { extractPoolFlag, resolvePool } from './_pools.mjs';

const { poolKey, rest: argsNoPool } = extractPoolFlag(process.argv.slice(2));
const flags = new Set(argsNoPool.filter((a) => a.startsWith('--')));
const positional = argsNoPool.filter((a) => !a.startsWith('--'));
const amountArg = positional[0];
const confirm = flags.has('--confirm');

const parsedIntent = {
  command: 'withdraw',
  poolKey,
  amount: amountArg,
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

async function main() {
  if (!amountArg) {
    const err = new Error('amount required: node withdraw.mjs <amount|all> [--pool <key>] [--confirm]');
    err.code = 'missing_amount';
    throw err;
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

  // Resolve depositToken decimals so amount parsing/printing is correct for
  // any pool (currently all 18d, but don't bake that in).
  const depositToken = getAddress(
    await publicClient.readContract({
      address: rewardsContract, abi: REWARDS_ABI, functionName: 'depositToken',
    })
  );
  const [depTokSymbol, depTokDecimalsRaw] = await Promise.all([
    publicClient.readContract({ address: depositToken, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => null),
    publicClient.readContract({ address: depositToken, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
  ]);
  const depositDecimals = Number(depTokDecimalsRaw);

  // Resolve "all" before guards so we can pass an accurate amount through them.
  const stakedBefore = await publicClient.readContract({
    address: rewardsContract, abi: REWARDS_ABI, functionName: 'balances', args: [account.address],
  });

  let amountWei;
  let amountHuman;
  if (amountArg.toLowerCase() === 'all') {
    if (stakedBefore === 0n) {
      const err = new Error('nothing staked — balances(addr) == 0');
      err.code = 'nothing_to_withdraw';
      throw err;
    }
    amountWei = stakedBefore;
    amountHuman = formatUnits(stakedBefore, depositDecimals);
    parsedIntent.resolvedAmount = amountHuman;
  } else {
    try {
      amountWei = parseUnits(amountArg, depositDecimals);
    } catch {
      const err = new Error(`invalid amount "${amountArg}" — must be "all" or a decimal in ${depTokSymbol ?? 'depositToken'} units`);
      err.code = 'bad_amount';
      throw err;
    }
    if (amountWei <= 0n) {
      const err = new Error('amount must be > 0');
      err.code = 'bad_amount';
      throw err;
    }
    if (amountWei > stakedBefore) {
      const err = new Error(
        `requested ${amountArg} > staked ${formatUnits(stakedBefore, depositDecimals)} ${depTokSymbol ?? ''}`.trim()
      );
      err.code = 'over_staked_balance';
      throw err;
    }
    amountHuman = amountArg;
  }

  await enforceWriteGuards({
    publicClient,
    account: account.address,
    amountWei,
    amountHuman,
    confirm,
    parsedIntent,
    checkMinDeposit: false,
  });

  await ensureChainId(publicClient);
  const hash = await walletClient.writeContract({
    address: rewardsContract,
    abi: REWARDS_ABI,
    functionName: 'withdraw',
    args: [amountWei],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  const stakedAfter = await publicClient.readContract({
    address: rewardsContract, abi: REWARDS_ABI, functionName: 'balances', args: [account.address],
  });

  emit({
    ok: receipt.status === 'success',
    parsedIntent,
    chainId: 612055,
    rewardsContract,
    poolHint: poolHint ? { poolId: poolHint.poolId, name: poolHint.name, type: poolHint.type } : null,
    depositToken,
    depositTokenSymbol: depTokSymbol,
    depositTokenDecimals: depositDecimals,
    address: account.address,
    walletTail: walletTail(account.address),
    txHash: hash,
    status: receipt.status,
    explorer: explorerTx(hash),
    amount: amountHuman,
    amountWei: amountWei.toString(),
    stakedBeforeWei: stakedBefore.toString(),
    stakedBefore: formatUnits(stakedBefore, depositDecimals),
    stakedAfterWei: stakedAfter.toString(),
    stakedAfter: formatUnits(stakedAfter, depositDecimals),
    signerWarn,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.stack || err) + '\n');
  emit(envelopeError(err));
  process.exit(err?.exitCode || 1);
});
