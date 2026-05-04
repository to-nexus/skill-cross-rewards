#!/usr/bin/env node
// deposit.mjs — stake WCROSS into the rewards contract.
//
// Args:
//   <amount>             required, WCROSS units (e.g. "1.5")
//   --wrap               optional, wraps native CROSS into WCROSS for the deficit
//   --confirm            required when amount > CONFIRM_THRESHOLD
//
// Flow:
//   1. parse args → parsedIntent
//   2. enforceWriteGuards (chain, gas, cap, confirm, minDeposit)
//   3. if --wrap and walletWCROSS < amount → WCROSS.deposit() payable
//   4. ensureAllowance(WCROSS, rewards, max-uint) if allowance is short
//   5. rewards.deposit(amount)
//   6. emit JSON envelope
//
// Errors emit {ok:false, error, parsedIntent} and exit 1 (or 2 for awaiting_confirm).

import 'dotenv/config';
import { formatUnits, parseUnits, getAddress } from 'viem';
import {
  getPublicClient, ensureChainId, getRewardsContract, getDefaultWCROSS, explorerTx,
} from './_chain.mjs';
import { REWARDS_ABI, ERC20_ABI } from './_abi.mjs';
import { makeSigner, walletTail } from './_signer.mjs';
import { ensureAllowance } from './_approval.mjs';
import { wrapDeficit } from './_wrap.mjs';
import { enforceWriteGuards } from './_guard.mjs';
import { extractPoolFlag, resolvePool } from './_pools.mjs';

const { poolKey, rest: argsNoPool } = extractPoolFlag(process.argv.slice(2));
const flags = new Set(argsNoPool.filter((a) => a.startsWith('--')));
const positional = argsNoPool.filter((a) => !a.startsWith('--'));
const amountStr = positional[0];
const wrap = flags.has('--wrap');
const confirm = flags.has('--confirm');

const parsedIntent = {
  command: 'deposit',
  poolKey,
  amount: amountStr,
  wrap,
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
    ...(err?.minDeposit ? { minDeposit: err.minDeposit } : {}),
    ...(err?.deficit ? { deficit: err.deficit } : {}),
  };
}

async function main() {
  if (!amountStr) {
    const err = new Error('amount required: node deposit.mjs <amount> [--pool <key>] [--wrap] [--confirm]');
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

  // Read on-chain depositToken (authoritative — don't trust API metadata blindly).
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

  let amountWei;
  try {
    amountWei = parseUnits(amountStr, depositDecimals);
  } catch {
    const err = new Error(`invalid amount "${amountStr}" — must be a decimal number in ${depTokSymbol ?? 'depositToken'} units`);
    err.code = 'bad_amount';
    throw err;
  }
  if (amountWei <= 0n) {
    const err = new Error('amount must be > 0');
    err.code = 'bad_amount';
    throw err;
  }

  await enforceWriteGuards({
    publicClient,
    account: account.address,
    amountWei,
    amountHuman: amountStr,
    confirm,
    parsedIntent,
    checkMinDeposit: true,
    rewardsContract,
  });

  // Optional wrap before approve/deposit. Only valid for WCROSS-deposit pools.
  let wrapResult = null;
  if (wrap) {
    if (depositToken.toLowerCase() !== getDefaultWCROSS().toLowerCase()) {
      const err = new Error(
        `--wrap only supported for WCROSS-deposit pools; this pool's depositToken is ${depTokSymbol ?? depositToken}`
      );
      err.code = 'wrap_not_supported';
      throw err;
    }
    wrapResult = await wrapDeficit({
      publicClient, walletClient, account: account.address,
      wcross: depositToken, targetAmountWei: amountWei,
    });
  } else {
    const walletDeposit = await publicClient.readContract({
      address: depositToken, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
    });
    if (walletDeposit < amountWei) {
      const isWCROSS = depositToken.toLowerCase() === getDefaultWCROSS().toLowerCase();
      const err = new Error(
        `wallet ${depTokSymbol ?? 'depositToken'} ${formatUnits(walletDeposit, depositDecimals)} < amount ${amountStr}` +
        (isWCROSS ? ' — pass --wrap to wrap native CROSS first' : '')
      );
      err.code = 'insufficient_deposit_token';
      throw err;
    }
  }

  const approval = await ensureAllowance({
    publicClient, walletClient,
    token: depositToken,
    spender: rewardsContract,
    owner: account.address,
    amount: amountWei,
  });

  const stakedBefore = await publicClient.readContract({
    address: rewardsContract, abi: REWARDS_ABI, functionName: 'balances', args: [account.address],
  });

  await ensureChainId(publicClient); // re-check just before broadcast
  const hash = await walletClient.writeContract({
    address: rewardsContract,
    abi: REWARDS_ABI,
    functionName: 'deposit',
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
    amount: amountStr,
    amountWei: amountWei.toString(),
    stakedBeforeWei: stakedBefore.toString(),
    stakedBefore: formatUnits(stakedBefore, depositDecimals),
    stakedAfterWei: stakedAfter.toString(),
    stakedAfter: formatUnits(stakedAfter, depositDecimals),
    wrap: wrapResult ? {
      wrapTx: wrapResult.wrapTx,
      wrappedWei: wrapResult.wrappedWei.toString(),
      walletWCROSSBefore: formatUnits(wrapResult.walletWCROSSBefore, depositDecimals),
      walletWCROSSAfter: formatUnits(wrapResult.walletWCROSSAfter, depositDecimals),
    } : null,
    approval: {
      approveTx: approval.approveTx,
      allowanceBeforeWei: approval.allowanceBefore.toString(),
      allowanceAfterWei: approval.allowanceAfter.toString(),
    },
    signerWarn,
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.stack || err) + '\n');
  emit(envelopeError(err));
  process.exit(err?.exitCode || 1);
});
