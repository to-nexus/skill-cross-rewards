// _pools.mjs — cross-game-reward-api client + pool target resolver.
//
// Source-of-truth for the live pool catalog is the same REST API the
// official x.crosstoken.io/rewards web UI calls:
//
//   GET {API_BASE}/v1/pools                -> list
//   GET {API_BASE}/v1/pools/{address}      -> detail
//   GET {API_BASE}/v1/pools/status/{enum}  -> filter
//
// Override the base URL by setting CROSS_REWARD_API in env.

import { getAddress, isAddress } from 'viem';

const DEFAULT_API_BASE = 'https://cross-game-reward-api.crosstoken.io/api';
const REQUEST_TIMEOUT_MS = 10_000;

function apiBase() {
  const env = process.env.CROSS_REWARD_API;
  return (env && env.length > 0 ? env : DEFAULT_API_BASE).replace(/\/$/, '');
}

async function apiGet(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const err = new Error(`reward-api ${path} HTTP ${res.status}`);
      err.code = 'pools_api_http';
      throw err;
    }
    const json = await res.json();
    if (json.code !== 200) {
      const err = new Error(`reward-api ${path} code=${json.code} msg=${json.message}`);
      err.code = 'pools_api_error';
      throw err;
    }
    return json.data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`reward-api ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
      e.code = 'pools_api_timeout';
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalize(p) {
  return {
    poolId: p.pool_id,
    address: getAddress(p.pool_address),
    name: p.pool_name,
    type: p.pool_type,
    status: p.pool_status,
    depositToken: {
      address: getAddress(p.deposit_token.address),
      symbol: p.deposit_token.symbol,
      name: p.deposit_token.name,
      decimals: Number(p.deposit_token.decimals),
      price: p.deposit_token.price ?? null,
    },
    rewardTokens: (p.reward_tokens ?? []).map((t) => ({
      address: getAddress(t.address),
      symbol: t.symbol,
      name: t.name,
      decimals: Number(t.decimals),
      price: t.price ?? null,
    })),
    totalDepositedWei: String(p.total_deposited ?? '0'),
    totalUsers: p.total_users ?? null,
    createdBlock: p.created_block ?? null,
  };
}

export async function listPools() {
  const data = await apiGet('/v1/pools?page=1&page_size=100');
  return (data.pools ?? []).map(normalize);
}

export async function getPoolByAddress(address) {
  const norm = getAddress(address).toLowerCase();
  const data = await apiGet(`/v1/pools/${norm}`);
  const raw = data.pool ?? data;
  if (!raw || !raw.pool_address) {
    const err = new Error(`pool ${norm} not found via reward-api`);
    err.code = 'pool_not_found';
    throw err;
  }
  return normalize(raw);
}

/**
 * Resolve a free-form pool key to a normalized pool record.
 *
 * Priority:
 *   1. 0x-address  → exact lookup (falls back to a bare {address} if the API is unavailable)
 *   2. reward-token symbol (case-insensitive, e.g. "CWT", "RUBYx", "SHILTZX")
 *   3. integer pool_id
 *   4. unique substring match on pool_name
 */
export async function resolvePool(key) {
  if (key === null || key === undefined || String(key).trim() === '') {
    const err = new Error('pool key required');
    err.code = 'missing_pool';
    throw err;
  }
  const k = String(key).trim();

  if (isAddress(k)) {
    try {
      return await getPoolByAddress(k);
    } catch (err) {
      // Allow offline / unknown-address fallback so the on-chain reads can
      // still proceed — info/balance/etc. will then read depositToken() etc.
      if (err.code === 'pools_api_http' || err.code === 'pools_api_timeout' || err.code === 'pool_not_found') {
        return {
          poolId: null,
          address: getAddress(k),
          name: null,
          type: null,
          status: null,
          depositToken: null,
          rewardTokens: null,
          totalDepositedWei: null,
          totalUsers: null,
          createdBlock: null,
          _stub: true,
        };
      }
      throw err;
    }
  }

  const all = await listPools();
  const lower = k.toLowerCase();

  let matches = all.filter((p) =>
    p.rewardTokens.some((t) => (t.symbol ?? '').toLowerCase() === lower)
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    const err = new Error(
      `ambiguous: reward symbol "${k}" matches ${matches.length} pools (${matches.map((p) => p.address).join(', ')})`
    );
    err.code = 'ambiguous_pool';
    throw err;
  }

  if (/^\d+$/.test(k)) {
    const pid = Number(k);
    const m = all.find((p) => p.poolId === pid);
    if (m) return m;
  }

  matches = all.filter((p) => (p.name ?? '').toLowerCase().includes(lower));
  if (matches.length === 1) return matches[0];

  const err = new Error(
    matches.length === 0
      ? `no pool matches "${k}" — run \`pools\` to see available keys`
      : `ambiguous: "${k}" matches ${matches.length} pools (${matches.map((p) => p.name).join(', ')})`
  );
  err.code = matches.length === 0 ? 'pool_not_found' : 'ambiguous_pool';
  throw err;
}

/**
 * Strip `--pool <key>` (or `--pool=<key>`) out of an argv slice and return the
 * key + remaining args. Lets every script accept `--pool` without each one
 * re-implementing flag parsing.
 */
export function extractPoolFlag(argv) {
  const rest = [];
  let poolKey = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--pool') {
      poolKey = argv[i + 1] ?? null;
      i++;
    } else if (a.startsWith('--pool=')) {
      poolKey = a.slice('--pool='.length);
    } else {
      rest.push(a);
    }
  }
  return { poolKey, rest };
}
