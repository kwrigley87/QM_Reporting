# Genesys QM Insights Client App

GitHub Pages-hosted Genesys Cloud Client App for dynamic quality evaluation dashboards. The application source and documentation live in this repository so the production dashboard is delivered directly from the files on the `main` branch rather than a local machine.

## What this includes

- OAuth Authorization Code + PKCE login flow
- Live Genesys Cloud API calls
- Interactive Chart.js dashboard with KPI cards, score/volume trends, critical-failure trends, form bars, coaching hotspots, answer distribution, and AI scoring mix
- Static GitHub Pages dashboard files served directly from the repository
- Browser-session OAuth and metadata caching so the GitHub-hosted app can refresh quickly without adding a separate database
- Auto-refreshing filters for date presets, evaluation/calibration mode, human/auto source, forms, agents, queues, divisions, and work teams

## Dashboard direction

This repo is evolving from a starter question-level export into a dynamic quality-management dashboard that mirrors the feel of Genesys Cloud performance views:

- A modern command-center layout with KPI cards, Chart.js trend and bar charts, drill-down tables, and a slide-out filter drawer.
- Dynamic filters for dates, evaluation source, calibration mode, forms, agents, queues, divisions, and work teams.
- Aggregate-first dashboard loading for quick KPIs where the Genesys Cloud quality evaluation search API is available, with browser-side safeguards that calculate evaluation-level measures from unique evaluations rather than duplicated question rows.
- Live Genesys Cloud API reads for quality evaluation search, analytics evaluation aggregates, on-demand evaluation detail export, and metadata APIs for users, queues, divisions, work teams, and published forms.

Future phases should add richer charts, saved report presets, queue/division security checks, optional backend scheduling, alerting, and anomaly detection while keeping raw evaluation data storage intentional and governed.

## Data strategy

The dashboard uses `POST /api/v2/quality/evaluations/search` for filter-driven KPI and chart refreshes. It sends selected form, agent, queue, division, and team IDs in `EXACT` search criteria with multiple selected IDs supplied as values for the same criterion, uses returned search-level form/group/question/answer fields where available, and only expands full question-level detail rows when the user requests a detailed CSV export. Evaluation-level measures are calculated from unique evaluation IDs so question rows do not inflate counts or averages.

## Genesys setup

1. Host this folder as a static website. The current production URL is GitHub Pages: `https://kwrigley87.github.io/QM_Reporting/`.
2. In Genesys Cloud, create an OAuth client using **Authorization Code + PKCE**. Do not use Implicit Grant.
3. Add the hosted app URL as an authorized redirect URI. It must match exactly, including trailing slash/path: `https://kwrigley87.github.io/QM_Reporting/`.
4. Copy the OAuth client ID into `OAUTH_CLIENTS` in `app.js` for the matching Genesys Cloud region, for example `usw2.pure.cloud`. The client ID is public metadata, not a client secret.
5. Assign permissions to the users/roles that will use the app. At minimum, they need access to view analytics evaluations, quality evaluations, published forms, users, and calibration data if using calibration mode.
6. In Genesys Cloud Admin > Integrations > Web, create a Client Application integration pointing to the hosted URL if you want this opened inside Genesys Cloud.

## GitHub Pages deployment

All application files are intended to be committed to this GitHub repository and served by GitHub Pages directly from the `main` branch. No GitHub Actions workflow is required for this repo: update `index.html`, `styles.css`, `app.js`, and `README.md` on `main`, then GitHub Pages will serve those checked-in files.

Use the GitHub Pages URL as the OAuth redirect URI and Genesys Cloud Client Application URL:

```text
https://kwrigley87.github.io/QM_Reporting/
```

Do not rely on a local machine to host the dashboard for production use.

## Notes

This is phase 1/2 only. It does not include a backend, scheduled jobs, alerts, or anomaly detection. Runtime OAuth tokens and API metadata remain in the signed-in user browser session because GitHub Pages is static hosting; do not commit tokens, exported evaluation data, or customer data to the repository.
