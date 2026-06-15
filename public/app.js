const app = document.getElementById('app');
const modal = document.getElementById('modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const toastEl = document.getElementById('toast');
const $ = (selector, root = document) => root.querySelector(selector);

const MOUNT = location.pathname.endsWith('/') ? location.pathname : `${location.pathname}/`;
const api = (path) => `${MOUNT}${path}`;
const stages = ['Sourced', 'Meeting', 'Diligence', 'IC'];
let connectedIdentity = false;
let currentResults = { people: [], listings: [] };
let pipeline = JSON.parse(localStorage.getItem('hirey-vc-pipeline') || '[]');
let radarState = JSON.parse(localStorage.getItem('hirey-vc-radar') || 'null');
let alerts = JSON.parse(localStorage.getItem('hirey-vc-alerts') || '[]');
let radarTimer = null;

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

const safeUrl = (value) => {
  try {
    const url = new URL(String(value || ''), location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
};

function ownerPublicId(owner) {
  const match = String(owner.owner_public_url || '').match(/\/owner\/(\d+)/);
  return match ? match[1] : owner.owner_public_id || null;
}

function initials(name) {
  return String(name || '?').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function savePipeline() {
  localStorage.setItem('hirey-vc-pipeline', JSON.stringify(pipeline));
  $('#pipeline-count').textContent = pipeline.length;
}

function saveAlerts() {
  alerts = alerts.slice(0, 200);
  localStorage.setItem('hirey-vc-alerts', JSON.stringify(alerts));
  $('#alert-count').textContent = alerts.filter((item) => !item.read).length;
}

function toast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { toastEl.hidden = true; }, 3200);
}

function openModal(title, html) {
  modalTitle.textContent = title;
  modalBody.innerHTML = html;
  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  modalBody.innerHTML = '';
}

$('#modal-close').onclick = closeModal;
modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });

async function hi(capability, action, params = {}) {
  const response = await fetch(api('api/call'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ capability, action, params })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return data.result || data;
}

async function postJson(path, payload) {
  const response = await fetch(api(path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

const radarIds = (snapshot) => ({
  founders: (snapshot.founders || []).map((item) => item.owner_customer_id || item.owner_public_url),
  listings: (snapshot.listings || []).map((item) => item.listing_id),
  companies: (snapshot.companies || []).map((item) => item.id)
});

function pushBrowserNotification(newItems) {
  if (!newItems.length || !('Notification' in window) || Notification.permission !== 'granted') return;
  const counts = newItems.reduce((out, item) => {
    out[item.kind] = (out[item.kind] || 0) + 1;
    return out;
  }, {});
  const parts = [
    counts.founder && `${counts.founder} founder${counts.founder > 1 ? 's' : ''}`,
    counts.startup && `${counts.startup} startup${counts.startup > 1 ? 's' : ''}`,
    counts.signal && `${counts.signal} funding signal${counts.signal > 1 ? 's' : ''}`
  ].filter(Boolean);
  new Notification('New Hirey VC dealflow', {
    body: parts.join(', '),
    icon: api('icon.svg')
  });
}

async function scanRadar({ silent = false } = {}) {
  try {
    const snapshot = await fetch(api('api/radar')).then((response) => {
      if (!response.ok) throw new Error(`Radar HTTP ${response.status}`);
      return response.json();
    });
    const nextIds = radarIds(snapshot);
    if (radarState) {
      const discovered = [
        ...(snapshot.founders || [])
          .filter((item) => !radarState.founders.includes(item.owner_customer_id || item.owner_public_url))
          .map((item) => ({
            id: `founder:${item.owner_customer_id || item.owner_public_url}`,
            kind: 'founder',
            name: item.display_name || 'New founder',
            summary: item.headline || 'New startup founder discovered on Hi',
            url: item.owner_public_url || '',
            createdAt: snapshot.scanned_at,
            read: false
          })),
        ...(snapshot.companies || [])
          .filter((item) => !radarState.companies.includes(item.id))
          .map((item) => ({
            id: `startup:${item.id}`,
            kind: 'startup',
            name: item.display_name || 'New startup',
            summary: item.summary || item.location_text || 'New company page on Hi',
            url: item.public_url || '',
            createdAt: item.created_at || snapshot.scanned_at,
            read: false
          })),
        ...(snapshot.listings || [])
          .filter((item) => !radarState.listings.includes(item.listing_id))
          .map((item) => ({
            id: `signal:${item.listing_id}`,
            kind: 'signal',
            name: item.listing_type_id === 'fundraising' ? 'New fundraising signal' : 'New startup signal',
            summary: item.target_preview_text || '',
            url: '',
            createdAt: item.listing_created_at || snapshot.scanned_at,
            read: false
          }))
      ].filter((item) => !alerts.some((existing) => existing.id === item.id));
      if (discovered.length) {
        alerts.unshift(...discovered);
        saveAlerts();
        pushBrowserNotification(discovered);
        if (!silent) toast(`${discovered.length} new dealflow signal${discovered.length > 1 ? 's' : ''}`);
        if (location.hash.startsWith('#/alerts')) viewAlerts();
      }
    }
    radarState = nextIds;
    localStorage.setItem('hirey-vc-radar', JSON.stringify(radarState));
    return snapshot;
  } catch (error) {
    if (!silent) toast(`Radar scan failed: ${error.message}`);
    return null;
  }
}

function addToPipeline(item, kind) {
  const id = kind === 'person'
    ? item.owner_customer_id || item.owner_public_url
    : item.listing_id || item.id;
  if (pipeline.some((deal) => deal.id === id)) return toast('Already in your pipeline');
  pipeline.unshift({
    id,
    kind,
    stage: 'Sourced',
    name: kind === 'person' ? item.display_name : item.owner?.display_name || item.display_name || 'New opportunity',
    headline: kind === 'person' ? item.headline : item.preview_text || item.summary || '',
    ownerPublicId: kind === 'person' ? ownerPublicId(item) : ownerPublicId(item.owner || {}),
    url: kind === 'person' ? item.owner_public_url : item.owner?.owner_public_url || item.public_url || '',
    addedAt: new Date().toISOString()
  });
  savePipeline();
  toast('Added to pipeline');
}

function memoFor(item) {
  const name = item.display_name || item.owner?.display_name || item.name || 'Opportunity';
  const headline = item.headline || item.preview_text || item.summary || '';
  const location = item.location_text || item.owner?.location_text || 'Not disclosed';
  return `# Investment Memo: ${name}

## Snapshot
- Founder / company: ${name}
- Location: ${location}
- Source: Hirey Hi network
- Status: Sourced
- Date: ${new Date().toISOString().slice(0, 10)}

## Why this surfaced
${headline || 'No public summary was provided.'}

## Thesis fit
- Market:
- Stage:
- Geography:
- Check size:
- Why now:

## Founder-market fit
-

## Product and traction
-

## Key risks
-

## Next diligence questions
1.
2.
3.

## Recommendation
`;
}

function showMemo(item) {
  const memo = memoFor(item);
  openModal('Investment memo', `
    <div class="memo">${esc(memo)}</div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="copy-memo">Copy Markdown</button>
      <button class="btn btn-acid" id="download-memo">Download .md</button>
    </div>`);
  $('#copy-memo').onclick = async () => {
    await navigator.clipboard.writeText(memo);
    toast('Memo copied');
  };
  $('#download-memo').onclick = () => {
    const blob = new Blob([memo], { type: 'text/markdown' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${String(item.display_name || item.name || 'investment-memo').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
}

function reachOut(item) {
  const name = item.display_name || item.owner?.display_name || 'founder';
  const publicId = ownerPublicId(item.owner || item);
  if (!publicId) return toast('This profile does not expose a contact route');
  const defaultText = `Hi ${name}, I found your profile through Hirey VC. Your work looks relevant to our investment thesis, and I would like to learn more about what you are building. Would you be open to a short introductory conversation?`;
  openModal(`Reach out to ${name}`, `
    <p class="meta">This opens a real 1:1 thread on Hi. Review the note before sending.</p>
    <textarea id="outreach-note">${esc(defaultText)}</textarea>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="cancel-outreach">Cancel</button>
      <button class="btn btn-acid" id="send-outreach">Open conversation</button>
    </div>`);
  $('#cancel-outreach').onclick = closeModal;
  $('#send-outreach').onclick = async () => {
    const button = $('#send-outreach');
    button.disabled = true;
    button.textContent = 'Opening…';
    try {
      await hi('hi.pairings', 'contact_owner', {
        target_owner_public_id: Number(publicId),
        text: $('#outreach-note').value.trim()
      });
      closeModal();
      toast(`Conversation opened with ${name}`);
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Open conversation';
      toast(error.message);
    }
  };
}

function founderCard(person, index) {
  const tags = ['Founder', person.location_text, /fund|rais/i.test(person.headline || '') ? 'Fundraising' : 'Thesis match'].filter(Boolean);
  return `<article class="card founder-card">
    <div class="founder-top">
      <div class="avatar">${esc(initials(person.display_name))}</div>
      <div><div class="founder-name">${esc(person.display_name || 'Anonymous founder')}</div><div class="meta">${esc(person.location_text || 'Location not listed')}</div></div>
    </div>
    <div class="headline">${esc(person.headline || 'Founder on the Hi network')}</div>
    <div class="tags">${tags.map((tag) => `<span class="tag">${esc(tag)}</span>`).join('')}</div>
    <div class="actions">
      <button class="btn btn-ghost btn-small" data-founder-pipeline="${index}">Pipeline</button>
      <button class="btn btn-ghost btn-small" data-founder-memo="${index}">Memo</button>
      <button class="btn btn-acid btn-small" data-founder-reach="${index}">Reach out</button>
    </div>
  </article>`;
}

function listingCard(listing, index) {
  const owner = listing.owner || {};
  return `<article class="card listing-card">
    <div class="type">${esc(listing.listing_type_id || 'Opportunity')}</div>
    <h3>${esc(owner.display_name || 'Fundraising opportunity')}</h3>
    <p>${esc(listing.preview_text || '')}</p>
    <div class="meta">${esc(owner.headline || '')}</div>
    <div class="actions" style="margin-top:14px">
      <button class="btn btn-ghost btn-small" data-listing-pipeline="${index}">Pipeline</button>
      <button class="btn btn-ghost btn-small" data-listing-memo="${index}">Memo</button>
      ${ownerPublicId(owner) ? `<button class="btn btn-acid btn-small" data-listing-reach="${index}">Reach out</button>` : ''}
    </div>
  </article>`;
}

function bindResultActions() {
  document.querySelectorAll('[data-founder-pipeline]').forEach((button) => {
    button.onclick = () => addToPipeline(currentResults.people[Number(button.dataset.founderPipeline)], 'person');
  });
  document.querySelectorAll('[data-founder-memo]').forEach((button) => {
    button.onclick = () => showMemo(currentResults.people[Number(button.dataset.founderMemo)]);
  });
  document.querySelectorAll('[data-founder-reach]').forEach((button) => {
    button.onclick = () => reachOut(currentResults.people[Number(button.dataset.founderReach)]);
  });
  document.querySelectorAll('[data-listing-pipeline]').forEach((button) => {
    button.onclick = () => addToPipeline(currentResults.listings[Number(button.dataset.listingPipeline)], 'listing');
  });
  document.querySelectorAll('[data-listing-memo]').forEach((button) => {
    button.onclick = () => showMemo(currentResults.listings[Number(button.dataset.listingMemo)]);
  });
  document.querySelectorAll('[data-listing-reach]').forEach((button) => {
    button.onclick = () => reachOut(currentResults.listings[Number(button.dataset.listingReach)]);
  });
}

async function search(query) {
  const target = $('#results');
  target.innerHTML = '<div class="loading">Scanning founders, fundraising listings and thesis signals…</div>';
  try {
    currentResults = await hi('hi.owners', 'search', { q: query, limit: 12 });
    target.innerHTML = `
      <div class="section-head"><div><h2>Founders</h2><p>${currentResults.people.length} live profile matches</p></div></div>
      <div class="grid">${currentResults.people.length ? currentResults.people.map(founderCard).join('') : '<div class="empty">No founder profiles matched this thesis.</div>'}</div>
      <div class="section-head"><div><h2>Fundraising signals</h2><p>${currentResults.listings.length} relevant public listings</p></div></div>
      <div class="grid">${currentResults.listings.length ? currentResults.listings.map(listingCard).join('') : '<div class="empty">No fundraising listings matched this thesis.</div>'}</div>`;
    bindResultActions();
  } catch (error) {
    target.innerHTML = `<div class="empty">Could not search Hi: ${esc(error.message)}</div>`;
  }
}

function viewDealflow() {
  app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Live people graph for private markets</div>
        <h1>Source conviction,<br>not just companies.</h1>
        <p>Search founders and active fundraising intent across Hirey Hi. Turn a thesis into conversations, a private pipeline, and an investment memo without leaving the page.</p>
      </div>
      <div class="hero-stat"><strong>Hi</strong><span>Founder intent, company context and warm outreach in one graph.</span></div>
    </section>
    <section class="search-panel">
      <form class="search-row" id="thesis-form">
        <input id="thesis-input" value="AI infrastructure founders raising seed in San Francisco" aria-label="Investment thesis">
        <button class="btn btn-acid">Run thesis</button>
      </form>
      <div class="chips">
        ${['AI agents · seed · SF', 'Devtools founders raising', 'Healthcare AI · Series A', 'Climate software · US', 'Repeat founders · enterprise AI'].map((label) => `<button class="chip">${label}</button>`).join('')}
      </div>
    </section>
    <section id="results"></section>`;
  $('#thesis-form').onsubmit = (event) => {
    event.preventDefault();
    search($('#thesis-input').value.trim());
  };
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.onclick = () => {
      $('#thesis-input').value = chip.textContent.replaceAll('·', ' ');
      search($('#thesis-input').value);
    };
  });
  search($('#thesis-input').value);
}

async function viewCompanies() {
  app.innerHTML = `
    <section class="hero"><div><div class="eyebrow">Company radar</div><h1>See what is forming now.</h1><p>Recent public company pages on Hi, including founder-claimed companies and ecosystem signals.</p></div></section>
    <div id="company-grid" class="grid"><div class="loading">Loading companies…</div></div>`;
  try {
    const result = await hi('hi.companies', 'list_recent', { limit: 30 });
    $('#company-grid').innerHTML = (result.companies || []).map((company, index) => `
      <article class="card company-card">
        <div class="avatar">${esc(initials(company.display_name))}</div>
        <h3>${esc(company.display_name)}</h3>
        <div class="meta">${esc(company.location_text || 'Location not listed')}</div>
        <p>${esc(company.summary || 'Public company page on Hirey Hi.')}</p>
        <div class="actions">
          <a class="btn btn-ghost btn-small" href="${esc(safeUrl(company.public_url))}" target="_blank" rel="noopener">Profile</a>
          <button class="btn btn-ghost btn-small" data-company-memo="${index}">Memo</button>
        </div>
      </article>`).join('');
    document.querySelectorAll('[data-company-memo]').forEach((button) => {
      button.onclick = () => showMemo(result.companies[Number(button.dataset.companyMemo)]);
    });
  } catch (error) {
    $('#company-grid').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}

function viewClaims() {
  app.innerHTML = `
    <section class="hero">
      <div>
        <div class="eyebrow">Verified VC identity</div>
        <h1>Claim your firm<br>on the Hirey map.</h1>
        <p>If your fund or firm already appears as a seeded placeholder on the SF map, verify an email at the exact company website domain and submit an ownership claim for staff review.</p>
      </div>
      <div class="hero-stat"><strong>@</strong><span>Domain verification starts the claim. Ownership transfers only after Hirey staff reviews the placeholder and any conflicts.</span></div>
    </section>
    <section class="claim-layout">
      <form class="claim-card" id="claim-start-form">
        <div class="claim-step">1</div>
        <h2>Find the placeholder</h2>
        <p>Paste its Hirey company URL, for example <code>https://hi.hirey.ai/company/87</code>.</p>
        <label>Hirey company URL or public ID</label>
        <input id="claim-company" required placeholder="https://hi.hirey.ai/company/87">
        <label>Work email</label>
        <input id="claim-email" required type="email" autocomplete="email" placeholder="you@yourfund.com">
        <button class="btn btn-acid" id="claim-start-button">Send verification code</button>
      </form>
      <section class="claim-card claim-policy">
        <div class="claim-step">✓</div>
        <h2>What gets checked</h2>
        <ul>
          <li>The company must still be a seeded public-data placeholder.</li>
          <li>Your email domain must exactly match the company website domain.</li>
          <li>Public mailbox domains are not accepted.</li>
          <li>Hirey staff reviews conflicts before transferring ownership.</li>
        </ul>
        <a class="btn btn-ghost" href="https://hirey.ai/#sf-map" target="_blank" rel="noopener">Open the SF map</a>
      </section>
    </section>
    <section class="claim-card claim-verify" id="claim-verify-panel" hidden>
      <div class="claim-step">2</div>
      <h2>Enter the code</h2>
      <p id="claim-verify-copy"></p>
      <form class="search-row" id="claim-verify-form">
        <input id="claim-code" required inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="6-digit code">
        <button class="btn btn-acid" id="claim-verify-button">Submit claim</button>
      </form>
    </section>`;

  let activeClaimId = null;
  $('#claim-start-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = $('#claim-start-button');
    button.disabled = true;
    button.textContent = 'Sending…';
    try {
      const result = await postJson('api/claims/start', {
        company: $('#claim-company').value,
        email: $('#claim-email').value
      });
      activeClaimId = result.claim_id;
      $('#claim-verify-copy').textContent = `We sent a code to ${$('#claim-email').value.trim()}. Verifying it will submit a claim for ${result.company_name} (@${result.domain}).`;
      $('#claim-verify-panel').hidden = false;
      $('#claim-code').focus();
      toast('Verification code sent');
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = 'Send verification code';
    }
  };

  $('#claim-verify-form').onsubmit = async (event) => {
    event.preventDefault();
    const button = $('#claim-verify-button');
    button.disabled = true;
    button.textContent = 'Submitting…';
    try {
      const result = await postJson('api/claims/verify', {
        claim_id: activeClaimId,
        code: $('#claim-code').value
      });
      $('#claim-verify-panel').innerHTML = `
        <div class="claim-step">✓</div>
        <h2>Claim submitted</h2>
        <p>Your domain was verified and the ownership request for <strong>${esc(result.company_name)}</strong> is now pending Hirey staff review.</p>
        <a class="btn btn-ghost" href="https://hi.hirey.ai/company/${esc(result.company_public_id)}" target="_blank" rel="noopener">View company page</a>`;
      toast('Claim submitted for review');
    } catch (error) {
      toast(error.message);
      button.disabled = false;
      button.textContent = 'Submit claim';
    }
  };
}

function relativeTime(value) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function viewAlerts() {
  alerts = alerts.map((item) => ({ ...item, read: true }));
  saveAlerts();
  app.innerHTML = `
    <section class="hero"><div><div class="eyebrow">Always-on startup radar</div><h1>New founders,<br>as they emerge.</h1><p>The radar scans Hi for newly discovered founders, company pages and startup or fundraising signals. Keep this page open for browser notifications, or run the background watcher.</p></div></section>
    <section class="alert-toolbar">
      <div><strong>Live radar · every 2 minutes</strong><p>First scan creates a baseline; only later additions are alerted.</p></div>
      <div class="actions">
        <button class="btn btn-ghost btn-small" id="scan-now">Scan now</button>
        <button class="btn btn-acid btn-small" id="enable-alerts">${'Notification' in window && Notification.permission === 'granted' ? 'Notifications on' : 'Enable notifications'}</button>
      </div>
    </section>
    <section class="alert-stream">
      ${alerts.length ? alerts.map((item) => `<article class="alert-card ${item.read ? '' : 'unread'}">
        <div class="alert-kind">${esc(item.kind === 'signal' ? 'funding signal' : item.kind)}</div>
        <div><strong>${esc(item.name)}</strong><p>${esc(item.summary)}</p></div>
        <div class="alert-time">${relativeTime(item.createdAt)}</div>
      </article>`).join('') : '<div class="empty">Radar baseline is ready. New startups and founders will appear here automatically.</div>'}
    </section>`;
  $('#scan-now').onclick = async () => {
    $('#scan-now').textContent = 'Scanning…';
    await scanRadar();
    if ($('#scan-now')) $('#scan-now').textContent = 'Scan now';
  };
  $('#enable-alerts').onclick = async () => {
    if (!('Notification' in window)) return toast('This browser does not support notifications');
    const permission = await Notification.requestPermission();
    $('#enable-alerts').textContent = permission === 'granted' ? 'Notifications on' : 'Notifications blocked';
    if (permission === 'granted') toast('Browser notifications enabled');
  };
}

function viewPipeline() {
  const grouped = Object.fromEntries(stages.map((stage) => [stage, pipeline.filter((deal) => deal.stage === stage)]));
  app.innerHTML = `
    <section class="hero"><div><div class="eyebrow">Private local pipeline</div><h1>Your next partner meeting.</h1><p>Deals are stored only in this browser. Move them through your process and export a memo when a signal becomes conviction.</p></div></section>
    <section class="pipeline-board">
      ${stages.map((stage) => `<div class="stage"><h3>${stage}<span>${grouped[stage].length}</span></h3>
        ${grouped[stage].map((deal) => `<article class="deal">
          <strong>${esc(deal.name)}</strong><p>${esc(deal.headline)}</p>
          <select data-deal-id="${esc(deal.id)}">${stages.map((option) => `<option ${option === deal.stage ? 'selected' : ''}>${option}</option>`).join('')}</select>
          <div class="actions" style="margin-top:8px"><button class="btn btn-ghost btn-small" data-deal-memo="${esc(deal.id)}">Memo</button><button class="btn btn-ghost btn-small" data-deal-remove="${esc(deal.id)}">Remove</button></div>
        </article>`).join('') || '<div class="empty">No deals</div>'}
      </div>`).join('')}
    </section>`;
  document.querySelectorAll('[data-deal-id]').forEach((select) => {
    select.onchange = () => {
      const deal = pipeline.find((item) => item.id === select.dataset.dealId);
      deal.stage = select.value;
      savePipeline();
      viewPipeline();
    };
  });
  document.querySelectorAll('[data-deal-memo]').forEach((button) => {
    button.onclick = () => showMemo(pipeline.find((item) => item.id === button.dataset.dealMemo));
  });
  document.querySelectorAll('[data-deal-remove]').forEach((button) => {
    button.onclick = () => {
      pipeline = pipeline.filter((item) => item.id !== button.dataset.dealRemove);
      savePipeline();
      viewPipeline();
    };
  });
}

function route() {
  const page = location.hash.split('/')[1] || 'dealflow';
  document.querySelectorAll('[data-route]').forEach((link) => link.classList.toggle('active', link.dataset.route === page));
  if (page === 'companies') return viewCompanies();
  if (page === 'claims') return viewClaims();
  if (page === 'alerts') return viewAlerts();
  if (page === 'pipeline') return viewPipeline();
  return viewDealflow();
}

async function bootstrap() {
  savePipeline();
  saveAlerts();
  route();
  try {
    const health = await fetch(api('api/health')).then((response) => response.json());
    connectedIdentity = health.connected_identity;
    $('#connection').textContent = connectedIdentity ? 'Hi identity connected · outreach enabled' : 'Explore mode · connect Hi credentials for outreach';
    $('#connection').classList.toggle('readonly', !connectedIdentity);
  } catch {
    $('#connection').textContent = 'Hi connection unavailable';
    $('#connection').classList.add('readonly');
  }
  void scanRadar({ silent: true });
  clearInterval(radarTimer);
  radarTimer = setInterval(() => scanRadar({ silent: true }), 120_000);
}

window.addEventListener('hashchange', route);
bootstrap();
