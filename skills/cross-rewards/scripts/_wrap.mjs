// _wrap.mjs — call WCROSS.deposit() payable to mint WCROSS from native CROSS.
//
// Used by deposit.mjs only when --wrap is passed AND walletWCROSS < amount.
// Wraps exactly the deficit (amount - currentWCROSS), leaving the remaining
// native CROSS untouched for gas. If native is insufficient (after also
// keeping MIN_GAS_CROSS in reserve) the wrap aborts before signing.

import { formatEther, parseEther } from 'viem';
import { ERC20_ABI, WCROSS_ABI } from './_abi.mjs';

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Wrap `deficit` of native CROSS into WCROSS via WCROSS.deposit() payable.
 * No-op (returns wrapTx: null) if walletWCROSS >= targetAmountWei.
 *
 * @param {object} args
 * @param {object} args.publicClient
 * @param {object} args.walletClient
 * @param {`0x${string}`} args.account
 * @param {`0x${string}`} args.wcross           WCROSS token address
 * @param {bigint}        args.targetAmountWei  total WCROSS the caller intends to deposit
 * @returns {Promise<{
 *   wrapTx: `0x${string}` | null,
 *   wrappedWei: bigint,
 *   walletWCROSSBefore: bigint,
 *   walletWCROSSAfter: bigint
 * }>}
 */
export async function wrapDeficit({ publicClient, walletClient, account, wcross, targetAmountWei }) {
  const walletWCROSSBefore = await publicClient.readContract({
    address: wcross,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account],
  });

  if (walletWCROSSBefore >= targetAmountWei) {
    return {
      wrapTx: null,
      wrappedWei: 0n,
      walletWCROSSBefore,
      walletWCROSSAfter: walletWCROSSBefore,
    };
  }

  const deficit = targetAmountWei - walletWCROSSBefore;

  const native = await publicClient.getBalance({ address: account });
  const minGasCROSS = envNumber('MIN_GAS_CROSS', 0.001);
  const reserve = parseEther(String(minGasCROSS));

  if (native < deficit + reserve) {
    const err = new Error(
      `native CROSS ${formatEther(native)} < wrap deficit ${formatEther(deficit)} + gas reserve ${minGasCROSS}`
    );
    err.code = 'insufficient_native_for_wrap';
    err.deficit = formatEther(deficit);
    err.gasReserve = String(minGasCROSS);
    throw err;
  }

  const hash = await walletClient.writeContract({
    address: wcross,
    abi: WCROSS_ABI,
    functionName: 'deposit',
    args: [],
    value: deficit,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    const err = new Error(`WCROSS.deposit() reverted in tx ${hash}`);
    err.code = 'wrap_reverted';
    err.txHash = hash;
    throw err;
  }

  const walletWCROSSAfter = await publicClient.readContract({
    address: wcross,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account],
  });

  return { wrapTx: hash, wrappedWei: deficit, walletWCROSSBefore, walletWCROSSAfter };
}
