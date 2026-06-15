#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HI_BASE = (process.env.HI_BASE_URL || 'https://hi.hirey.ai').replace(/\/+$/, '');
const INTERVAL = Math.max(60, Number(process.env.VC_WATCH_INTERVAL_SECONDS || 300)) * 1000;
const STATE_DIR = join(homedir(), '.config', 'hirey-vc');
const CREDS_PATH = join(STATE_DIR, 'credentials.json');
const STATE_PATH = join(STATE_DIR, 'watcher-state.json');
const WEBHOOK = process.env.VC_ALERT_WEBHOOK_URL || '';

async function credentials() {
  if (process.env.HI_CLIENT_ID && process.env.HI_CLIENT_SECRET) {
    return { client_id: process.env.HI_CLIENT_ID, client_secret: process.env.HI_CLIENT_SECRET };
  }
  if (!existsSync(CREDS_PATH)) throw new Error('Run `npm start` once before `npm run watch`.');
  return JSON.parse(await readFile(CREDS_PATH, 'utf8'));
}

async function token(creds) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    audience: 'hirey-hi'
  });
  const response = await fetch(`${HI_BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!response.ok) throw new Error(`Token exchange failed (${response.status})`);
  return (await response.json()).access_token;
}

async function call(accessToken, capability, action, params) {
  const response = await fetch(`${HI_BASE}/v1/capabilities/${capability}/call`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ action, ...params })
  });
  if (!response.ok) throw new Error(`${capability}.${action} failed (${response.status})`);
  const data = await response.json();
  return data.result || data;
}

async function scan(accessToken) {
  const [founders, listings, companies] = await Promise.all([
    call(accessToken, 'hi.owners', 'search', { q: 'startup founder fundraising', limit: 30 }),
    call(accessToken, 'hi.agent-listings', 'browse_recent', { limit: 50 }),
    call(accessToken, 'hi.companies', 'list_recent', { limit: 50 })
  ]);
  return {
    founders: founders.people || [],
    listings: (listings.items || []).filter((item) => {
      const text = `${item.listing_type_id || ''} ${item.target_preview_text || ''}`.toLowerCase();
      return item.listing_type_id === 'fundraising'
        || /\bstartup\b|\bfounder\b|\bcofounder\b|\bseed\b|\bventure\b|\braising\b|创业|融资|创始人/.test(text);
    }),
    companies: companies.companies || []
  };
}

const ids = (snapshot) => ({
  founders: snapshot.founders.map((item) => item.owner_customer_id || item.owner_public_url),
  listings: snapshot.listings.map((item) => item.listing_id),
  companies: snapshot.companies.map((item) => item.id)
});

async function loadState() {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(await readFile(STATE_PATH, 'utf8')); } catch { return null; }
}

async function notify(payload) {
  const message = `[Hirey VC] ${payload.new_founders.length} new founders, ${payload.new_companies.length} new startups, ${payload.new_listings.length} new startup/fundraising signals.`;
  console.log(`${new Date().toISOString()} ${message}`);
  for (const item of payload.new_founders.slice(0, 5)) console.log(`  founder: ${item.display_name} — ${item.headline || ''}`);
  for (const item of payload.new_companies.slice(0, 5)) console.log(`  startup: ${item.display_name} — ${item.summary || ''}`);
  if (WEBHOOK) {
    const response = await fetch(WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: message, ...payload })
    });
    if (!response.ok) throw new Error(`Alert webhook failed (${response.status})`);
  }
}

const creds = await credentials();
console.log(`Hirey VC watcher started. Scanning every ${INTERVAL / 1000}s.`);

async function tick() {
  try {
    const snapshot = await scan(await token(creds));
    const previous = await loadState();
    const currentIds = ids(snapshot);
    if (previous) {
      const newFounders = snapshot.founders.filter((item) => !previous.founders.includes(item.owner_customer_id || item.owner_public_url));
      const newListings = snapshot.listings.filter((item) => !previous.listings.includes(item.listing_id));
      const newCompanies = snapshot.companies.filter((item) => !previous.companies.includes(item.id));
      if (newFounders.length || newListings.length || newCompanies.length) {
        await notify({
          scanned_at: new Date().toISOString(),
          new_founders: newFounders,
          new_listings: newListings,
          new_companies: newCompanies
        });
      }
    } else {
      console.log(`${new Date().toISOString()} Baseline saved; future additions will trigger alerts.`);
    }
    await mkdir(STATE_DIR, { recursive: true, mode: 0o700 });
    await writeFile(STATE_PATH, JSON.stringify(currentIds, null, 2), { mode: 0o600 });
  } catch (error) {
    console.error(`${new Date().toISOString()} Watch scan failed: ${error.message}`);
  }
}

await tick();
setInterval(tick, INTERVAL);
