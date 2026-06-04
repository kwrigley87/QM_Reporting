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

1. Host this folder as a static website, for example GitHub Pages, Azure Static Web Apps, Netlify, or an internal web server.
2. In Genesys Cloud, create an OAuth client for Authorization Code with PKCE.
3. Add the hosted app URL as an authorized redirect URI. It must match exactly, including trailing slash/path.
4. Assign permissions to the users/roles that will use the app. At minimum, they need access to view analytics evaluations, quality evaluations, published forms, users, and calibration data if using calibration mode.
5. In Genesys Cloud Admin > Integrations > Web, create a Client Application integration pointing to the hosted URL.

## Local testing

Use any local static server. Example:

```bash
python3 -m http.server 5173
```

Then open:

```text
http://localhost:5173/
```

Add that exact URL to the OAuth client's redirect URIs for local testing.

## Notes

This is phase 1/2 only. It does not include a backend, scheduled jobs, alerts, or anomaly detection. It caches only metadata such as user display names and published form definitions in the browser to reduce repeated API calls.
