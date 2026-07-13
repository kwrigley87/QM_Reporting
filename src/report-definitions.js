export const APP_VERSION = '0.5.0';

export const REPORT_TABS = [
  { id: 'overview', label: 'Overview', description: 'Quality health, trends, previous-period movement, and attention signals.' },
  { id: 'risk', label: 'Risk', description: 'Critical failures, failed critical questions, and compliance hotspots.' },
  { id: 'coaching', label: 'Coaching', description: 'Agent and team performance signals for coaching prioritisation.' },
  { id: 'forms', label: 'Forms & Questions', description: 'Form, group, question, and answer-level reporting.' },
  { id: 'virtualSupervisor', label: 'Virtual Supervisor', description: 'Human versus system-submitted evaluation governance.' },
  { id: 'detail', label: 'Detail / Export', description: 'Controlled detail loading and scoped exports.' },
];

export const AGGREGATE_REQUESTS = {
  healthSummary: { id: 'healthSummary', level: 'evaluation', pageSize: 100, needsDetail: false },
  previousPeriodSummary: { id: 'previousPeriodSummary', level: 'evaluation', pageSize: 100, needsDetail: false },
  qualityTrend: { id: 'qualityTrend', level: 'evaluation', pageSize: 100, needsDetail: false },
  formPerformance: { id: 'formPerformance', level: 'form', pageSize: 100, needsDetail: false },
  agentPerformance: { id: 'agentPerformance', level: 'agent', pageSize: 100, needsDetail: false },
  teamPerformance: { id: 'teamPerformance', level: 'team', pageSize: 100, needsDetail: false },
  queuePerformance: { id: 'queuePerformance', level: 'queue', pageSize: 100, needsDetail: false },
  divisionPerformance: { id: 'divisionPerformance', level: 'division', pageSize: 100, needsDetail: false },
  questionGroupPerformance: { id: 'questionGroupPerformance', level: 'questionGroup', pageSize: 100, needsScopedQuestionContext: true },
  questionPerformance: { id: 'questionPerformance', level: 'question', pageSize: 100, needsScopedQuestionContext: true },
  answerDistribution: { id: 'answerDistribution', level: 'answer', pageSize: 100, needsScopedQuestionContext: true },
  criticalFailureSummary: { id: 'criticalFailureSummary', level: 'risk', pageSize: 100, needsDetail: false },
  virtualSupervisorMix: { id: 'virtualSupervisorMix', level: 'source', pageSize: 100, needsDetail: false },
  sourceComparison: { id: 'sourceComparison', level: 'source', pageSize: 100, needsDetail: false },
};

export function getReportTab(tabId) {
  return REPORT_TABS.find((tab) => tab.id === tabId) || REPORT_TABS[0];
}
