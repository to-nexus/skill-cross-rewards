// _abi.mjs — verified ABI fragments for cross-rewards.
//
// Only functions confirmed by Phase-1 discovery (see references/cross-rewards.md)
// are exported here. Operator-only and admin functions (depositFor, withdrawFor,
// claimRewardFor, claimRewardsFor, addRewardToken, removeRewardToken, etc.) are
// deliberately excluded from this user-facing module.

export const ERC20_ABI = [
  { type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'allowance', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'approve', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

// WCROSS extends ERC-20 with WETH-style deposit/withdraw payable wrappers.
// We only need deposit() for the optional --wrap flow.
export const WCROSS_ABI = [
  ...ERC20_ABI,
  { type: 'function', name: 'deposit', stateMutability: 'payable', inputs: [], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
];

// Verified rewards staker ABI — see references/cross-rewards.md for provenance.
export const REWARDS_ABI = [
  // ---- Pool state (read) ----
  { type: 'function', name: 'depositToken', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getRewardTokens', stateMutability: 'view', inputs: [], outputs: [{ type: 'address[]' }] },
  { type: 'function', name: 'rewardTokenCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'rewardTokenAt', stateMutability: 'view',
    inputs: [{ type: 'uint256' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'isRewardToken', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'totalDeposited', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'minDepositAmount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'poolStatus', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'paused', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'initializedAt', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },

  // ---- User state (read) ----
  { type: 'function', name: 'balances', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'pendingRewards', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ type: 'address[]' }, { type: 'uint256[]' }] },
  { type: 'function', name: 'pendingReward', stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }, { name: 'rewardToken', type: 'address' }],
    outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'getReclaimableAmount', stateMutability: 'view',
    inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },

  // ---- User actions (write) ----
  { type: 'function', name: 'deposit', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }], outputs: [] },
  { type: 'function', name: 'claimReward', stateMutability: 'nonpayable',
    inputs: [{ name: 'rewardToken', type: 'address' }], outputs: [] },
  { type: 'function', name: 'claimRewards', stateMutability: 'nonpayable', inputs: [], outputs: [] },
];
