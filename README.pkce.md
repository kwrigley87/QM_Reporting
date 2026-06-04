# Genesys QM Insights Client App

Browser-only starter for a Genesys Cloud Client App that displays question-level QM evaluation results without storing raw evaluation data in a database.

## What this includes

- OAuth Authorization Code + PKCE login flow
- Live Genesys Cloud API calls
- Question-level dashboard
- Browser localStorage cache for user and published-form metadata
- CSV export from the live dashboard data
- Evaluation / calibration / human / auto-submitted filters

## Genesys setup

1. Host this folder as a static website. The current production URL is GitHub Pages: `https://kwrigley87.github.io/QM_Reporting/`.
2. In Genesys Cloud, create an OAuth client using **Authorization Code + PKCE**. Do not use Implicit Grant.
3. Add the hosted app URL as an authorized redirect URI. It must match exactly, including trailing slash/path: `https://kwrigley87.github.io/QM_Reporting/`.
4. Copy the OAuth client ID into `OAUTH_CLIENTS` in `app.js` for the matching Genesys Cloud region, for example `usw2.pure.cloud`. The client ID is public metadata, not a client secret.
5. Assign permissions to the users/roles that will use the app. At minimum, they need access to view analytics evaluations, quality evaluations, published forms, users, and calibration data if using calibration mode.
6. In Genesys Cloud Admin > Integrations > Web, create a Client Application integration pointing to the hosted URL if you want this opened inside Genesys Cloud.

## Local testing

For the GitHub Pages deployment, no Python server is required. Use:

```text
https://kwrigley87.github.io/QM_Reporting/
```

For optional local testing, run any local static server, then open `http://localhost:5173/` and add that exact URL to the OAuth client's redirect URIs.

## Notes

This is phase 1/2 only. It does not include a backend, scheduled jobs, alerts, or anomaly detection. It caches only metadata such as user display names and published form definitions in the browser to reduce repeated API calls.
