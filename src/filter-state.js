export const DEFAULT_FILTERS = {
  startDate: null,
  endDate: null,
  datePreset: null,
  recordType: 'evaluation',
  submissionSource: 'both',
  formIds: [],
  agentIds: [],
  evaluatorIds: [],
  queueIds: [],
  divisionIds: [],
  workTeamIds: [],
  questionGroupId: null,
  questionId: null,
  minEvaluationCount: 5,
  scoreTarget: 90,
  criticalFailureRateWarning: 0.02,
  criticalFailureRateCritical: 0.05,
};

const unique = (values = []) => [...new Set(values.filter(Boolean).map(String))].sort();

export function normalizeFilters(input = {}) {
  return {
    ...DEFAULT_FILTERS,
    ...input,
    recordType: input.recordType || input.recordFilter || DEFAULT_FILTERS.recordType,
    submissionSource: input.submissionSource || input.sourceFilter || DEFAULT_FILTERS.submissionSource,
    formIds: unique(input.formIds),
    agentIds: unique(input.agentIds),
    evaluatorIds: unique(input.evaluatorIds),
    queueIds: unique(input.queueIds),
    divisionIds: unique(input.divisionIds),
    workTeamIds: unique(input.workTeamIds || input.teamIds),
  };
}

export function selectedScopeCount(filters) {
  const f = normalizeFilters(filters);
  return f.formIds.length + f.agentIds.length + f.evaluatorIds.length + f.queueIds.length + f.divisionIds.length + f.workTeamIds.length + (f.questionGroupId ? 1 : 0) + (f.questionId ? 1 : 0);
}

export function daySpan(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.floor((end - start) / 86400000) + 1;
}

export function validateReportCriteria(filters) {
  const f = normalizeFilters(filters);
  const messages = [];
  const span = daySpan(f.startDate, f.endDate);
  if (!f.startDate || !f.endDate) messages.push({ level: 'error', message: 'Select a start and end date before loading QM insights.' });
  if (span !== null && span < 1) messages.push({ level: 'error', message: 'End date must be on or after start date.' });
  if (span !== null && span > 92) messages.push({ level: 'error', message: 'Quality evaluation search supports a maximum time range of 3 months. Narrow the date range.' });
  if (span !== null && span > 31 && selectedScopeCount(f) === 0) {
    messages.push({ level: 'warning', message: 'For broad ranges over 31 days, select a form, queue, division, team, or agent to keep the report responsive.' });
  }
  return messages;
}

export function createFilterSignature({ region = '', orgId = '', reportId = '', requestType = 'qualitySearch', filters = {} } = {}) {
  const f = normalizeFilters(filters);
  return JSON.stringify({ region, orgId, reportId, requestType, filters: f });
}

export function previousPeriod(filters) {
  const f = normalizeFilters(filters);
  const span = daySpan(f.startDate, f.endDate);
  if (!span || span < 1) return null;
  const end = new Date(`${f.startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - span + 1);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { ...f, startDate: iso(start), endDate: iso(end) };
}
