#!/usr/bin/env node
// pools.mjs — list every reward pool exposed by the cross-game-reward-api.
//
// Output: ONE JSON object on stdout. Each entry includes the contract address
// (which can be passed back via --pool to any other script), the deposit token,
// reward symbols, and total notional. APR/emission rate is not on-chain on
// these contracts; if a price field is in the API response it is preserved as
// a hint but should not be relied on for trading decisions.

import 'dotenv/config';
import { formatUnits } from 'viem';
import { listPools } from './_pools.mjs';

const parsedIntent = { command: 'pools' };

function emit(envelope) {
  process.stdout.write(JSON.stringify(envelope));
}

async function main() {
  const pools = await listPools();
  emit({
    ok: true,
    parsedIntent,
    chainId: 612055,
    count: pools.length,
    pools: pools.map((p) => ({
      poolId: p.poolId,
      address: p.address,
      name: p.name,
      type: p.type,
      status: p.status,
      deposit: {
        symbol: p.depositToken.symbol,
        address: p.depositToken.address,
        decimals: p.depositToken.decimals,
        price: p.depositToken.price,
      },
      rewards: p.rewardTokens.map((r) => ({
        symbol: r.symbol,
        address: r.address,
        decimals: r.decimals,
        price: r.price,
      })),
      totalDepositedWei: p.totalDepositedWei,
      totalDeposited: formatUnits(BigInt(p.totalDepositedWei), p.depositToken.decimals),
      totalUsers: p.totalUsers,
    })),
    note: 'Pass any pool key (reward symbol, pool address, or pool_id) to other commands via --pool, e.g. `node scripts/info.mjs --pool RUBYx`.',
  });
}

main().catch((err) => {
  if (process.env.DEBUG) process.stderr.write(String(err?.stack || err) + '\n');
  emit({
    ok: false,
    parsedIntent,
    error: err?.code || err?.message || 'unknown_error',
    message: err?.message || String(err),
  });
  process.exit(1);
});
