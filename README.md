# Kompas SEO

SEO research platform: from your keywords to your competitors' sites. Domain overview, organic competitors, keyword gap, link gap, keyword research, rank tracking and content research — with first-class Bulgarian support.

> Status: **Phase 4 (backlinks)**:
>
> - Backlink profile: rating, referring domains, new/lost per month, anchors by type, rel and TLD split.
> - Backlinks and referring domains with live/new/lost/broken filters and export.
> - Link gap: outreach prospects that link to competitors but not to you.
> - Toxic link scoring and a disavow list exported in Google's format.
>
> Phase 3 (rank tracking):
>
> - Daily rank tracking per device for the project and its competitors, history and 1/7/30-day changes.
> - Visibility, average position, distribution, share of voice, SERP volatility and top movers.
> - Email alerts on drops, gains and entering/leaving the top N.
>
> Phase 2 (domains and competitors):
>
> - Domain Overview: organic traffic and 12-month trend, top 3/10/100 keywords, domain rating, referring domains, countries, top keywords and pages.
> - Organic keywords of any domain with new/lost changes, position ranges, filters and export; top pages.
> - Automatic competitor discovery for a project (shared top-20 SERPs), one click to track a competitor.
> - Keyword gap for up to 5 domains (missing, weak, strong, untapped, unique, shared) with add-to-list and export; content gap.
> - DataForSEO provider for domain data.
>
> Built on Phase 0 (accounts, organizations and roles, projects, credits, background jobs, bilingual UI) and Phase 1 (Keyword Explorer and Overview, keyword lists, SERP clustering).

## Requirements

- Node.js 24+ and pnpm 12 (`corepack enable` picks the version from `package.json`)
- Docker Desktop (or Docker Engine + Compose)

No external API keys are needed: all SEO data comes from a deterministic mock provider by default.

## Quick start

```bash
pnpm install
pnpm dev
```

`pnpm dev` copies `.env.example` to `.env` (first run), starts Postgres, ClickHouse, Redis and Mailpit, applies migrations and runs all apps:

| URL                                                                    | What                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| http://localhost:3000                                                  | Web app (Bulgarian; English under `/en`)                                    |
| http://localhost:4000/docs                                             | API reference (Swagger)                                                     |
| http://localhost:18025                                                 | Mailpit: every email the app sends (verification, magic links, invitations) |
| http://localhost:4000/health/ready, http://localhost:4001/health/ready | Health of API and worker                                                    |

### Demo account

```bash
pnpm db:seed
```

Creates `demo@kompas.local` / `demo-password-123` with an organization, a sample project and 30 days of synthetic rank tracking history.

## Everyday commands

```bash
pnpm lint         # ESLint (incl. "no hardcoded UI text")
pnpm typecheck    # TypeScript in every workspace
pnpm test         # unit + API integration tests (needs Docker services running)
pnpm build        # production builds
pnpm test:e2e     # Playwright against a running stack
pnpm db:generate  # new Drizzle migration after schema changes
pnpm db:migrate   # apply Postgres + ClickHouse migrations
```

## Configuration

All configuration is environment-based; see [.env.example](.env.example) for every variable and its purpose. Highlights:

- `KEYWORD_PROVIDER`, `SERP_PROVIDER`: `mock` (default) or `dataforseo` (needs `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD`; `DATAFORSEO_SANDBOX=true` uses the free sandbox). `DOMAIN_PROVIDER` (domain overview, organic keywords, competitors) works the same way. `BACKLINK_PROVIDER` uses the DataForSEO Backlinks API (check that it is enabled for your DataForSEO account).
- `ANTHROPIC_API_KEY`: optional; enables Claude for classifying ambiguous search intent.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: enable "Continue with Google".
- `CREDIT_COSTS_JSON`: override credit prices per operation.
- `BILLING_ENABLED`: Stripe (Phase 6) stays off without keys.
- `SENTRY_DSN`: optional error reporting.

## Architecture

See [CLAUDE.md](CLAUDE.md) for the architecture, rules and conventions.

## Troubleshooting

- **Docker Desktop on Windows fails to start** — if its log mentions `dockerInference`, quit Docker Desktop, delete `%LOCALAPPDATA%\Docker\run\dockerInference` and start it again. If the engine is unreachable (`no route to host`), run `wsl --shutdown` and restart Docker Desktop.
- **`Failed to load native binding` from SWC** — the web scripts already set a repo-local `SWC_NATIVE_BINDING_CACHE`; if you run `next` directly, set it yourself.
