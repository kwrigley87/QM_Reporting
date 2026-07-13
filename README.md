# Genesys QM Insights Client App

GitHub Pages-hosted Genesys Cloud Client App for dynamic Quality Management reporting. The app is browser-only, uses Genesys Cloud OAuth PKCE, calls Genesys Cloud APIs directly from the signed-in user's browser, and keeps runtime tokens/report data out of the repository.

## Current direction

The project is moving from a single dashboard page into a **QM Reporting Decision Center** with shared global filters and report tabs:

1. **Overview** — quality health, score trends, previous-period context, and needs-attention signals.
2. **Risk** — critical failure trends and question risk indicators.
3. **Coaching** — agent and work-team performance views.
4. **Forms & Questions** — form, question-group, question, and answer performance.
5. **Virtual Supervisor** — submission-source governance for human versus system-submitted evaluations.
6. **Detail / Export** — explicit row-level detail loading and CSV export.

## App structure

The app remains lightweight static hosting, but the code is now split so the reporting model is easier to evolve:

```text
index.html                 # Static shell and tab containers
styles.css                 # Visual design, responsive layout, drawer, and tab styling
app.js                     # OAuth, Genesys API calls, rendering orchestration, and legacy detail export
src/report-definitions.js  # Report tabs, app version, report request registry
src/filter-state.js        # Canonical filter defaults, validation, signatures, previous-period helper
src/request-builders.js    # Endpoint-specific request builders for quality search/detail/fallback paths
src/cache.js               # In-memory session result cache
src/ui-shell.js            # Tab rendering and tab switching helpers
```

## Data strategy

- `POST /api/v2/quality/evaluations/search` is the primary dashboard data path.
- Selected names in the UI are resolved to IDs before querying Genesys Cloud.
- Search filters use supported `EXACT` criteria with multiple selected IDs passed as `values`, so values within one criterion are OR'd and separate criteria are AND'd.
- Date range validation is centralized and enforces the quality search API's 3-month maximum.
- Evaluation-level measures are calculated from unique evaluation summaries so question rows do not inflate KPIs.
- Full question-level detail remains on-demand only, primarily for CSV export.

## Browser-only security model

There is no backend database in this phase. Allowed persistence is limited to:

- OAuth token storage in the signed-in browser session/local browser storage required by the static client flow.
- Non-sensitive preferences and metadata cache in browser storage.
- In-memory result cache for repeated filter/report combinations.

Do not commit OAuth tokens, exported CSV files, customer evaluation data, or screenshots containing customer data.

## Repository sanity check

If the hosted site shows the old cockpit UI or the Sign in button does nothing, make sure `index.html`, `styles.css`, `app.js`, and every file in `src/` were replaced together on `main`. The modular `app.js` must be loaded by `index.html` with `type="module"`; mixing the old HTML with the modular JavaScript will prevent the login event handlers from loading.

## Deploying to GitHub Pages

Update these files directly on the repository `main` branch and let GitHub Pages serve them from the configured Pages source:

```text
index.html
styles.css
app.js
src/*.js
README.md
```

No GitHub Actions workflow is required for this direct-static-pages setup.
