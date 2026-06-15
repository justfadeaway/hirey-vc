#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');
const HI_BASE = (process.env.HI_BASE_URL || 'https://hi.hirey.ai').replace(/\/+$/, '');
const PORT = Number(process.env.PORT || 4174);
const CREDS_DIR = join(homedir(), '.config', 'hirey-vc');
const CREDS_PATH = join(CREDS_DIR, 'credentials.json');

const READ = new Set([
  'hi.owners:search',
  'hi.owners:get',
  'hi.owners:list_listings',
  'hi.agent-listings:browse_recent',
  'hi.companies:list_recent',
  'hi.companies:get',
  'hi.companies:list_listings',
  'hi.agent-listings:get'
]);
const WRITE = new Set([
  'hi.pairings:contact_owner',
  'hi.pairings:contact_company'
]);

class HiAgent {
  constructor(credentials, userSupplied) {
    this.credentials = credentials;
    this.userSupplied = userSupplied;
    this.token = null;
    this.expiresAt = 0;
  }

  async accessToken() {
    if (this.token && this.expiresAt - Date.now() > 60_000) return this.token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.credentials.client_id,
      client_secret: this.credentials.client_secret,
      audience: 'hirey-hi'
    });
    const response = await fetch(`${HI_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!response.ok) throw new Error(`Hi token exchange failed (${response.status})`);
    const data = await response.json();
    this.token = data.access_token;
    this.expiresAt = Date.now() + (data.expires_in || 3600) * 1000;
    return this.token;
  }
}

async function registerAgent() {
  const response = await fetch(`${HI_BASE}/v1/agents/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      display_name: 'Hirey VC',
      agent_kind: 'external',
      metadata: { host: 'hirey-vc', purpose: 'venture-dealflow' }
    })
  });
  if (!response.ok) throw new Error(`Hi registration failed (${response.status})`);
  const data = await response.json();
  const credentials = {
    client_id: data.auth.client_id,
    client_secret: data.auth.client_secret,
    agent_id: data.agent.agent_id
  };
  await mkdir(CREDS_DIR, { recursive: true, mode: 0o700 });
  await writeFile(CREDS_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });
  return credentials;
}

async function loadAgent() {
  if (process.env.HI_CLIENT_ID && process.env.HI_CLIENT_SECRET) {
    return new HiAgent({
      client_id: process.env.HI_CLIENT_ID,
      client_secret: process.env.HI_CLIENT_SECRET,
      agent_id: process.env.HI_AGENT_ID || null
    }, true);
  }
  if (existsSync(CREDS_PATH)) {
    try {
      const credentials = JSON.parse(await readFile(CREDS_PATH, 'utf8'));
      if (credentials.client_id && credentials.client_secret) return new HiAgent(credentials, false);
    } catch {
      // Register a fresh read-only browsing identity below.
    }
  }
  return new HiAgent(await registerAgent(), false);
}

async function callHi(capability, action, params = {}) {
  const response = await fetch(`${HI_BASE}/v1/capabilities/${capability}/call`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await agent.accessToken()}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({ action, ...params })
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { error: 'bad_upstream_json' };
  }
  return { status: response.status, data };
}

async function radarSnapshot() {
  const [foundersResult, listingsResult, companiesResult] = await Promise.all([
    callHi('hi.owners', 'search', { q: 'startup founder fundraising', limit: 30 }),
    callHi('hi.agent-listings', 'browse_recent', { limit: 50 }),
    callHi('hi.companies', 'list_recent', { limit: 50 })
  ]);
  const founders = foundersResult.data?.result?.people || [];
  const listings = (listingsResult.data?.result?.items || []).filter((item) => {
    const text = `${item.listing_type_id || ''} ${item.target_preview_text || ''}`.toLowerCase();
    return item.listing_type_id === 'fundraising'
      || /\bstartup\b|\bfounder\b|\bcofounder\b|\bseed\b|\bventure\b|\braising\b|创业|融资|创始人/.test(text);
  });
  const companies = companiesResult.data?.result?.companies || [];
  return {
    scanned_at: new Date().toISOString(),
    founders,
    listings,
    companies
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8'
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

let agent;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        connected_identity: agent.userSupplied,
        agent_id: agent.credentials.agent_id || null
      });
    }

    if (url.pathname === '/api/radar') {
      return json(res, 200, await radarSnapshot());
    }

    if (url.pathname === '/api/call' && req.method === 'POST') {
      const request = await body(req);
      const key = `${request.capability}:${request.action}`;
      const allowed = READ.has(key) || WRITE.has(key);
      if (!allowed) return json(res, 403, { error: `Capability not allowed: ${key}` });
      if (WRITE.has(key) && !agent.userSupplied) {
        return json(res, 401, {
          error: 'Connect your verified Hi identity with HI_CLIENT_ID and HI_CLIENT_SECRET before contacting founders.'
        });
      }
      const result = await callHi(request.capability, request.action, request.params || {});
      return json(res, result.status, result.data);
    }

    const relative = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = normalize(join(PUBLIC, relative));
    if (file.startsWith(PUBLIC) && existsSync(file) && extname(file)) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      return res.end(await readFile(file));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(PUBLIC, 'index.html')));
  } catch (error) {
    json(res, 500, { error: error.message || String(error) });
  }
});

agent = await loadAgent();
const token = await agent.accessToken();
await fetch(`${HI_BASE}/v1/agents/activate`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: '{}'
}).catch(() => {});

server.listen(PORT, () => {
  console.log(`Hirey VC is live at http://localhost:${PORT}`);
  console.log(agent.userSupplied
    ? 'Founder outreach is enabled with your Hi identity.'
    : 'Browsing is ready. Set HI_CLIENT_ID and HI_CLIENT_SECRET to enable founder outreach.');
});
