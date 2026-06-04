// Genesys QM Insights - Authorization Code + PKCE, browser-only dashboard.
// Replace the clientId values below with PKCE OAuth clients created in the matching Genesys Cloud region.

const APP_VERSION = '0.2.0';
const CONFIG_KEY = 'qmInsights.config.v2';
const CACHE_KEY = 'qmInsights.cache.v2';
const TOKEN_KEY = 'qmInsights.token.v2';
const PKCE_KEY = 'qmInsights.pkce.v2';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DETAIL_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_REGION = 'usw2.pure.cloud';
const OAUTH_CLIENTS = {
  'usw2.pure.cloud': {
    clientId: 'REPLACE_WITH_USW2_AUTH_CODE_PKCE_CLIENT_ID',
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
  cache: loadCache(),
  runTimer: null,
  metadataLoaded: false,
};

const $ = (id) => document.getElementById(id);
const selectedValues = (id) => Array.from($(id).selectedOptions || []).map((o) => o.value).filter(Boolean);

function setStatus(message) { $('status').textContent = message; }
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
      evaluations: cache.evaluations || {},
      savedAt: cache.savedAt || Date.now(),
    };
  } catch {
    return { users: {}, forms: {}, divisions: {}, teams: {}, evaluations: {}, savedAt: Date.now() };
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
  clearSelect('agentFilter', 'Sign in, then refresh filter lists');
  clearSelect('formFilter', 'Forms will populate after refresh or first dashboard run');
  clearSelect('divisionFilter', 'Sign in, then refresh filter lists');
  clearSelect('teamFilter', 'Sign in, then refresh filter lists');
  setStatus('Browser cache cleared. Click Refresh filter lists or Run dashboard to retrieve fresh users, forms, divisions, and teams.');
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
    autoRefresh: $('autoRefresh').checked,
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
  $('autoRefresh').checked = cfg.autoRefresh !== false;
  clearSelect('agentFilter', 'Sign in, then refresh filter lists');
  clearSelect('formFilter', 'Forms will populate after refresh or first dashboard run');
  clearSelect('divisionFilter', 'Sign in, then refresh filter lists');
  clearSelect('teamFilter', 'Sign in, then refresh filter lists');
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
async function startLogin() {
  toggleRegionPopover(true);
}
async function continueLogin() {
  const cfg = getConfigFromUi();
  const region = $('loginRegion').value;
  const oauth = oauthForRegion(region);
  cfg.region = region;
  state.region = region;
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const oauthState = randomString(16);
  const redirectUri = oauth.redirectUri || `${window.location.origin}${window.location.pathname}`;
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ codeVerifier, oauthState, cfg, clientId: oauth.clientId, redirectUri }));
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
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return;
  const saved = JSON.parse(sessionStorage.getItem(PKCE_KEY) || '{}');
  if (!saved.codeVerifier || params.get('state') !== saved.oauthState) {
    throw new Error('OAuth state validation failed. Try signing in again.');
  }
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
  sessionStorage.removeItem(PKCE_KEY);
  state.region = saved.cfg.region;
  $('loginRegion').value = state.region;
  window.history.replaceState({}, document.title, saved.redirectUri);
  state.token = token;
  updateAuthUi();
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
  state.token = null;
  state.rows = [];
  state.evaluations = [];
  updateAuthUi();
}
function updateAuthUi() {
  if (state.token?.access_token) {
    $('authStatus').textContent = `Signed in - ${state.region}`;
    $('authStatus').className = 'pill ok';
  } else {
    $('authStatus').textContent = 'Not signed in';
    $('authStatus').className = 'pill warn';
  }
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
function setOptions(id, items, selected = []) {
  const selectedSet = new Set(selected);
  $(id).innerHTML = items.map((x) => `<option value="${htmlEscape(x.id)}"${selectedSet.has(x.id) ? ' selected' : ''}>${htmlEscape(x.name || x.email || x.id)}</option>`).join('');
}
function clearSelect(id, placeholder) {
  $(id).innerHTML = `<option value="" disabled>${htmlEscape(placeholder)}</option>`;
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
      const forms = await fetchAllPages('/api/v2/quality/publishedforms/evaluations', 'entities', 100);
      state.cache.formList = forms.map((f) => ({ id: f.id, name: f.name || f.context?.name || f.id }));
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
  const fromDetails = Object.values(state.cache.forms || {}).map((x) => x.data).filter(Boolean).map((f) => ({ id: f.id, name: f.name || f.context?.name || f.id }));
  const forms = [...(state.cache.formList || []), ...fromDetails];
  const uniqueForms = [...new Map(forms.map((f) => [f.id, f])).values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
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
  if (!$('autoRefresh').checked || !state.token?.access_token) return;
  clearTimeout(state.runTimer);
  state.runTimer = setTimeout(() => runDashboard(), 700);
}
async function runDashboard() {
  const cfg = getConfigFromUi();
  if (!state.token?.access_token) { alert('Sign in first.'); return; }
  if (!cfg.startDate || !cfg.endDate) { alert('Select a date range.'); return; }
  saveConfig();
  $('runBtn').disabled = true;
  try {
    if (!state.metadataLoaded) await refreshMetadata(false);
    state.rows = [];
    state.evaluations = [];
    state.evaluationSummaries = [];
    const types = cfg.recordFilter === 'both' ? ['evaluation', 'calibration'] : [cfg.recordFilter];
    for (const t of types) {
      setStatus(`Running ${t} query...`);
      const result = await fetchRecordType(t);
      state.rows.push(...result.rows);
      state.evaluations.push(...result.evals);
      state.evaluationSummaries.push(...result.summaries);
    }
    render();
    setStatus(`Done. ${state.evaluationSummaries.length} evaluations and ${state.rows.length} question rows loaded. Raw rows are kept in browser memory/local export only.`);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
    alert(err.message);
  } finally {
    $('runBtn').disabled = false;
  }
}
function uniqueEvalSummaries() {
  return [...new Map(state.evaluationSummaries.map((e) => [e.evaluation_id, e])).values()];
}
function render() {
  const evals = uniqueEvalSummaries();
  $('metricEvals').textContent = evals.length;
  $('metricAvg').textContent = fmt(avg(evals.map((e) => e.total_score)), 1);
  $('metricCriticalAvg').textContent = fmt(avg(evals.map((e) => e.total_critical_score)), 1);
  $('metricAiAvg').textContent = fmt(avg(evals.filter((e) => e.system_submitted).map((e) => e.ai_score)), 1);
  $('metricCritical').textContent = evals.filter((e) => e.critical_failure).length;
  $('metricQuestionFailures').textContent = state.rows.filter((r) => r.failed_kill_question === true || (r.question_is_critical === true && n(r.question_score) === 0)).length;
  renderTrend(evals);
  renderFormSummary(evals);
  renderGroupSummary();
  renderQuestionSummary();
  renderAgentTeamSummary(evals);
  renderAnswerSummary();
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
  }));
  $('trendTable').innerHTML = makeTable(rows);
}
function renderFormSummary(evals) {
  const map = groupBy(evals, (e) => `${e.form_id}||${e.form_name}`);
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
}
function renderGroupSummary() {
  const groupRows = [...new Map(state.rows.map((r) => [`${r.evaluation_id}||${r.question_group_id}`, r])).values()];
  const map = groupBy(groupRows, (r) => `${r.evaluation_form_name}||${r.question_group_name}`);
  const rows = [...map.entries()].map(([key, items]) => {
    const [form, group] = key.split('||');
    return { form, group, evaluations: items.length, avg_group_score: fmt(avg(items.map((r) => r.question_group_score)), 1) };
  }).sort((a, b) => Number(a.avg_group_score) - Number(b.avg_group_score));
  $('groupSummary').innerHTML = makeTable(rows);
}
function renderQuestionSummary() {
  const map = groupBy(state.rows, (r) => `${r.evaluation_form_name}||${r.question_group_name}||${r.question_id}||${r.question_text}`);
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
  $('questionSummary').innerHTML = makeTable(rows);
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
  const answerable = state.rows.filter((r) => r.question_text && r.answer_text);
  const map = groupBy(answerable, (r) => `${r.evaluation_form_name}||${r.question_text}||${r.answer_text}`);
  const rows = [...map.entries()].map(([key, items]) => {
    const [form, question, answer] = key.split('||');
    return { form, question, answer, count: items.length, avg_question_score: fmt(avg(items.map((r) => r.question_score)), 1) };
  }).sort((a, b) => Number(b.count) - Number(a.count)).slice(0, 150);
  $('answerSummary').innerHTML = makeTable(rows);
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
  return `<table><thead><tr>${cols.map((c) => `<th>${htmlEscape(c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${htmlEscape(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}
function exportCsv() {
  if (!state.rows.length) { alert('Run the dashboard first.'); return; }
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
  $('runBtn').addEventListener('click', runDashboard);
  $('exportBtn').addEventListener('click', exportCsv);
  $('refreshMetadataBtn').addEventListener('click', () => refreshMetadata(true));
  $('clearCacheBtn').addEventListener('click', clearCache);
  ['startDate','endDate','sourceFilter','recordFilter','formFilter','agentFilter','divisionFilter','teamFilter','autoRefresh'].forEach((id) => $(id).addEventListener('change', debouncedRun));
  try { await handleAuthCallback(); } catch (e) { console.error(e); alert(e.message); }
  loadToken();
  if (state.token?.access_token) refreshMetadata(false).catch((e) => console.warn(e));
  setStatus(`Ready. App version ${APP_VERSION}.`);
}
init();
