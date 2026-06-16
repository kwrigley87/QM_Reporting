// Genesys QM Insights - Authorization Code + PKCE, browser-only dashboard.
// Replace the clientId values below with PKCE OAuth clients created in the matching Genesys Cloud region.

const APP_VERSION = '0.4.2';
const CONFIG_KEY = 'qmInsights.config.v2';
const CACHE_KEY = 'qmInsights.cache.v2';
const TOKEN_KEY = 'qmInsights.token.v2';
const PKCE_KEY = 'qmInsights.pkce.v2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REGION = 'usw2.pure.cloud';
const OAUTH_CLIENTS = {
  'usw2.pure.cloud': {
    clientId: '525dc009-269e-4625-9a3a-9bf5d31a76f1',
    redirectUri: 'https://kwrigley87.github.io/QM_Reporting/'
  }
  // Add more regions here when you create matching PKCE OAuth clients.
};

let state = {
  token: null,
  region: DEFAULT_REGION,
  rows: [],
  evaluations: [],
  evaluationSummaries: [],
  aggregateSearchResults: null,
  searchRows: [],
  detailLoaded: false,
  charts: {},
  cache: loadCache(),
  runTimer: null,
  metadataLoaded: false,
};

const $ = (id) => document.getElementById(id);
function splitOptionValue(value) {
  return String(value || '').split('|').map((v) => v.trim()).filter(Boolean);
}
function selectedValues(id) {
  const el = $(id);
  if (!el) return [];
  const values = el.tagName === 'SELECT'
    ? Array.from(el.selectedOptions || []).flatMap((o) => splitOptionValue(o.value))
    : Array.from(el.querySelectorAll('input[type=checkbox]:checked')).flatMap((o) => splitOptionValue(o.value));
  return [...new Set(values)].filter(Boolean);
}

function setStatus(message) { $('status').textContent = message; }
function setBusy(isBusy) {
  ['exportBtn', 'resetFiltersBtn'].forEach((id) => { if ($(id)) $(id).disabled = isBusy; });
}
function today(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function n(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}
function avg(values) {
  const nums = values.map(n).filter((v) => v !== null);
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}
function fmt(value, digits = 1) {
  const num = n(value);
  return num === null ? '-' : num.toFixed(digits);
}
function dateKey(value) {
  return value ? String(value).slice(0, 10) : '';
}
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; }
}
function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(getConfigFromUi()));
}
function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return {
      users: cache.users || {},
      forms: cache.forms || {},
      divisions: cache.divisions || {},
      teams: cache.teams || {},
      queues: cache.queues || {},
      evaluations: cache.evaluations || {},
      savedAt: cache.savedAt || Date.now(),
    };
  } catch {
    return { users: {}, forms: {}, divisions: {}, teams: {}, queues: {}, evaluations: {}, savedAt: Date.now() };
  }
}
function saveCache() {
  state.cache.savedAt = Date.now();
  localStorage.setItem(CACHE_KEY, JSON.stringify(state.cache));
}
function clearCache() {
  localStorage.removeItem(CACHE_KEY);
  state.cache = loadCache();
  state.metadataLoaded = false;
  populateFilterOptions(getConfigFromUi());
  updateActiveFilterChips();
  setStatus('Browser metadata cache cleared. Filter selections were kept; use Refresh lists to retrieve users, forms, queues, divisions, and teams again.');
}
function resetFilters() {
  $('startDate').value = today(-7);
  $('endDate').value = today(0);
  $('sourceFilter').value = 'both';
  $('recordFilter').value = 'evaluation';
  ['formFilter', 'agentFilter', 'queueFilter', 'divisionFilter', 'teamFilter'].forEach(clearMultiFilterSelection);
  updateActiveFilterChips();
  debouncedRun();
}
function getConfigFromUi() {
  return {
    region: state.region || $('loginRegion').value || DEFAULT_REGION,
    startDate: $('startDate').value,
    endDate: $('endDate').value,
    sourceFilter: $('sourceFilter').value,
    recordFilter: $('recordFilter').value,
    formIds: selectedValues('formFilter'),
    agentIds: selectedValues('agentFilter'),
    divisionIds: selectedValues('divisionFilter'),
    teamIds: selectedValues('teamFilter'),
    queueIds: selectedValues('queueFilter'),
  };
}
function hydrateUi() {
  const cfg = loadConfig();
  state.region = cfg.region || DEFAULT_REGION;
  $('loginRegion').value = state.region;
  $('startDate').value = cfg.startDate || today(-7);
  $('endDate').value = cfg.endDate || today(0);
  $('sourceFilter').value = cfg.sourceFilter || 'both';
  $('recordFilter').value = cfg.recordFilter || 'evaluation';
  clearSelect('agentFilter', 'Sign in, then refresh filter lists');
  clearSelect('formFilter', 'Forms will populate after refresh or first dashboard run');
  clearSelect('divisionFilter', 'Sign in, then refresh filter lists');
  clearSelect('teamFilter', 'Sign in, then refresh filter lists');
  clearSelect('queueFilter', 'Sign in, then refresh filter lists');
  updateActiveFilterChips();
}
function apiHost(region = state.region) { return `api.${region}`; }
function loginHost(region = state.region) { return `login.${region}`; }
function oauthForRegion(region) {
  const oauth = OAUTH_CLIENTS[region];
  if (!oauth?.clientId || oauth.clientId.includes('REPLACE_WITH')) {
    throw new Error(`No PKCE OAuth client ID is configured in app.js for region ${region}.`);
  }
  return oauth;
}
async function sha256Base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function randomString(length = 96) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => ('0' + b.toString(16)).slice(-2)).join('');
}
function toggleRegionPopover(show = null) {
  const pop = $('regionPopover');
  const shouldShow = show === null ? pop.classList.contains('hidden') : show;
  pop.classList.toggle('hidden', !shouldShow);
}
function clearOAuthAttempt() {
  sessionStorage.removeItem(PKCE_KEY);
  localStorage.removeItem(PKCE_KEY);
}
function callbackCleanPath(saved = null) {
  const redirectUri = saved?.redirectUri || oauthForRegion(state.region).redirectUri || `${window.location.origin}${window.location.pathname}`;
  try {
    const url = new URL(redirectUri, window.location.origin);
    return `${url.pathname}${url.pathname.endsWith('/') ? '' : ''}` || window.location.pathname;
  } catch {
    return window.location.pathname;
  }
}
function getOAuthCallbackParams() {
  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get('code') || searchParams.get('error')) return searchParams;
  const rawHash = window.location.hash.replace(/^#/, '');
  const hashQuery = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : rawHash;
  const hashParams = new URLSearchParams(hashQuery);
  return hashParams.get('code') || hashParams.get('error') ? hashParams : new URLSearchParams();
}
async function startLogin() {
  clearOAuthAttempt();
  $('regionHelp').textContent = 'Only regions with a configured OAuth client ID can sign in.';
  toggleRegionPopover(true);
}
async function continueLogin() {
  const cfg = getConfigFromUi();
  const region = $('loginRegion').value;
  let oauth;
  try {
    oauth = oauthForRegion(region);
  } catch (e) {
    $('regionHelp').textContent = e.message;
    alert(e.message);
    return;
  }
  cfg.region = region;
  state.region = region;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const oauthState = randomString(16);
  const redirectUri = oauth.redirectUri || `${window.location.origin}${window.location.pathname}`;
  const pkcePayload = JSON.stringify({ codeVerifier, oauthState, cfg, clientId: oauth.clientId, redirectUri, createdAt: Date.now() });
  sessionStorage.setItem(PKCE_KEY, pkcePayload);
  localStorage.setItem(PKCE_KEY, pkcePayload);
  const authUrl = new URL(`https://${loginHost(region)}/oauth/authorize`);
  authUrl.searchParams.set('client_id', oauth.clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', oauthState);
  window.location.assign(authUrl.toString());
}
async function handleAuthCallback() {
  const params = getOAuthCallbackParams();
  const error = params.get('error');
  if (error) {
    clearOAuthAttempt();
    window.history.replaceState({}, document.title, callbackCleanPath());
    throw new Error(`OAuth failed: ${error} ${params.get('error_description') || ''}`.trim());
  }
  const code = params.get('code');
  if (!code) return false;
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || localStorage.getItem(PKCE_KEY) || '{}');
  if (!saved.codeVerifier || params.get('state') !== saved.oauthState) {
    clearOAuthAttempt();
    window.history.replaceState({}, document.title, callbackCleanPath(saved));
    throw new Error('OAuth state validation failed. Click Sign in and try again.');
  }
  try {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', saved.clientId);
    body.set('code', code);
    body.set('redirect_uri', saved.redirectUri);
    body.set('code_verifier', saved.codeVerifier);
    const res = await fetch(`https://${loginHost(saved.cfg.region)}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
    const token = await res.json();
    token.expires_at = Date.now() + ((token.expires_in || 3600) * 1000) - 60000;
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ token, region: saved.cfg.region }));
    clearOAuthAttempt();
    state.region = saved.cfg.region;
    $('loginRegion').value = state.region;
    window.history.replaceState({}, document.title, callbackCleanPath(saved));
    state.token = token;
    updateAuthUi();
    return true;
  } catch (e) {
    clearOAuthAttempt();
    window.history.replaceState({}, document.title, callbackCleanPath(saved));
    throw e;
  }
}
function loadToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}');
    if (saved.token && saved.token.expires_at > Date.now()) {
      state.token = saved.token;
      state.region = saved.region || state.region;
      $('loginRegion').value = state.region;
    }
  } catch {}
  updateAuthUi();
}
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  clearOAuthAttempt();
  state.token = null;
  state.rows = [];
  state.evaluations = [];
  state.evaluationSummaries = [];
  state.searchRows = [];
  state.detailLoaded = false;
  render();
  setStatus('Signed out. Choose Sign in to reconnect to Genesys Cloud.');
  updateAuthUi();
}
function updateAuthUi() {
  const signedIn = !!state.token?.access_token;
  if (signedIn) {
    $('authStatus').textContent = `Signed in - ${state.region}`;
    $('authStatus').className = 'pill ok';
  } else {
    $('authStatus').textContent = 'Not signed in';
    $('authStatus').className = 'pill warn';
  }
  $('loginBtn').classList.toggle('hidden', signedIn);
  $('logoutBtn').classList.toggle('hidden', !signedIn);
  toggleRegionPopover(false);
}
async function gcFetch(method, path, payload = null, retries = 4) {
  if (!state.token?.access_token) throw new Error('Not signed in.');
  const url = `https://${apiHost()}${path}`;
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${state.token.access_token}`, 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    }
    const body = await res.text();
    if (![408, 409, 429, 500, 502, 503, 504].includes(res.status) || i === retries) {
      throw new Error(`${method} ${path} failed: ${res.status} ${body}`);
    }
    const retryAfter = Number(res.headers.get('Retry-After') || 0);
    const waitMs = retryAfter ? retryAfter * 1000 : Math.min(30000, 1000 * Math.pow(2, i));
    await new Promise((r) => setTimeout(r, waitMs));
  }
}
async function fetchAllPages(path, key = 'entities', pageSize = 100) {
  const all = [];
  for (let pageNumber = 1; pageNumber <= 50; pageNumber++) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await gcFetch('GET', `${path}${sep}pageSize=${pageSize}&pageNumber=${pageNumber}`);
    const entities = data[key] || data.entities || [];
    all.push(...entities);
    const pageCount = data.pageCount || Math.ceil((data.total || all.length) / pageSize);
    if (!entities.length || pageNumber >= pageCount) break;
  }
  return all;
}
function optionValues(item) {
  return Array.isArray(item.ids) && item.ids.length ? item.ids : splitOptionValue(item.value || item.id);
}
function optionValue(item) {
  return optionValues(item).join('|');
}
function isOptionSelected(item, selectedSet) {
  return optionValues(item).some((id) => selectedSet.has(id));
}
function setOptions(id, items, selected = []) {
  const el = $(id);
  const selectedSet = new Set(selected);
  const placeholder = el.dataset.placeholder || 'Select values';
  if (el.tagName === 'SELECT') {
    el.innerHTML = items.map((x) => `<option value="${htmlEscape(optionValue(x))}"${isOptionSelected(x, selectedSet) ? ' selected' : ''}>${htmlEscape(x.name || x.email || x.id)}</option>`).join('');
    return;
  }
  const selectedCount = items.filter((x) => isOptionSelected(x, selectedSet)).length;
  const summary = selectedCount ? `${selectedCount} selected` : placeholder;
  el.innerHTML = `<button type="button" class="multi-filter-button" aria-expanded="false">${htmlEscape(summary)}</button>
    <div class="multi-filter-menu hidden">
      <label class="multi-filter-search">Search <input type="search" placeholder="Filter options" /></label>
      <div class="multi-filter-options">${items.length ? items.map((x) => {
        const label = x.name || x.email || x.id;
        return `<label class="check-row"><input type="checkbox" value="${htmlEscape(optionValue(x))}"${isOptionSelected(x, selectedSet) ? ' checked' : ''} /> <span>${htmlEscape(label)}</span></label>`;
      }).join('') : `<p class="note">${htmlEscape(placeholder)}</p>`}</div>
      <button type="button" class="link-button clear-filter-button">Clear selected</button>
    </div>`;
  wireMultiFilter(id);
}
function wireMultiFilter(id) {
  const el = $(id);
  const button = el.querySelector('.multi-filter-button');
  const menu = el.querySelector('.multi-filter-menu');
  const search = el.querySelector('input[type=search]');
  button?.addEventListener('click', () => {
    document.querySelectorAll('.multi-filter-menu').forEach((m) => { if (m !== menu) m.classList.add('hidden'); });
    const open = menu.classList.toggle('hidden') === false;
    button.setAttribute('aria-expanded', String(open));
    if (open) search?.focus();
  });
  el.querySelectorAll('input[type=checkbox]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    updateMultiFilterSummary(id);
    updateActiveFilterChips();
    debouncedRun();
  }));
  search?.addEventListener('input', () => {
    const term = search.value.toLowerCase();
    el.querySelectorAll('.check-row').forEach((row) => row.classList.toggle('hidden', !row.textContent.toLowerCase().includes(term)));
  });
  el.querySelector('.clear-filter-button')?.addEventListener('click', () => {
    clearMultiFilterSelection(id);
    updateActiveFilterChips();
    debouncedRun();
  });
}
function closeMultiFiltersOnOutsideClick(event) {
  if (event.target.closest('.multi-filter')) return;
  document.querySelectorAll('.multi-filter-menu').forEach((menu) => menu.classList.add('hidden'));
  document.querySelectorAll('.multi-filter-button').forEach((button) => button.setAttribute('aria-expanded', 'false'));
}
function updateMultiFilterSummary(id) {
  const el = $(id);
  const button = el.querySelector('.multi-filter-button');
  if (!button) return;
  const count = selectedValues(id).length;
  button.textContent = count ? `${count} selected` : (el.dataset.placeholder || 'Select values');
}
function clearMultiFilterSelection(id) {
  const el = $(id);
  el.querySelectorAll('input[type=checkbox]').forEach((checkbox) => { checkbox.checked = false; });
  updateMultiFilterSummary(id);
}
function clearSelect(id, placeholder) {
  const el = $(id);
  if (el) el.dataset.placeholder = placeholder;
  setOptions(id, [], []);
}
async function refreshMetadata(force = false) {
  if (!state.token?.access_token) return;
  const cfg = loadConfig();
  const now = Date.now();
  const fresh = !force && state.cache.metadataAt && now - state.cache.metadataAt < CACHE_TTL_MS;
  if (!fresh) {
    setStatus('Refreshing users, divisions, teams, and forms...');
    try {
      const users = await fetchAllPages('/api/v2/users?state=active', 'entities', 100);
      state.cache.userList = users.map((u) => ({ id: u.id, name: u.name || u.email || u.username || u.id, email: u.email || u.username || '', division: u.division || null }));
      for (const u of state.cache.userList) state.cache.users[u.id] = { data: u, cachedAt: now };
    } catch (e) { console.warn('User list failed', e); }
    try {
      const divisions = await fetchAllPages('/api/v2/authorization/divisions', 'entities', 100);
      state.cache.divisionList = divisions.map((d) => ({ id: d.id, name: d.name || d.id }));
    } catch (e) { console.warn('Division list failed', e); }
    try {
      const teams = await fetchAllPages('/api/v2/teams', 'entities', 100);
      state.cache.teamList = teams.map((t) => ({ id: t.id, name: t.name || t.id }));
    } catch (e) { console.warn('Team list failed', e); }
    try {
      const queues = await fetchAllPages('/api/v2/routing/queues', 'entities', 100);
      state.cache.queueList = queues.map((q) => ({ id: q.id, name: q.name || q.id }));
    } catch (e) { console.warn('Queue list failed', e); }
    try {
      const forms = await fetchAllPages('/api/v2/quality/publishedforms/evaluations', 'entities', 100);
      state.cache.formList = forms.map((f) => ({ id: f.id, name: f.name || f.context?.name || f.id, modifiedDate: f.modifiedDate || f.version?.date || f.createdDate || '' }));
    } catch (e) { console.warn('Published form list failed; forms will populate from evaluations', e); }
    state.cache.metadataAt = now;
    saveCache();
  }
  populateFilterOptions(cfg);
  state.metadataLoaded = true;
  setStatus('Filter lists refreshed.');
}
function populateFilterOptions(cfg = loadConfig()) {
  setOptions('agentFilter', (state.cache.userList || []).sort((a, b) => (a.name || '').localeCompare(b.name || '')), cfg.agentIds || []);
  setOptions('divisionFilter', (state.cache.divisionList || []).sort((a, b) => (a.name || '').localeCompare(b.name || '')), cfg.divisionIds || []);
  setOptions('teamFilter', (state.cache.teamList || []).sort((a, b) => (a.name || '').localeCompare(b.name || '')), cfg.teamIds || []);
  setOptions('queueFilter', (state.cache.queueList || []).sort((a, b) => (a.name || '').localeCompare(b.name || '')), cfg.queueIds || []);
  const fromDetails = Object.values(state.cache.forms || {}).map((x) => x.data).filter(Boolean).map((f) => ({ id: f.id, name: f.name || f.context?.name || f.id }));
  const forms = [...(state.cache.formList || []), ...fromDetails];
  const formsByName = new Map();
  for (const form of forms) {
    if (!form?.id) continue;
    const name = form.name || form.context?.name || form.id;
    const key = name.trim().toLowerCase();
    if (!formsByName.has(key)) formsByName.set(key, { id: form.id, ids: [], name });
    const grouped = formsByName.get(key);
    if (!grouped.ids.includes(form.id)) grouped.ids.push(form.id);
  }
  const uniqueForms = [...formsByName.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  setOptions('formFilter', uniqueForms, cfg.formIds || []);
}
async function getUser(userId) {
  if (!userId) return null;
  const cached = state.cache.users[userId];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  try {
    const user = await gcFetch('GET', `/api/v2/users/${userId}`);
    const slim = { id: user.id, name: user.name || user.email || user.username || '', email: user.email || user.username || '', division: user.division || null };
    state.cache.users[userId] = { data: slim, cachedAt: Date.now() };
    saveCache();
    return slim;
  } catch {
    return { id: userId, name: userId, email: '', division: null };
  }
}
async function getPublishedForm(formId) {
  if (!formId) return null;
  const cached = state.cache.forms[formId];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  const form = await gcFetch('GET', `/api/v2/quality/publishedforms/evaluations/${formId}`);
  state.cache.forms[formId] = { data: form, cachedAt: Date.now() };
  saveCache();
  populateFilterOptions(getConfigFromUi());
  return form;
}
function buildAggregateQuery(startDate, endDate, recordType, sourceFilter, cfg) {
  const calibrationOperator = recordType === 'calibration' ? 'exists' : 'notExists';
  const clauses = [{ type: 'or', predicates: [{ dimension: 'calibrationId', operator: calibrationOperator }] }];
  if (sourceFilter === 'human') clauses.push({ type: 'or', predicates: [{ dimension: 'systemSubmitted', value: 'false' }] });
  if (sourceFilter === 'auto') clauses.push({ type: 'or', predicates: [{ dimension: 'systemSubmitted', value: 'true' }] });
  if (cfg.agentIds?.length) clauses.push({ type: 'or', predicates: cfg.agentIds.map((value) => ({ dimension: 'agentId', value })) });
  if (cfg.formIds?.length) clauses.push({ type: 'or', predicates: cfg.formIds.map((value) => ({ dimension: 'evaluationFormId', value })) });
  if (cfg.queueIds?.length) clauses.push({ type: 'or', predicates: cfg.queueIds.map((value) => ({ dimension: 'queueId', value })) });
  return {
    interval: `${startDate}T00:00:00.000Z/${endDate}T23:59:59.999Z`,
    granularity: 'P1D',
    groupBy: ['conversationId', 'evaluationId'],
    filter: { type: 'and', clauses },
    metrics: ['nEvaluations'],
  };
}
function processForm(form) {
  const groupLookup = {}, questionLookup = {}, answerLookup = {}, questionMeta = {};
  for (const group of form?.questionGroups || []) {
    groupLookup[group.id] = group.name || '';
    for (const q of group.questions || []) {
      questionLookup[q.id] = q.text || '';
      questionMeta[q.id] = { type: q.type || '', naEnabled: q.naEnabled, isCritical: q.isCritical, isKill: q.isKill, hasVisibilityCondition: !!q.visibilityCondition };
      for (const ao of q.answerOptions || []) answerLookup[ao.id] = ao.text || ao.builtInType || '';
      if (q.type === 'multipleSelectQuestion') {
        for (const optQ of q.multipleSelectOptionQuestions || []) {
          questionLookup[optQ.id] = optQ.text || '';
          questionMeta[optQ.id] = { type: optQ.type || '', naEnabled: optQ.naEnabled, isCritical: optQ.isCritical, isKill: optQ.isKill, multiSelectParentId: q.id };
          for (const ao of optQ.answerOptions || []) answerLookup[ao.id] = ao.text || ao.builtInType || '';
        }
      }
    }
  }
  return { groupLookup, questionLookup, answerLookup, questionMeta };
}
function detectFormType(form, evaluation) {
  const direct = form?.formType || form?.evaluationFormType || form?.type || form?.category || form?.evaluationType || form?.agentEvaluationFormType;
  if (direct) return direct;
  return evaluation?.systemSubmitted === true ? 'Agent Auto-Evaluation' : 'Evaluation';
}
function finalAnswerSource(evaluation, q, finalAnswerId, aiAnswerId, automatedType) {
  if (q.systemMarkedNA === true) return 'System not asked';
  if (q.markedNA === true) return 'Manual N/A';
  if (evaluation.systemSubmitted === true && automatedType === 'AiScoring') return 'AI';
  if (evaluation.systemSubmitted !== true && aiAnswerId && aiAnswerId === finalAnswerId) return 'AI accepted by human';
  if (evaluation.systemSubmitted !== true && aiAnswerId && aiAnswerId !== finalAnswerId) return 'AI overridden by human';
  return 'Human';
}
async function evaluationToRows(evaluation, form, recordType) {
  const lookups = processForm(form || {});
  const agent = await getUser(evaluation.agent?.id);
  let evaluator = await getUser(evaluation.evaluator?.id);
  if (!evaluator && evaluation.systemSubmitted === true) evaluator = { id: '', name: 'Virtual Supervisor', email: '' };
  const formType = detectFormType(form, evaluation);
  const rows = [];
  for (const groupScore of evaluation.answers?.questionGroupScores || []) {
    const groupName = lookups.groupLookup[groupScore.questionGroupId] || '';
    for (const q of groupScore.questionScores || []) {
      let answerText = '', answerId = q.answerId || '', selectedCount = '', totalOptions = '';
      if (q.multipleSelectQuestionOptionScores?.length) {
        const selected = [], all = [];
        for (const opt of q.multipleSelectQuestionOptionScores) {
          const optLabel = lookups.questionLookup[opt.questionId] || opt.questionId;
          const builtIn = lookups.answerLookup[opt.answerId] || '';
          all.push(optLabel);
          if (builtIn.toLowerCase() === 'selected') selected.push(optLabel);
        }
        answerText = selected.join('; ');
        answerId = q.multipleSelectQuestionOptionScores.map((o) => o.answerId).join(';');
        selectedCount = selected.length;
        totalOptions = all.length;
      } else if (q.systemMarkedNA === true) {
        answerText = 'Not Asked - hidden by logic';
        answerId = 'system_not_asked';
      } else if (q.markedNA === true) {
        answerText = 'N/A';
        answerId = 'manual_na';
      } else {
        answerText = lookups.answerLookup[answerId] || '';
      }
      const aiAnswerId = q.aiAnswer?.answerId || '';
      const automatedType = q.automatedAnswer?.type || '';
      const meta = lookups.questionMeta[q.questionId] || {};
      rows.push({
        export_record_type: recordType,
        evaluation_id: evaluation.id,
        conversation_id: evaluation.conversation?.id || '',
        evaluation_context_id: evaluation.evaluationContextId || '',
        evaluation_form_id: evaluation.evaluationForm?.id || '',
        evaluation_form_name: evaluation.evaluationForm?.name || form?.name || '',
        evaluation_form_type: formType,
        status: evaluation.status || '',
        system_submitted: evaluation.systemSubmitted === true,
        agent_id: evaluation.agent?.id || '',
        agent_name: agent?.name || '',
        agent_email: agent?.email || '',
        agent_division_id: agent?.division?.id || evaluation.agent?.division?.id || '',
        agent_division_name: agent?.division?.name || evaluation.agent?.division?.name || '',
        evaluator_id: evaluation.evaluator?.id || '',
        evaluator_name: evaluator?.name || '',
        evaluator_email: evaluator?.email || '',
        queue_id: evaluation.queue?.id || '',
        agent_team_id: evaluation.agentTeam?.id || '',
        agent_team_name: evaluation.agentTeam?.name || '',
        conversation_date: evaluation.conversationDate || '',
        conversation_end_date: evaluation.conversationEndDate || '',
        assigned_date: evaluation.assignedDate || '',
        release_date: evaluation.releaseDate || '',
        submitted_date: evaluation.submittedDate || '',
        changed_date: evaluation.changedDate || '',
        total_score: evaluation.answers?.totalScore ?? '',
        total_critical_score: evaluation.answers?.totalCriticalScore ?? '',
        total_non_critical_score: evaluation.answers?.totalNonCriticalScore ?? '',
        any_failed_kill_questions: evaluation.answers?.anyFailedKillQuestions ?? false,
        evaluation_source_name: evaluation.evaluationSource?.name || '',
        evaluation_source_type: evaluation.evaluationSource?.type || '',
        calibration_id: evaluation.calibration?.id || '',
        question_group_id: groupScore.questionGroupId || '',
        question_group_name: groupName,
        question_group_score: groupScore.score ?? '',
        question_id: q.questionId || '',
        question_text: lookups.questionLookup[q.questionId] || '',
        question_type: meta.type || '',
        question_is_critical: meta.isCritical ?? '',
        question_is_kill: meta.isKill ?? '',
        question_has_visibility_condition: meta.hasVisibilityCondition || false,
        answer_id: answerId,
        answer_text: answerText,
        question_score: q.score ?? '',
        question_marked_na: q.markedNA ?? false,
        question_system_marked_na: q.systemMarkedNA ?? false,
        failed_kill_question: q.failedKillQuestion ?? false,
        automated_answer_type: automatedType,
        automated_answer_id: q.automatedAnswer?.answerId || '',
        ai_answer_id: aiAnswerId,
        ai_answer_text: aiAnswerId ? (lookups.answerLookup[aiAnswerId] || '') : '',
        ai_explanation: q.aiAnswer?.explanation || '',
        ai_marked_not_applicable: q.aiAnswer?.markedNotApplicable ?? '',
        ai_answer_matches_final: aiAnswerId ? String(aiAnswerId === (q.answerId || '')) : '',
        ai_answer_overridden: aiAnswerId ? String(aiAnswerId !== (q.answerId || '')) : '',
        eligible_for_ai_agreement: String(evaluation.systemSubmitted !== true && automatedType === 'AiScoring' && !!aiAnswerId),
        final_answer_source: finalAnswerSource(evaluation, q, q.answerId || '', aiAnswerId, automatedType),
        multi_select_selected_count: selectedCount,
        multi_select_total_options: totalOptions,
      });
    }
  }
  return rows;
}
function getEvaluationSummary(evaluation, rows) {
  const first = rows[0] || {};
  const failedCriticalQuestions = rows.filter((r) => r.failed_kill_question === true || (r.question_is_critical === true && n(r.question_score) === 0)).length;
  return {
    evaluation_id: evaluation.id,
    form_id: evaluation.evaluationForm?.id || '',
    form_name: evaluation.evaluationForm?.name || first.evaluation_form_name || '',
    agent_id: evaluation.agent?.id || '',
    agent_name: first.agent_name || evaluation.agent?.name || '',
    team_id: evaluation.agentTeam?.id || '',
    team_name: evaluation.agentTeam?.name || first.agent_team_name || '',
    division_id: first.agent_division_id || '',
    division_name: first.agent_division_name || '',
    submitted_date: evaluation.submittedDate || evaluation.releaseDate || evaluation.changedDate || evaluation.conversationDate || '',
    total_score: evaluation.answers?.totalScore ?? '',
    total_critical_score: evaluation.answers?.totalCriticalScore ?? '',
    ai_score: evaluation.systemSubmitted === true ? evaluation.answers?.totalScore ?? '' : '',
    system_submitted: evaluation.systemSubmitted === true,
    critical_failure: evaluation.answers?.anyFailedKillQuestions === true || (n(evaluation.answers?.totalCriticalScore) !== null && n(evaluation.answers?.totalCriticalScore) < 100),
    failed_critical_questions: failedCriticalQuestions,
  };
}
function passesClientFilters(evaluation, rows, cfg) {
  const first = rows[0] || {};
  if (cfg.teamIds?.length && !cfg.teamIds.includes(evaluation.agentTeam?.id || '')) return false;
  if (cfg.divisionIds?.length && !cfg.divisionIds.includes(first.agent_division_id || '')) return false;
  if (cfg.queueIds?.length && !cfg.queueIds.includes(evaluation.queue?.id || first.queue_id || '')) return false;
  return true;
}
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
async function fetchEvaluationDetail(conversationId, evaluationId) {
  const key = `${conversationId}:${evaluationId}`;
  const cached = state.cache.evaluations[key];
  if (cached && Date.now() - cached.cachedAt < DETAIL_CACHE_TTL_MS) return cached.data;
  const evaluation = await gcFetch('GET', `/api/v2/quality/conversations/${conversationId}/evaluations/${evaluationId}`);
  state.cache.evaluations[key] = { data: evaluation, cachedAt: Date.now() };
  return evaluation;
}

function buildQualitySearchRequest(recordType, cfg, pageNumber = 1, pageSize = 100) {
  const query = [
    { type: 'DATE_RANGE', field: 'submittedDate', startValue: `${cfg.startDate}T00:00:00.000Z`, endValue: `${cfg.endDate}T23:59:59.999Z`, operator: 'AND' },
  ];
  const addTerms = (field, values) => {
    if (values?.length) query.push({ type: 'TERMS', field, values, operator: 'AND' });
  };
  addTerms('formId', cfg.formIds);
  addTerms('agentId', cfg.agentIds);
  addTerms('queueId', cfg.queueIds);
  addTerms('divisionId', cfg.divisionIds);
  addTerms('teamId', cfg.teamIds);
  if (cfg.sourceFilter === 'human') query.push({ type: 'EXACT', field: 'systemSubmitted', value: false, operator: 'AND' });
  if (cfg.sourceFilter === 'auto') query.push({ type: 'EXACT', field: 'systemSubmitted', value: true, operator: 'AND' });
  query.push({ type: recordType === 'calibration' ? 'EXISTS' : 'NOT_EXISTS', field: 'calibrationId', operator: 'AND' });
  return {
    pageNumber,
    pageSize,
    query,
    sort: [{ field: 'submittedDate', order: 'desc' }],
    aggregations: [
      { name: 'avgTotalScore', field: 'totalScore', type: 'AVERAGE' },
      { name: 'avgCriticalScore', field: 'totalCriticalScore', type: 'AVERAGE' },
      { name: 'totalScoreStats', field: 'totalScore', type: 'STATS' },
      { name: 'byForm', field: 'formId', type: 'TERMS' },
      { name: 'byQuestionGroup', field: 'questionGroupId', type: 'TERMS' },
      { name: 'byQuestion', field: 'questionId', type: 'TERMS' },
      { name: 'byAnswer', field: 'answerId', type: 'TERMS' },
    ],
  };
}
function unwrapSearchEntities(data) {
  const roots = [data.results, data.entities, data.evaluations, data.items, data.documents, data.hits, data.searchResults].filter(Array.isArray);
  const items = roots[0] || [];
  return items.map((item) => item.document || item.entity || item.evaluation || item).filter(Boolean);
}
function normalizeSearchQuestionRow(item, summary) {
  const question = item.question || item.evaluationQuestion || {};
  const group = item.questionGroup || item.evaluationQuestionGroup || {};
  const answer = item.answer || item.selectedAnswer || {};
  const questionId = item.questionId || question.id || item.evaluationQuestionId || '';
  const groupId = item.questionGroupId || group.id || item.evaluationQuestionGroupId || '';
  if (!questionId && !groupId && !item.questionText && !item.questionGroupName) return null;
  return {
    evaluation_id: summary.evaluation_id,
    conversation_id: summary.conversation_id,
    evaluation_form_id: summary.form_id,
    evaluation_form_name: summary.form_name || summary.form_id || 'Unknown form',
    agent_id: summary.agent_id,
    agent_name: summary.agent_name,
    queue_id: summary.queue_id,
    queue_name: summary.queue_name,
    team_id: summary.team_id,
    team_name: summary.team_name,
    division_id: summary.division_id,
    division_name: summary.division_name,
    submitted_date: summary.submitted_date,
    question_group_id: groupId,
    question_group_name: item.questionGroupName || group.name || item.groupName || 'Unknown group',
    question_group_score: item.questionGroupScore ?? group.score ?? item.groupScore ?? '',
    question_id: questionId,
    question_text: item.questionText || question.text || question.name || '',
    question_score: item.questionScore ?? question.score ?? '',
    question_is_critical: item.questionIsCritical ?? question.isCritical ?? false,
    failed_kill_question: item.failedKillQuestion === true || item.anyFailedKillQuestions === true,
    answer_id: item.answerId || answer.id || '',
    answer_text: item.answerText || answer.text || answer.name || '',
    ai_answer_overridden: String(item.aiAnswerOverridden ?? item.aiAnswer?.overridden ?? ''),
    ai_answer_matches_final: String(item.aiAnswerMatchesFinal ?? item.aiAnswer?.matchesFinal ?? ''),
  };
}
function normalizeSearchEvaluation(item, recordType) {
  const form = item.evaluationForm || item.form || {};
  const agent = item.agent || item.agentUser || {};
  const queue = item.queue || {};
  const team = item.agentTeam || item.team || {};
  const division = item.division || agent.division || {};
  const answers = item.answers || item.scoring || {};
  const evaluationId = item.evaluationId || item.id;
  if (!evaluationId) return null;
  return {
    evaluation_id: evaluationId,
    export_record_type: recordType,
    conversation_id: item.conversationId || item.conversation?.id || '',
    form_id: item.formId || form.id || item.evaluationFormId || '',
    form_name: item.formName || form.name || '',
    agent_id: item.agentId || agent.id || '',
    agent_name: item.agentName || agent.name || '',
    queue_id: item.queueId || queue.id || '',
    queue_name: item.queueName || queue.name || '',
    team_id: item.teamId || team.id || '',
    team_name: item.teamName || team.name || '',
    division_id: item.divisionId || division.id || '',
    division_name: item.divisionName || division.name || '',
    submitted_date: item.submittedDate || item.releaseDate || item.changedDate || item.conversationDate || '',
    total_score: item.totalScore ?? answers.totalScore ?? '',
    total_critical_score: item.totalCriticalScore ?? answers.totalCriticalScore ?? '',
    ai_score: item.systemSubmitted === true ? (item.totalScore ?? answers.totalScore ?? '') : '',
    system_submitted: item.systemSubmitted === true,
    critical_failure: item.anyFailedKillQuestions === true || answers.anyFailedKillQuestions === true || (n(item.totalCriticalScore ?? answers.totalCriticalScore) !== null && n(item.totalCriticalScore ?? answers.totalCriticalScore) < 100),
    failed_critical_questions: item.failedCriticalQuestions ?? item.failedKillQuestions ?? 0,
  };
}
async function fetchQualitySearchSummaries(recordType) {
  const cfg = getConfigFromUi();
  const first = await gcFetch('POST', '/api/v2/quality/evaluations/search', buildQualitySearchRequest(recordType, cfg, 1, 100));
  const pageCount = Math.min(first.pageCount || Math.ceil((first.total || 0) / 100) || 1, 50);
  const entities = unwrapSearchEntities(first);
  for (let page = 2; page <= pageCount; page++) {
    const data = await gcFetch('POST', '/api/v2/quality/evaluations/search', buildQualitySearchRequest(recordType, cfg, page, 100));
    entities.push(...unwrapSearchEntities(data));
  }
  const summaries = entities.map((item) => normalizeSearchEvaluation(item, recordType)).filter(Boolean);
  const summaryById = new Map(summaries.map((summary) => [summary.evaluation_id, summary]));
  const searchRows = entities
    .map((item) => {
      const evaluationId = item.evaluationId || item.id;
      const summary = summaryById.get(evaluationId) || normalizeSearchEvaluation(item, recordType);
      return summary ? normalizeSearchQuestionRow(item, summary) : null;
    })
    .filter(Boolean);
  if (!summaries.length && !searchRows.length && !first.total && !first.aggregations) throw new Error('No dashboard records were returned for the selected filters.');
  state.aggregateSearchResults = first;
  return { rows: [], evals: [], summaries, searchRows, search: first };
}
async function fetchRecordTypeDashboard(recordType) {
  setStatus(`Refreshing ${recordType} dashboard metrics...`);
  return fetchQualitySearchSummaries(recordType);
}
async function fetchRecordType(recordType) {
  const cfg = getConfigFromUi();
  const query = buildAggregateQuery(cfg.startDate, cfg.endDate, recordType, cfg.sourceFilter, cfg);
  const agg = await gcFetch('POST', '/api/v2/analytics/evaluations/aggregates/query', query);
  const seen = new Set();
  const groups = (agg.results || []).map((r) => r.group || {}).filter((g) => {
    if (!g.conversationId || !g.evaluationId || seen.has(g.evaluationId)) return false;
    seen.add(g.evaluationId);
    return true;
  });
  const rows = [], evals = [], summaries = [];
  await mapWithConcurrency(groups, 6, async (group, i) => {
    setStatus(`Fetching ${recordType} details ${i + 1} of ${groups.length}...`);
    const evaluation = await fetchEvaluationDetail(group.conversationId, group.evaluationId);
    if (cfg.sourceFilter === 'human' && evaluation.systemSubmitted === true) return;
    if (cfg.sourceFilter === 'auto' && evaluation.systemSubmitted !== true) return;
    const formId = evaluation.evaluationForm?.id;
    const form = formId ? await getPublishedForm(formId) : null;
    const questionRows = await evaluationToRows(evaluation, form, recordType);
    if (!passesClientFilters(evaluation, questionRows, cfg)) return;
    rows.push(...questionRows);
    evals.push(evaluation);
    summaries.push(getEvaluationSummary(evaluation, questionRows));
  });
  saveCache();
  return { rows, evals, summaries };
}
function debouncedRun() {
  if (!state.token?.access_token) return;
  clearTimeout(state.runTimer);
  state.runTimer = setTimeout(() => runDashboard(), 700);
}
async function runDashboard() {
  const cfg = getConfigFromUi();
  if (!state.token?.access_token) { alert('Sign in first.'); return; }
  if (!cfg.startDate || !cfg.endDate) { alert('Select a date range.'); return; }
  saveConfig();
  setBusy(true);
  try {
    if (!state.metadataLoaded) await refreshMetadata(false);
    state.rows = [];
    state.evaluations = [];
    state.evaluationSummaries = [];
    state.searchRows = [];
    state.detailLoaded = false;
    const types = cfg.recordFilter === 'both' ? ['evaluation', 'calibration'] : [cfg.recordFilter];
    for (const t of types) {
      const result = await fetchRecordTypeDashboard(t);
      state.rows.push(...result.rows);
      state.evaluations.push(...result.evals);
      state.evaluationSummaries.push(...result.summaries);
      state.searchRows.push(...(result.searchRows || []));
      if (result.rows.length) state.detailLoaded = true;
    }
    render();
    const detailText = state.detailLoaded ? `${state.rows.length} question rows loaded.` : `${state.searchRows.length} search-level question/group rows available; full detail loads on download.`;
    setStatus(`Dashboard refreshed. ${uniqueEvalSummaries().length} unique evaluations loaded. ${detailText}`);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
    alert(err.message);
  } finally {
    setBusy(false);
  }
}
async function ensureDetailRowsLoaded() {
  if (state.detailLoaded && state.rows.length) return;
  const cfg = getConfigFromUi();
  if (!state.token?.access_token) { alert('Sign in first.'); return; }
  if (!cfg.startDate || !cfg.endDate) { alert('Select a date range.'); return; }
  setBusy(true);
  try {
    state.rows = [];
    state.evaluations = [];
    state.evaluationSummaries = [];
    state.searchRows = [];
    const types = cfg.recordFilter === 'both' ? ['evaluation', 'calibration'] : [cfg.recordFilter];
    for (const t of types) {
      setStatus(`Loading ${t} question-level detail for export...`);
      const result = await fetchRecordType(t);
      state.rows.push(...result.rows);
      state.evaluations.push(...result.evals);
      state.evaluationSummaries.push(...result.summaries);
      state.searchRows.push(...(result.searchRows || []));
    }
    state.detailLoaded = true;
    render();
    setStatus(`Detail loaded. ${state.evaluationSummaries.length} evaluations and ${state.rows.length} question rows are ready for export.`);
  } finally {
    setBusy(false);
  }
}
function uniqueEvalSummaries() {
  return [...new Map(state.evaluationSummaries.map((e) => [e.evaluation_id, e])).values()];
}
function chartReady() { return typeof Chart !== 'undefined'; }
function destroyChart(id) {
  if (state.charts[id]) {
    state.charts[id].destroy();
    delete state.charts[id];
  }
}
function renderEmptyChart(id, message) {
  destroyChart(id);
  const canvas = $(id);
  if (!canvas) return;
  const shell = canvas.parentElement;
  shell.querySelectorAll('.chart-empty').forEach((x) => x.remove());
  canvas.classList.add('hidden');
  const empty = document.createElement('div');
  empty.className = 'chart-empty';
  empty.textContent = message;
  shell.appendChild(empty);
}
function renderChart(id, config) {
  if (!chartReady()) { renderEmptyChart(id, 'Chart library is still loading. Refresh again in a moment.'); return; }
  const canvas = $(id);
  const shell = canvas.parentElement;
  shell.querySelectorAll('.chart-empty').forEach((x) => x.remove());
  canvas.classList.remove('hidden');
  destroyChart(id);
  state.charts[id] = new Chart(canvas, config);
}
function scoreClass(value) {
  const num = n(value);
  if (num === null) return '';
  if (num >= 90) return 'score-good';
  if (num >= 75) return 'score-warn';
  return 'score-bad';
}
function scoreBadge(value) {
  const text = htmlEscape(value);
  const cls = scoreClass(value);
  return cls ? `<span class="score-badge ${cls}">${text}</span>` : text;
}
function render() {
  const evals = uniqueEvalSummaries();
  $('metricEvals').textContent = evals.length;
  $('metricEvalsSub').textContent = state.detailLoaded ? `${state.rows.length} question rows loaded` : 'Fast aggregate view';
  $('metricAvg').textContent = fmt(avg(evals.map((e) => e.total_score)), 1);
  $('metricCriticalAvg').textContent = fmt(avg(evals.map((e) => e.total_critical_score)), 1);
  $('metricAiAvg').textContent = fmt(avg(evals.filter((e) => e.system_submitted).map((e) => e.ai_score)), 1);
  $('metricCritical').textContent = evals.filter((e) => e.critical_failure).length;
  $('metricQuestionFailures').textContent = state.rows.filter((r) => r.failed_kill_question === true || (r.question_is_critical === true && n(r.question_score) === 0)).length;
  const trendRows = renderTrend(evals);
  const formRows = renderFormSummary(evals);
  const groupRows = renderGroupSummary();
  const questionRows = renderQuestionSummary();
  renderAgentTeamSummary(evals);
  const answerRows = renderAnswerSummary();
  renderCriticalTrendChart(trendRows);
  renderFormChart(formRows);
  renderGroupChart(groupRows);
  renderQuestionChart(questionRows);
  renderAnswerChart(answerRows);
  renderAiChart(evals);
}
function renderTrend(evals) {
  const map = new Map();
  for (const e of evals) {
    const key = dateKey(e.submitted_date) || 'Unknown';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(e);
  }
  const rows = [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({
    date,
    evaluations: items.length,
    avg_total_score: fmt(avg(items.map((e) => e.total_score)), 1),
    avg_critical_score: fmt(avg(items.map((e) => e.total_critical_score)), 1),
    critical_failure_evals: items.filter((e) => e.critical_failure).length,
    failed_critical_questions: items.reduce((total, e) => total + (n(e.failed_critical_questions) || 0), 0),
  }));
  renderTrendChart(rows);
  $('trendTable').innerHTML = makeTable(rows);
  return rows;
}
function renderTrendChart(rows) {
  if (!rows.length) { renderEmptyChart('trendScoreChart', 'No evaluations match the selected filters.'); return; }
  renderChart('trendScoreChart', {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.date),
      datasets: [
        { type: 'bar', label: 'Evaluations', data: rows.map((r) => r.evaluations), backgroundColor: 'rgba(99, 102, 241, .32)', borderColor: '#6366f1', borderWidth: 1, yAxisID: 'y' },
        { type: 'line', label: 'Avg score', data: rows.map((r) => n(r.avg_total_score)), borderColor: '#10b981', backgroundColor: '#10b981', tension: .35, yAxisID: 'score' },
        { type: 'line', label: 'Avg critical score', data: rows.map((r) => n(r.avg_critical_score)), borderColor: '#f97316', backgroundColor: '#f97316', tension: .35, yAxisID: 'score' },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, title: { display: true, text: 'Evaluations' } }, score: { beginAtZero: true, max: 100, position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Score %' } } } },
  });
}
function renderCriticalTrendChart(rows) {
  if (!rows.length) { renderEmptyChart('criticalTrendChart', 'Critical trend appears after the dashboard refreshes.'); return; }
  renderChart('criticalTrendChart', {
    type: 'bar',
    data: { labels: rows.map((r) => r.date), datasets: [
      { label: 'Critical failure evals', data: rows.map((r) => r.critical_failure_evals), backgroundColor: 'rgba(249, 115, 22, .72)' },
      { label: 'Failed critical questions', data: rows.map((r) => r.failed_critical_questions), backgroundColor: 'rgba(239, 68, 68, .62)' },
    ] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });
}
function renderFormSummary(evals) {
  const map = groupBy(evals, (e) => `${e.form_id}||${e.form_name || e.form_id || 'Unknown form'}`);
  const rows = [...map.entries()].map(([key, items]) => {
    const [, form] = key.split('||');
    return {
      form,
      evaluations: items.length,
      avg_total_score: fmt(avg(items.map((e) => e.total_score)), 1),
      avg_critical_score: fmt(avg(items.map((e) => e.total_critical_score)), 1),
      ai_eval_avg_score: fmt(avg(items.filter((e) => e.system_submitted).map((e) => e.ai_score)), 1),
      critical_failure_evals: items.filter((e) => e.critical_failure).length,
    };
  }).sort((a, b) => Number(b.evaluations) - Number(a.evaluations));
  $('formSummary').innerHTML = makeTable(rows);
  return rows;
}
function renderFormChart(rows) {
  const top = rows.slice(0, 10).sort((a, b) => Number(a.avg_total_score) - Number(b.avg_total_score));
  if (!top.length) { renderEmptyChart('formPerformanceChart', 'No form performance data yet.'); return; }
  renderChart('formPerformanceChart', {
    type: 'bar',
    data: { labels: top.map((r) => r.form), datasets: [
      { label: 'Avg score', data: top.map((r) => n(r.avg_total_score)), backgroundColor: 'rgba(20, 184, 166, .72)' },
      { label: 'Avg critical score', data: top.map((r) => n(r.avg_critical_score)), backgroundColor: 'rgba(249, 115, 22, .68)' },
    ] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, max: 100 } } },
  });
}
function renderGroupSummary() {
  const sourceRows = state.detailLoaded && state.rows.length ? state.rows : state.searchRows;
  const groupRows = [...new Map(sourceRows.map((r) => [`${r.evaluation_id}||${r.question_group_id}`, r])).values()];
  const map = groupBy(groupRows, (r) => `${r.evaluation_form_name}||${r.question_group_name || 'Unknown group'}`);
  const rows = [...map.entries()].map(([key, items]) => {
    const [form, group] = key.split('||');
    return { form, group, evaluations: items.length, avg_group_score: fmt(avg(items.map((r) => r.question_group_score)), 1) };
  }).sort((a, b) => Number(a.avg_group_score) - Number(b.avg_group_score));
  $('groupSummary').innerHTML = rows.length ? makeTable(rows) : '<p class="note">No question group scores returned for the selected filters.</p>';
  return rows;
}
function renderGroupChart(rows) {
  const top = rows.slice(0, 10);
  if (!top.length) { renderEmptyChart('groupPerformanceChart', 'Load detail data to see group score hotspots.'); return; }
  renderChart('groupPerformanceChart', {
    type: 'bar',
    data: { labels: top.map((r) => r.group), datasets: [{ label: 'Avg group score', data: top.map((r) => n(r.avg_group_score)), backgroundColor: 'rgba(139, 92, 246, .72)' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 }, x: { ticks: { maxRotation: 35, minRotation: 0 } } } },
  });
}
function renderQuestionSummary() {
  const sourceRows = state.detailLoaded && state.rows.length ? state.rows : state.searchRows;
  const map = groupBy(sourceRows.filter((r) => r.question_id || r.question_text), (r) => `${r.evaluation_form_name}||${r.question_group_name}||${r.question_id}||${r.question_text}`);
  const rows = [...map.entries()].map(([key, items]) => {
    const [form, group, , question] = key.split('||');
    return {
      form,
      group,
      question,
      answered_rows: items.length,
      avg_question_score: fmt(avg(items.map((r) => r.question_score)), 1),
      manual_na: items.filter((r) => r.question_marked_na === true).length,
      system_hidden: items.filter((r) => r.question_system_marked_na === true).length,
      failed_critical_questions: items.filter((r) => r.failed_kill_question === true || (r.question_is_critical === true && n(r.question_score) === 0)).length,
      ai_overrides: items.filter((r) => r.ai_answer_overridden === 'true').length,
    };
  }).sort((a, b) => Number(a.avg_question_score) - Number(b.avg_question_score)).slice(0, 100);
  $('questionSummary').innerHTML = rows.length ? makeTable(rows) : '<p class="note">No question scores returned for the selected filters.</p>';
  return rows;
}
function renderQuestionChart(rows) {
  const top = rows.slice(0, 10).reverse();
  if (!top.length) { renderEmptyChart('questionPerformanceChart', 'Load detail data to see underperforming questions.'); return; }
  renderChart('questionPerformanceChart', {
    type: 'bar',
    data: { labels: top.map((r) => r.question.slice(0, 80)), datasets: [{ label: 'Avg question score', data: top.map((r) => n(r.avg_question_score)), backgroundColor: 'rgba(239, 68, 68, .66)' }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { beginAtZero: true, max: 100 } } },
  });
}
function renderAgentTeamSummary(evals) {
  const map = groupBy(evals, (e) => `${e.team_name || 'No team'}||${e.agent_name || e.agent_id || 'Unknown agent'}`);
  const rows = [...map.entries()].map(([key, items]) => {
    const [team, agent] = key.split('||');
    return {
      team,
      agent,
      evaluations: items.length,
      avg_total_score: fmt(avg(items.map((e) => e.total_score)), 1),
      avg_critical_score: fmt(avg(items.map((e) => e.total_critical_score)), 1),
      critical_failure_evals: items.filter((e) => e.critical_failure).length,
    };
  }).sort((a, b) => Number(a.avg_total_score) - Number(b.avg_total_score));
  $('agentTeamSummary').innerHTML = makeTable(rows);
}
function renderAnswerSummary() {
  const sourceRows = state.detailLoaded && state.rows.length ? state.rows : state.searchRows;
  const answerable = sourceRows.filter((r) => r.question_text && r.answer_text);
  const map = groupBy(answerable, (r) => `${r.evaluation_form_name}||${r.question_text}||${r.answer_text}`);
  const rows = [...map.entries()].map(([key, items]) => {
    const [form, question, answer] = key.split('||');
    return { form, question, answer, count: items.length, avg_question_score: fmt(avg(items.map((r) => r.question_score)), 1) };
  }).sort((a, b) => Number(b.count) - Number(a.count)).slice(0, 150);
  $('answerSummary').innerHTML = rows.length ? makeTable(rows) : '<p class="note">No answer distribution returned for the selected filters.</p>';
  return rows;
}
function renderAnswerChart(rows) {
  const top = rows.slice(0, 12);
  if (!top.length) { renderEmptyChart('answerDistributionChart', 'Load detail data to see answer distribution.'); return; }
  renderChart('answerDistributionChart', {
    type: 'bar',
    data: { labels: top.map((r) => `${r.answer}`.slice(0, 50)), datasets: [{ label: 'Answer count', data: top.map((r) => r.count), backgroundColor: 'rgba(59, 130, 246, .68)' }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true } } },
  });
}
function renderAiChart(evals) {
  const automated = evals.filter((e) => e.system_submitted).length;
  const human = Math.max(0, evals.length - automated);
  const aiRows = state.detailLoaded && state.rows.length ? state.rows : state.searchRows;
  const overrides = aiRows.filter((r) => r.ai_answer_overridden === 'true').length;
  const accepted = aiRows.filter((r) => r.ai_answer_matches_final === 'true').length;
  const labels = (accepted || overrides) ? ['AI accepted', 'AI overridden'] : ['Human submitted', 'System submitted'];
  const values = (accepted || overrides) ? [accepted, overrides] : [human, automated];
  if (!evals.length && !values.some(Boolean)) { renderEmptyChart('aiScoringChart', 'AI and human evaluation mix appears after refresh.'); return; }
  renderChart('aiScoringChart', {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: ['#06b6d4', '#8b5cf6', '#f97316'] }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } },
  });
}
function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}
function makeTable(rows) {
  if (!rows.length) return '<p class="note">No data.</p>';
  const cols = Object.keys(rows[0]);
  const cell = (col, value) => /score|avg/i.test(col) ? scoreBadge(value) : htmlEscape(value);
  return `<table><thead><tr>${cols.map((c) => `<th>${htmlEscape(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${cell(c, r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function countSelectedLabel(id, singular, plural = `${singular}s`) {
  const values = selectedValues(id);
  if (!values.length) return null;
  return `${values.length} ${values.length === 1 ? singular : plural}`;
}
function updateActiveFilterChips() {
  const chipHost = $('activeFilterChips');
  if (!chipHost) return;
  const cfg = getConfigFromUi();
  const sourceLabel = $('sourceFilter').selectedOptions[0]?.textContent || 'All sources';
  const recordLabel = $('recordFilter').selectedOptions[0]?.textContent || 'Evaluations';
  const chips = [
    `${cfg.startDate || 'Any start'} → ${cfg.endDate || 'Any end'}`,
    sourceLabel,
    recordLabel,
    countSelectedLabel('formFilter', 'form'),
    countSelectedLabel('agentFilter', 'agent'),
    countSelectedLabel('queueFilter', 'queue'),
    countSelectedLabel('divisionFilter', 'division'),
    countSelectedLabel('teamFilter', 'team'),
  ].filter(Boolean);
  chipHost.innerHTML = chips.map((chip) => `<span class="chip">${htmlEscape(chip)}</span>`).join('');
}

function setDatePreset(preset) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const startOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const endOfMonth = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  let start = new Date(now), end = new Date(now);
  if (preset === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); }
  if (preset === '7d') start.setDate(start.getDate() - 6);
  if (preset === '30d') start.setDate(start.getDate() - 29);
  if (preset === 'thisMonth') { start = startOfMonth(now); end = now; }
  if (preset === 'lastMonth') { const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)); start = startOfMonth(last); end = endOfMonth(last); }
  $('startDate').value = iso(start);
  $('endDate').value = iso(end);
  updateActiveFilterChips();
  debouncedRun();
}
function wireDatePresets() {
  document.querySelectorAll('[data-preset]').forEach((button) => button.addEventListener('click', () => setDatePreset(button.dataset.preset)));
}

function setFilterDrawerOpen(open) {
  const drawer = $('filterDrawer');
  const backdrop = $('drawerBackdrop');
  const button = $('filterDrawerBtn');
  drawer.classList.toggle('open', open);
  document.body.classList.toggle('filters-open', open);
  drawer.setAttribute('aria-hidden', String(!open));
  backdrop.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
}
function wireDrawerControls() {
  $('filterDrawerBtn').addEventListener('click', () => setFilterDrawerOpen(true));
  $('closeFilterDrawerBtn').addEventListener('click', () => setFilterDrawerOpen(false));
  $('drawerBackdrop').addEventListener('click', () => setFilterDrawerOpen(false));
  $('resetFiltersBtn').addEventListener('click', resetFilters);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setFilterDrawerOpen(false);
  });
}

async function exportCsv() {
  if (!state.rows.length) await ensureDetailRowsLoaded();
  if (!state.rows.length) { alert('No question-level detail is available for the selected filters.'); return; }
  const cols = Object.keys(state.rows[0]);
  const csv = [cols.join(',')].concat(state.rows.map((r) => cols.map((c) => {
    const v = String(r[c] ?? '');
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(','))).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const cfg = getConfigFromUi();
  a.href = url;
  a.download = `qm_question_level_${cfg.startDate}_to_${cfg.endDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
async function init() {
  hydrateUi();
  $('loginBtn').addEventListener('click', startLogin);
  $('continueLoginBtn').addEventListener('click', continueLogin);
  $('logoutBtn').addEventListener('click', logout);
  $('exportBtn').addEventListener('click', exportCsv);
  wireDrawerControls();
  wireDatePresets();
  document.addEventListener('click', closeMultiFiltersOnOutsideClick);
  ['startDate','endDate','sourceFilter','recordFilter'].forEach((id) => $(id).addEventListener('change', debouncedRun));
  ['startDate','endDate','sourceFilter','recordFilter'].forEach((id) => $(id).addEventListener('change', updateActiveFilterChips));
  try { await handleAuthCallback(); } catch (e) { console.error(e); alert(e.message); }
  loadToken();
  if (state.token?.access_token) refreshMetadata(false).catch((e) => console.warn(e));
  updateActiveFilterChips();
  render();
  setStatus(`Ready. App version ${APP_VERSION}.`);
}
init();
