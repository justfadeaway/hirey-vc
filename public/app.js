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
  if (page === 'pipeline') return viewPipeline();
  return viewDealflow();
}

async function bootstrap() {
  savePipeline();
  try {
    const health = await fetch(api('api/health')).then((response) => response.json());
    connectedIdentity = health.connected_identity;
    $('#connection').textContent = connectedIdentity ? 'Hi identity connected · outreach enabled' : 'Explore mode · connect Hi credentials for outreach';
    $('#connection').classList.toggle('readonly', !connectedIdentity);
  } catch {
    $('#connection').textContent = 'Hi connection unavailable';
    $('#connection').classList.add('readonly');
  }
  route();
}

window.addEventListener('hashchange', route);
bootstrap();
