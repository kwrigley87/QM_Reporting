import { normalizeFilters, validateReportCriteria } from './filter-state.js';

function exactCriterion(field, values) {
  const vals = [...new Set((values || []).filter(Boolean).map(String))];
  if (!vals.length) return null;
  return { type: 'EXACT', field, values: vals };
}

function exactBooleanCriterion(field, value) {
  if (value === null || value === undefined) return null;
  return { type: 'EXACT', field, values: [Boolean(value)] };
}

export function buildQualitySearchRequest(filters, reportDefinition = {}, { pageNumber = 1, pageSize = 100 } = {}) {
  const f = normalizeFilters(filters);
  const errors = validateReportCriteria(f).filter((item) => item.level === 'error');
  if (errors.length) throw new Error(errors.map((item) => item.message).join(' '));

  const query = [
    { type: 'DATE_RANGE', field: 'submittedDate', startValue: `${f.startDate}T00:00:00.000Z`, endValue: `${f.endDate}T23:59:59.999Z` },
    exactCriterion('formId', f.formIds),
    exactCriterion('agentId', f.agentIds),
    exactCriterion('evaluatorId', f.evaluatorIds),
    exactCriterion('queueId', f.queueIds),
    exactCriterion('divisionId', f.divisionIds),
    exactCriterion('teamId', f.workTeamIds),
    exactCriterion('questionGroupId', f.questionGroupId ? [f.questionGroupId] : []),
    exactCriterion('questionId', f.questionId ? [f.questionId] : []),
    f.submissionSource === 'human' ? exactBooleanCriterion('systemSubmitted', false) : null,
    f.submissionSource === 'auto' ? exactBooleanCriterion('systemSubmitted', true) : null,
  ].filter(Boolean);

  return {
    pageNumber,
    pageSize: reportDefinition.pageSize ?? pageSize,
    query,
    sort: [{ field: 'submittedDate', order: 'desc' }],
  };
}

export function buildDetailRequest(filters, drilldownContext = {}) {
  return { filters: normalizeFilters(filters), drilldownContext };
}

export function buildAnalyticsFallbackRequest(filters, reportDefinition = {}) {
  return { filters: normalizeFilters(filters), reportDefinition };
}
