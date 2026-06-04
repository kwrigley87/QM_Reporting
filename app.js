// Genesys QM Insights - browser-only phase 1/2 starter
// Uses Authorization Code + PKCE. No backend and no raw data storage beyond in-memory rows.
// Browser storage caches configuration plus user/form metadata for performance.

const APP_VERSION = '0.1.0';
const CONFIG_KEY = 'qmInsights.config.v1';
const CACHE_KEY = 'qmInsights.cache.v1';
const TOKEN_KEY = 'qmInsights.token.v1';
const PKCE_KEY = 'qmInsights.pkce.v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

let state = {
  token: null,
  rows: [],
  evaluations: [],
  cache: loadCache(),
};

const $ = (id) => document.getElementById(id);

function setStatus(message) { $('status').textContent = message; }
function today(offsetDays = 0) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (s) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
}
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}'); } catch { return {}; }
}
function saveConfig() {
  const cfg = getConfigFromUi();
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  setStatus('Configuration saved in this browser.');
}
function loadCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return { users: cache.users || {}, forms: cache.forms || {}, savedAt: cache.savedAt || Date.now() };
  } catch { return { users: {}, forms: {}, savedAt: Date.now() }; }
}
function saveCache() {
  state.cache.savedAt = Date.now();
  localStorage.setItem(CACHE_KEY, JSON.stringify(state.cache));
}
function clearCache() {
  localStorage.removeItem(CACHE_KEY);
  state.cache = loadCache();
  setStatus('Browser metadata cache cleared.');
}
function getConfigFromUi() {
  return {
    region: $('region').value,
    clientId: $('clientId').value.trim(),
    startDate: $('startDate').value,
    endDate: $('endDate').value,
    sourceFilter: $('sourceFilter').value,
    recordFilter: $('recordFilter').value,
  };
}
function hydrateUi() {
  const cfg = loadConfig();
  $('region').value = cfg.region || 'mypurecloud.com';
  $('clientId').value = cfg.clientId || '';
  $('startDate').value = cfg.startDate || today(-7);
  $('endDate').value = cfg.endDate || today(0);
  $('sourceFilter').value = cfg.sourceFilter || 'both';
  $('recordFilter').value = cfg.recordFilter || 'evaluation';
}
function apiHost(region) { return `api.${region}`; }
function loginHost(region) { return `login.${region}`; }

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
async function startLogin() {
  const cfg = getConfigFromUi();
  if (!cfg.clientId) { alert('Enter OAuth Client ID first.'); return; }
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
  const codeVerifier = randomString(64);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const oauthState = randomString(16);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ codeVerifier, oauthState, cfg }));
  const redirectUri = window.location.origin + window.location.pathname;
  const authUrl = new URL(`https://${loginHost(cfg.region)}/oauth/authorize`);
  authUrl.searchParams.set('client_id', cfg.clientId);
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
  const redirectUri = window.location.origin + window.location.pathname;
  const body = new URLSearchParams();
  body.set('grant_type', 'authorization_code');
  body.set('client_id', saved.cfg.clientId);
  body.set('code', code);
  body.set('redirect_uri', redirectUri);
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
  window.history.replaceState({}, document.title, redirectUri);
  state.token = token;
  updateAuthUi();
}
function loadToken() {
  try {
    const saved = JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}');
    if (saved.token && saved.token.expires_at > Date.now()) {
      state.token = saved.token;
      if (saved.region) $('region').value = saved.region;
    }
  } catch {}
  updateAuthUi();
}
function logout() {
  localStorage.removeItem(TOKEN_KEY);
  state.token = null;
  updateAuthUi();
}
function updateAuthUi() {
  if (state.token?.access_token) {
    $('authStatus').textContent = 'Signed in';
    $('authStatus').className = 'pill ok';
  } else {
    $('authStatus').textContent = 'Not signed in';
    $('authStatus').className = 'pill warn';
  }
}
async function gcFetch(method, path, payload = null, retries = 4) {
  if (!state.token?.access_token) throw new Error('Not signed in.');
  const cfg = getConfigFromUi();
  const url = `https://${apiHost(cfg.region)}${path}`;
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${state.token.access_token}`,
        'Content-Type': 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
    if (res.ok) {
      const text = await res.text();
      return text ? JSON.parse(text) : {};
    }
    if (![408, 409, 429, 500, 502, 503, 504].includes(res.status) || i === retries) {
      throw new Error(`${method} ${path} failed: ${res.status} ${await res.text()}`);
    }
    const retryAfter = Number(res.headers.get('Retry-After') || 0);
    const waitMs = retryAfter ? retryAfter * 1000 : Math.min(30000, 1000 * Math.pow(2, i));
    await new Promise((r) => setTimeout(r, waitMs));
  }
}
function buildAggregateQuery(startDate, endDate, recordType, sourceFilter) {
  const calibrationOperator = recordType === 'calibration' ? 'exists' : 'notExists';
  const clauses = [{ type: 'or', predicates: [{ dimension: 'calibrationId', operator: calibrationOperator }] }];
  if (sourceFilter === 'human') clauses.push({ type: 'or', predicates: [{ dimension: 'systemSubmitted', value: 'false' }] });
  if (sourceFilter === 'auto') clauses.push({ type: 'or', predicates: [{ dimension: 'systemSubmitted', value: 'true' }] });
  return {
    interval: `${startDate}T00:00:00.000Z/${endDate}T23:59:59.999Z`,
    granularity: 'P1DT1H',
    groupBy: ['conversationId', 'evaluationId'],
    filter: { type: 'and', clauses },
    metrics: ['nEvaluations'],
  };
}
async function getUser(userId) {
  if (!userId) return null;
  const cached = state.cache.users[userId];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  try {
    const user = await gcFetch('GET', `/api/v2/users/${userId}`);
    const slim = { id: user.id, name: user.name || '', email: user.email || user.username || '' };
    state.cache.users[userId] = { data: slim, cachedAt: Date.now() };
    saveCache();
    return slim;
  } catch {
    return { id: userId, name: userId, email: '' };
  }
}
async function getPublishedForm(formId) {
  if (!formId) return null;
  const cached = state.cache.forms[formId];
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.data;
  const form = await gcFetch('GET', `/api/v2/quality/publishedforms/evaluations/${formId}`);
  state.cache.forms[formId] = { data: form, cachedAt: Date.now() };
  saveCache();
  return form;
}
function processForm(form) {
  const groupLookup = {}, questionLookup = {}, answerLookup = {}, multiParents = {}, questionMeta = {};
  for (const group of form?.questionGroups || []) {
    groupLookup[group.id] = group.name || '';
    for (const q of group.questions || []) {
      questionLookup[q.id] = q.text || '';
      questionMeta[q.id] = { type: q.type || '', naEnabled: q.naEnabled, isCritical: q.isCritical, isKill: q.isKill, hasVisibilityCondition: !!q.visibilityCondition };
      for (const ao of q.answerOptions || []) {
        answerLookup[ao.id] = ao.text || ao.builtInType || '';
      }
      if (q.type === 'multipleSelectQuestion') {
        multiParents[q.id] = q;
        for (const optQ of q.multipleSelectOptionQuestions || []) {
          questionLookup[optQ.id] = optQ.text || '';
          questionMeta[optQ.id] = { type: optQ.type || '', naEnabled: optQ.naEnabled, isCritical: optQ.isCritical, isKill: optQ.isKill, multiSelectParentId: q.id };
          for (const ao of optQ.answerOptions || []) {
            answerLookup[ao.id] = ao.text || ao.builtInType || '';
          }
        }
      }
    }
  }
  return { groupLookup, questionLookup, answerLookup, multiParents, questionMeta };
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
      let answerText = '';
      let answerId = q.answerId || '';
      let selectedCount = '';
      let totalOptions = '';
      if (q.multipleSelectQuestionOptionScores?.length) {
        const selected = [];
        const all = [];
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
      const aiMatches = aiAnswerId ? String(aiAnswerId === (q.answerId || '')) : '';
      const aiOverridden = aiAnswerId ? String(aiAnswerId !== (q.answerId || '')) : '';
      const eligibleForAiAgreement = String(evaluation.systemSubmitted !== true && automatedType === 'AiScoring' && !!aiAnswerId);
      const meta = lookups.questionMeta[q.questionId] || {};
      rows.push({
        export_record_type: recordType,
        evaluation_id: evaluation.id,
        conversation_id: evaluation.conversation?.id || '',
        evaluation_context_id: evaluation.evaluationContextId || '',
        evaluation_form_id: evaluation.evaluationForm?.id || '',
        evaluation_form_name: evaluation.evaluationForm?.name || '',
        evaluation_form_type: formType,
        status: evaluation.status || '',
        system_submitted: evaluation.systemSubmitted === true,
        agent_id: evaluation.agent?.id || '',
        agent_name: agent?.name || '',
        evaluator_id: evaluation.evaluator?.id || '',
        evaluator_name: evaluator?.name || '',
        evaluator_email: evaluator?.email || '',
        queue_id: evaluation.queue?.id || '',
        agent_team_id: evaluation.agentTeam?.id || '',
        conversation_date: evaluation.conversationDate || '',
        conversation_end_date: evaluation.conversationEndDate || '',
        assigned_date: evaluation.assignedDate || '',
        release_date: evaluation.releaseDate || '',
        submitted_date: evaluation.submittedDate || '',
        changed_date: evaluation.changedDate || '',
        total_score: evaluation.answers?.totalScore ?? '',
        total_critical_score: evaluation.answers?.totalCriticalScore ?? '',
        total_non_critical_score: evaluation.answers?.totalNonCriticalScore ?? '',
        any_failed_kill_questions: evaluation.answers?.anyFailedKillQuestions ?? '',
        evaluation_source_name: evaluation.evaluationSource?.name || '',
        evaluation_source_type: evaluation.evaluationSource?.type || '',
        calibration_id: evaluation.calibration?.id || '',
        question_group_id: groupScore.questionGroupId || '',
        question_group_name: groupName,
        question_id: q.questionId || '',
        question_text: lookups.questionLookup[q.questionId] || '',
        question_type: meta.type || '',
        question_has_visibility_condition: meta.hasVisibilityCondition || false,
        answer_id: answerId,
        answer_text: answerText,
        question_score: q.score ?? '',
        question_marked_na: q.markedNA ?? '',
        question_system_marked_na: q.systemMarkedNA ?? '',
        failed_kill_question: q.failedKillQuestion ?? '',
        automated_answer_type: automatedType,
        automated_answer_id: q.automatedAnswer?.answerId || '',
        ai_answer_id: aiAnswerId,
        ai_answer_text: aiAnswerId ? (lookups.answerLookup[aiAnswerId] || '') : '',
        ai_explanation: q.aiAnswer?.explanation || '',
        ai_marked_not_applicable: q.aiAnswer?.markedNotApplicable ?? '',
        ai_answer_matches_final: aiMatches,
        ai_answer_overridden: aiOverridden,
        eligible_for_ai_agreement: eligibleForAiAgreement,
        final_answer_source: finalAnswerSource(evaluation, q, q.answerId || '', aiAnswerId, automatedType),
        multi_select_selected_count: selectedCount,
        multi_select_total_options: totalOptions,
      });
    }
  }
  return rows;
}
async function fetchRecordType(recordType) {
  const cfg = getConfigFromUi();
  const query = buildAggregateQuery(cfg.startDate, cfg.endDate, recordType, cfg.sourceFilter);
  const agg = await gcFetch('POST', '/api/v2/analytics/evaluations/aggregates/query', query);
  const results = agg.results || [];
  const rows = [];
  const evals = [];
  const seen = new Set();
  for (let i = 0; i < results.length; i++) {
    const group = results[i].group || {};
    if (!group.conversationId || !group.evaluationId || seen.has(group.evaluationId)) continue;
    seen.add(group.evaluationId);
    setStatus(`Fetching ${recordType} details ${i + 1} of ${results.length}...`);
    const evaluation = await gcFetch('GET', `/api/v2/quality/conversations/${group.conversationId}/evaluations/${group.evaluationId}`);
    if (cfg.sourceFilter === 'human' && evaluation.systemSubmitted === true) continue;
    if (cfg.sourceFilter === 'auto' && evaluation.systemSubmitted !== true) continue;
    const formId = evaluation.evaluationForm?.id;
    const form = formId ? await getPublishedForm(formId) : null;
    const questionRows = await evaluationToRows(evaluation, form, recordType);
    rows.push(...questionRows);
    evals.push(evaluation);
  }
  return { rows, evals };
}
async function runDashboard() {
  const cfg = getConfigFromUi();
  if (!state.token?.access_token) { alert('Sign in first.'); return; }
  if (!cfg.startDate || !cfg.endDate) { alert('Select a date range.'); return; }
  saveConfig();
  $('runBtn').disabled = true;
  try {
    state.rows = [];
    state.evaluations = [];
    const types = cfg.recordFilter === 'both' ? ['evaluation', 'calibration'] : [cfg.recordFilter];
    for (const t of types) {
      setStatus(`Running ${t} query...`);
      const result = await fetchRecordType(t);
      state.rows.push(...result.rows);
      state.evaluations.push(...result.evals);
    }
    render();
    setStatus(`Done. ${state.evaluations.length} evaluations and ${state.rows.length} question rows loaded.`);
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${err.message}`);
    alert(err.message);
  } finally {
    $('runBtn').disabled = false;
  }
}
function render() {
  const uniqueEvaluations = new Set(state.rows.map((r) => r.evaluation_id));
  const scores = [...new Map(state.rows.map((r) => [r.evaluation_id, Number(r.total_score)])).values()].filter((v) => !Number.isNaN(v));
  const avg = scores.length ? (scores.reduce((a,b) => a+b, 0) / scores.length).toFixed(1) : '-';
  const critical = state.rows.filter((r) => r.failed_kill_question === true || r.any_failed_kill_questions === true || Number(r.total_critical_score) < 100).length;
  const aiOverrides = state.rows.filter((r) => r.ai_answer_overridden === 'true').length;
  $('metricEvals').textContent = uniqueEvaluations.size;
  $('metricRows').textContent = state.rows.length;
  $('metricAvg').textContent = avg;
  $('metricCritical').textContent = critical;
  $('metricAiOverride').textContent = aiOverrides;
  renderQuestionSummary();
  renderRowsTable();
}
function renderQuestionSummary() {
  const map = new Map();
  for (const r of state.rows) {
    const key = `${r.evaluation_form_name}||${r.question_text}`;
    if (!map.has(key)) map.set(key, { form: r.evaluation_form_name, question: r.question_text, count:0, scoreSum:0, scoreCount:0, na:0, hidden:0, overrides:0 });
    const x = map.get(key); x.count++;
    const s = Number(r.question_score); if (!Number.isNaN(s)) { x.scoreSum += s; x.scoreCount++; }
    if (r.question_marked_na === true) x.na++;
    if (r.question_system_marked_na === true) x.hidden++;
    if (r.ai_answer_overridden === 'true') x.overrides++;
  }
  const rows = [...map.values()].sort((a,b) => b.count - a.count).slice(0, 200).map((x) => ({
    form: x.form, question: x.question, rows: x.count, avg_score: x.scoreCount ? (x.scoreSum/x.scoreCount).toFixed(2) : '', manual_na: x.na, system_hidden: x.hidden, ai_overrides: x.overrides
  }));
  $('questionSummary').innerHTML = makeTable(rows);
}
function renderRowsTable() {
  const preview = state.rows.slice(0, 500);
  $('rowsTable').innerHTML = preview.length ? makeTable(preview) : '<p class="note">No rows loaded.</p>';
}
function makeTable(rows) {
  if (!rows.length) return '<p class="note">No data.</p>';
  const cols = Object.keys(rows[0]);
  return `<table><thead><tr>${cols.map(c => `<th>${htmlEscape(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${htmlEscape(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
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
  $('logoutBtn').addEventListener('click', logout);
  $('saveConfigBtn').addEventListener('click', saveConfig);
  $('runBtn').addEventListener('click', runDashboard);
  $('exportBtn').addEventListener('click', exportCsv);
  $('clearCacheBtn').addEventListener('click', clearCache);
  try { await handleAuthCallback(); } catch (e) { console.error(e); alert(e.message); }
  loadToken();
  setStatus(`Ready. App version ${APP_VERSION}.`);
}
init();
