// _approval.mjs — WCROSS allowance check + max-uint approve if short.
//
// Idempotent: returns { approved, txHash } where `approved` is the final
// allowance (>= amount on success). If the existing allowance is already
// sufficient, no tx is sent and txHash is null.

import { ERC20_ABI } from './_abi.mjs';

const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Read current allowance and submit a max-uint approve if it's below `amount`.
 * @param {object}  args
 * @param {object}  args.publicClient   viem PublicClient
 * @param {object}  args.walletClient   viem WalletClient (must include account)
 * @param {`0x${string}`} args.token    ERC-20 token to approve (WCROSS)
 * @param {`0x${string}`} args.spender  rewards staker address
 * @param {`0x${string}`} args.owner    EOA holding the tokens
 * @param {bigint}        args.amount   minimum allowance required
 * @returns {Promise<{ approveTx: `0x${string}` | null, allowanceBefore: bigint, allowanceAfter: bigint }>}
 */
export async function ensureAllowance({ publicClient, walletClient, token, spender, owner, amount }) {
  const allowanceBefore = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  });

  if (allowanceBefore >= amount) {
    return { approveTx: null, allowanceBefore, allowanceAfter: allowanceBefore };
  }

  const hash = await walletClient.writeContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, MAX_UINT256],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    const err = new Error(`approve(WCROSS, max-uint) reverted in tx ${hash}`);
    err.code = 'approve_reverted';
    err.txHash = hash;
    throw err;
  }
  const allowanceAfter = await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [owner, spender],
  });
  return { approveTx: hash, allowanceBefore, allowanceAfter };
}
