// _chain.mjs — viem clients + CROSS Chain config + chainId guard.
//
// All scripts in this skill MUST go through getPublicClient() / getWalletClient()
// rather than building their own transports, so the chain-id guard runs in one
// place. ensureChainId() is required before any write tx.

import { createPublicClient, createWalletClient, http, defineChain, getAddress } from 'viem';
import 'dotenv/config';

export const CROSS_CHAIN_ID = 612055;

export const crossChain = defineChain({
  id: CROSS_CHAIN_ID,
  name: 'CROSS Chain',
  nativeCurrency: { name: 'CROSS', symbol: 'CROSS', decimals: 18 },
  rpcUrls: {
    default: { http: [process.env.CROSS_RPC_URL ?? 'https://mainnet.crosstoken.io:22001/'] },
  },
  blockExplorers: {
    default: { name: 'CROSS Explorer', url: 'https://explorer.crosstoken.io/612055' },
  },
});

// Default rewards staker proxy. User can override via REWARDS_CONTRACT env.
const DEFAULT_REWARDS_CONTRACT = '0xd9767038edb5c7ff1735d5a567696947d4907300';

// Deposit token (WCROSS). The skill validates this against on-chain
// depositToken() at startup, so the constant is just a bootstrap value
// for `--wrap` calldata.
const DEFAULT_WCROSS = '0x642060e8b44c8f2d6d2974a71a0ca8f995cafbda';

export function getRewardsContract() {
  const env = process.env.REWARDS_CONTRACT;
  return getAddress(env && env.length > 0 ? env : DEFAULT_REWARDS_CONTRACT);
}

export function getDefaultWCROSS() {
  return getAddress(DEFAULT_WCROSS);
}

export function getPublicClient() {
  return createPublicClient({ chain: crossChain, transport: http() });
}

export function getWalletClient(account) {
  return createWalletClient({ account, chain: crossChain, transport: http() });
}

export function explorerTx(hash) {
  return `https://explorer.crosstoken.io/612055/tx/${hash}`;
}

/**
 * Hard guard: aborts with a structured envelope if the connected RPC's
 * chain id does not match CROSS_CHAIN_ID. Call this BEFORE any write op.
 */
export async function ensureChainId(publicClient) {
  const cid = await publicClient.getChainId();
  if (cid !== CROSS_CHAIN_ID) {
    const err = new Error(`connected chainId ${cid}, expected ${CROSS_CHAIN_ID}`);
    err.code = 'wrong_chain';
    throw err;
  }
  return cid;
}
