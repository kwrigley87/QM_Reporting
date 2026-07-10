import { REPORT_TABS, getReportTab } from './report-definitions.js';

export function setActiveTab(tabId) {
  const active = getReportTab(tabId).id;
  document.querySelectorAll('[data-tab-target]').forEach((button) => {
    const selected = button.dataset.tabTarget === active;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('[data-tab-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== active);
  });
  return active;
}

export function wireTabs(onChange) {
  document.querySelectorAll('[data-tab-target]').forEach((button) => {
    button.addEventListener('click', () => onChange?.(setActiveTab(button.dataset.tabTarget)));
  });
}

export function renderTabs(host) {
  if (!host) return;
  host.innerHTML = REPORT_TABS.map((tab, index) => `<button class="tab-button${index === 0 ? ' active' : ''}" role="tab" aria-selected="${index === 0}" data-tab-target="${tab.id}">${tab.label}<small>${tab.description}</small></button>`).join('');
}
