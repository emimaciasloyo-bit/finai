/**
 * FinAI — Plaid Integration Proxy (owner-only)
 * Fetches real bank/brokerage data: accounts, balances, transactions, investments.
 *
 * ?resource=:
 *   accounts     — linked accounts + balances
 *   transactions — recent 30 days of transactions
 *   investments  — investment holdings + securities
 *
 * Auth: requires valid owner session cookie (set by /api/owner-session).
 * Env vars: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, OWNER_PLAID_ACCESS_TOKEN
 */

import { isOwnerSession } from './owner-session.js';

function plaidBase() {
  const env = process.env.PLAID_ENV || 'sandbox';
  if (env === 'production') return 'https://production.plaid.com';
  if (env === 'development') return 'https://development.plaid.com';
  return 'https://sandbox.plaid.com';
}

async function plaidPost(path, body) {
  const res = await fetch(`${plaidBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Plaid-Version': '2020-09-14' },
    body: JSON.stringify({
      client_id: process.env.PLAID_CLIENT_ID,
      secret: process.env.PLAID_SECRET,
      access_token: process.env.OWNER_PLAID_ACCESS_TOKEN,
      ...body,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_message || `Plaid error ${res.status}`);
  }
  return res.json();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!isOwnerSession(req)) return res.status(403).json({ error: 'Forbidden' });

  const required = ['PLAID_CLIENT_ID', 'PLAID_SECRET', 'OWNER_PLAID_ACCESS_TOKEN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length) return res.status(503).json({ error: 'Plaid not configured', missing });

  const resource = req.query?.resource || 'accounts';

  try {
    let data;

    if (resource === 'accounts') {
      data = await plaidPost('/accounts/balance/get', {});
      // Shape: { accounts: [{ account_id, name, type, subtype, balances }] }
      return res.status(200).json({
        accounts: data.accounts.map(a => ({
          id: a.account_id,
          name: a.name,
          type: a.type,
          subtype: a.subtype,
          balance: a.balances.current,
          currency: a.balances.iso_currency_code || 'USD',
        })),
      });
    }

    if (resource === 'transactions') {
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
      data = await plaidPost('/transactions/get', { start_date: start, end_date: end, count: 100 });
      return res.status(200).json({
        transactions: data.transactions.map(t => ({
          id: t.transaction_id,
          date: t.date,
          name: t.name,
          amount: t.amount,
          category: t.category?.[0] || 'Other',
          account: t.account_id,
        })),
      });
    }

    if (resource === 'investments') {
      data = await plaidPost('/investments/holdings/get', {});
      return res.status(200).json({
        holdings: data.holdings.map(h => {
          const sec = data.securities?.find(s => s.security_id === h.security_id) || {};
          return {
            name: sec.name || sec.ticker_symbol || h.security_id,
            ticker: sec.ticker_symbol,
            quantity: h.quantity,
            value: h.institution_value,
            costBasis: h.cost_basis,
          };
        }),
      });
    }

    return res.status(400).json({ error: 'Unknown resource. Use: accounts | transactions | investments' });
  } catch (err) {
    console.error('[plaid]', err.message);
    return res.status(502).json({ error: err.message });
  }
}
