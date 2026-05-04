// _signer.mjs — turn PRIVATE_KEY env into a viem Account + walletClient.
//
// PK is read from process.env.PRIVATE_KEY only. It is never logged, echoed,
// or written to disk by this module. WALLET_ADDRESS, when set, is checked
// against the address derived from the PK; mismatch raises (and is caught
// at the top level so a JSON envelope can carry the error).

import { privateKeyToAccount } from 'viem/accounts';
import { getWalletClient } from './_chain.mjs';

const PK_RE = /^0x[0-9a-fA-F]{64}$/;

export function loadAccount() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) {
    const err = new Error('PRIVATE_KEY env var required');
    err.code = 'missing_pk';
    throw err;
  }
  if (!PK_RE.test(pk)) {
    const err = new Error('PRIVATE_KEY must be 0x-prefixed 64-char hex');
    err.code = 'bad_pk_format';
    throw err;
  }
  const account = privateKeyToAccount(pk);
  const declared = process.env.WALLET_ADDRESS;
  let warn = null;
  if (declared && declared.toLowerCase() !== account.address.toLowerCase()) {
    warn = `WALLET_ADDRESS (${declared}) does not match address derived from PRIVATE_KEY (${account.address})`;
  }
  return { account, warn };
}

export function makeSigner() {
  const { account, warn } = loadAccount();
  const walletClient = getWalletClient(account);
  return { account, walletClient, warn };
}

export function walletTail(address) {
  return address ? address.slice(-6) : '';
}
