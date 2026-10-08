# CLAUDE.md

Guidance for AI agents and developers working in this repository.

## What this is

**Kompas SEO** — a SaaS for SEO research "from keywords to competitor sites" for the EU market, with first-class Bulgarian (Cyrillic) support. The UI is in Bulgarian (default) and English. Code, comments and commits are in English.

The full product spec lives with the project owner. It is built in phases: 0. Foundation (done) · 1. Keywords (done) · 2. Domains and competitors (done) · 3. Rank tracking · 4. Backlinks · 5. GSC and content · 6. Monetization and polish.

## Architecture

```
apps/web                 Next.js 16 (App Router, Turbopack), next-intl, Tailwind 4, TanStack Query
apps/api                 NestJS 12 REST API + Swagger (/docs), Better Auth mounted at /api/auth/*
apps/worker              BullMQ workers (background jobs, schedules) + health endpoint
packages/shared          zod schemas, API contracts, permissions, plans, credit costs, env, crypto
packages/db              Drizzle schema + migrations (Postgres), ClickHouse client + SQL migrations, shared DB ops
packages/data-providers  Provider interfaces, MockProvider, middleware (cache/dedup/retry/breaker/usage)
packages/seo-core        Pure SEO algorithms: CTR curve, traffic + GSC calibration, KD, intent rules, clustering
packages/ui              shadcn-style components on radix-ui (source-only, transpiled by Next)
packages/config          Shared tsconfig presets and Vitest defaults
```

Request flow: browser → `web` (localhost:3000) → Next rewrite `/api/*` → `api` (localhost:4000). The browser only sees one origin, so auth cookies are first-party.

Data stores:

- **PostgreSQL**: users, orgs, members, invitations (Better Auth tables), projects, competitors, subscriptions, credit ledger, jobs, audit log.
- **ClickHouse**: high-volume analytical data (keywords, SERP snapshots, rank history, domain keywords, backlinks, domain metrics, provider usage).
- **Redis**: provider cache, BullMQ queues, rate limiting, job progress pub/sub.

## Commands

| Command                                                     | What it does                                                                                       |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm dev`                                                  | Starts Docker services, builds packages, migrates, runs web + api + worker                         |
| `pnpm build` / `pnpm lint` / `pnpm typecheck` / `pnpm test` | Turborepo pipelines over all workspaces                                                            |
| `pnpm test:e2e`                                             | Playwright (needs the stack running: `pnpm dev`)                                                   |
| `pnpm db:generate`                                          | Generate a Drizzle migration after editing `packages/db/src/schema/*` (build `@seo/db` first)      |
| `pnpm db:migrate`                                           | Apply Postgres + ClickHouse migrations (`--test` variant: `pnpm --filter @seo/db db:migrate:test`) |
| `pnpm db:seed`                                              | Demo account (see README)                                                                          |
| `pnpm services:up` / `services:down`                        | Docker Compose only                                                                                |

API integration tests (`apps/api/test`) need Postgres, ClickHouse and Redis from Docker; they use `seo_test`, ClickHouse DB `seo_test` and Redis DB 15, never dev data.

## Rules that must not be broken

1. **Data providers**: application code never calls external SEO APIs directly. Use `MeteredProviders.call(ctx, kind, method, ...args)` (api) — it prices the call, charges credits up front (402 `INSUFFICIENT_CREDITS` without calling the provider), refunds on failure, and attributes usage to the org. The worker uses `createProviders()` and must charge credits the same way when acting for an org.
2. **No Google SERP scraping.** Only licensed providers (DataForSEO etc.).
3. **Tenant isolation**: every org-scoped repository method takes `organizationId` and filters by it. Foreign IDs must return 404, not 403. Cover new endpoints in `apps/api/test/isolation.test.ts`.
4. **Permissions**: protect org routes with `@RequirePermission('resource:action')`. The matrix lives in `packages/shared/src/permissions.ts`; the UI uses the same matrix via `useCan()` only to hide controls.
5. **i18n**: no hardcoded UI text. Add keys to both `apps/web/messages/bg.json` and `en.json` (a test enforces identical keys and placeholders; ESLint `i18next/no-literal-string` blocks literal JSX text). Use `Link`/`useRouter` from `@/i18n/navigation`.
6. **Validation**: request bodies/queries/params are validated with zod schemas from `@seo/shared` via Nest 12 Standard Schema: `@Body({ schema })`. Never trust client input.
7. **Errors**: throw `AppError(code, message, details)`; the global filter maps it to `{ code, message, details, requestId }`.
8. **Secrets** come from env only; document every variable in `.env.example`. OAuth tokens are encrypted with `encryptSecret` (AES-256-GCM, `ENCRYPTION_KEY`).
9. **Migrations** are append-only. Postgres: drizzle-kit generated SQL in `packages/db/drizzle`. ClickHouse: numbered files in `packages/db/clickhouse/migrations` (checksums are verified; never edit an applied file).

## Keyword research (Phase 1)

- API modules: `apps/api/src/keywords` (explorer, overview), `apps/api/src/keyword-lists` (lists, items, clustering), `apps/api/src/llm` (`LLMProvider` + `IntentService`).
- Stored data is reused before calling a provider again (`FRESHNESS` in `keywords.service.ts`): keyword metrics and idea sets 30 days, SERP 24 h, top-10 page metrics 7 days. Only fetches spend credits.
- ClickHouse reads and writes for keywords and SERPs go through `packages/db/src/clickhouse/keyword-store.ts`. Use query parameters (`{name:Type}`) only and never interpolate values.
- Spending credits needs `research:run`. Viewers can read stored research but not trigger new provider calls.
- Intent: provider intent, then BG/EN rules (`seo-core/intent.ts`), then Claude for ambiguous keywords (batches of up to 100, cached 30 days in Redis). Without `ANTHROPIC_API_KEY` only rules are used.
- Clustering is the `keywords.cluster` job. The API charges `keyword.clusterSerp` per keyword without a stored SERP, the worker fetches the missing SERPs and refunds if the job finally fails.
- In-memory filters and sorting for lists (`packages/shared/src/keyword-filters.ts`) mirror the ClickHouse explorer filters. Keep them in sync.

## Domains and competitors (Phase 2)

- API module: `apps/api/src/domains` (overview, organic keywords, top pages, competitor discovery, keyword gap, content gap). Algorithms live in `seo-core` (`competitors.ts`, `gap.ts`, `content-gap.ts`).
- Domain snapshots (up to `DOMAIN_KEYWORD_LIMIT` keywords per domain, live and lost) and overviews are stored in ClickHouse (`domain-store.ts`) and reused for 7 days (`DOMAIN_FRESH_DAYS`), so gap analyses over the same domains are free after the first run.
- Competitor discovery reads the top 20 for the project's 50 highest-volume keywords (charged as `keyword.clusterSerp` for SERPs not stored yet), counts shared domains, excludes universal sites (Wikipedia, YouTube, social networks) and caches the result in Redis for 7 days. Bump the cache key version when its shape changes.
- Keyword gap categories are defined in `seo-core/gap.ts`; the tests in `apps/api/test/domains.test.ts` check every tab against its definition.
- Web: `apps/web/src/app/[locale]/app/competitors/*`; table headers take `metric` for the info tooltip (never put `MetricLabel` inside a sortable header: nested buttons break hydration).

## Conventions

- TypeScript strict, ESM everywhere (`"type": "module"`, NodeNext; relative imports in Node packages end with `.js`).
- Nest DI needs decorator metadata: inject classes with value imports (ESLint is configured for this in `apps/api`). Non-class deps use symbol tokens from `apps/api/src/infra/tokens.ts`.
- Shared business operations used by both api and worker (credits, jobs, org bootstrap) live in `packages/db/src/ops`.
- Long-running work: `JobsService.enqueue(type, input, ctx)` creates a `jobs` row + BullMQ job; the worker wraps processors with `tracked()` which persists progress and publishes it; the UI follows it with `useJobProgress(jobId)` (SSE with polling fallback). Add the job type to `JOB_TYPES`/`JOB_QUEUE` in shared and a processor in `apps/worker/src/processors`.
- Conventional Commits (`feat(api): …`, `fix(web): …`). Small, logical commits.
- Domains are normalized with `normalizeDomain` (lowercase, no www, IDN → punycode); keywords with `normalizeKeyword` (NFC, lowercase, single spaces).
- Locations use Google Ads geo IDs (= DataForSEO `location_code`, country = 2000 + ISO numeric; Bulgaria = 2100).

## Gotchas

- `apps/web/scripts/next.mjs` sets a repo-local `SWC_NATIVE_BINDING_CACHE` because next-intl's `@swc/core` rejects cache folders with unusual Windows ACLs.
- pnpm 12 blocks dependency install scripts; allow-list them in `pnpm-workspace.yaml` (`allowBuilds`).
- typescript-eslint supports TypeScript < 6.1, so TypeScript is pinned to 6.0.x.
- Better Auth tables are defined by hand in `packages/db/src/schema/auth.ts`; keep them in sync with `better-auth/db#getAuthTables` when upgrading.
