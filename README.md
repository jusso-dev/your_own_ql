# your-own-ql

Safe custom query language primitives for Next.js apps that need tenant-scoped reporting without raw SQL execution.

`your-own-ql` gives you:

- A tiny anchored QL parser for `count` and `sum`.
- Source and field allowlists that drive validation and autocomplete.
- An in-memory evaluator over normalized rows.
- Date range and result limit guardrails.
- Next.js route-handler helpers for preview, saved queries, and dashboard widgets.
- Optional React components with CodeMirror editing and table, number, bar, pie, and line chart rendering.

The package does not execute SQL, does not use Prisma raw queries, and does not inspect your Prisma schema. Your app defines safe reporting sources and tenant-scoped fetch adapters.

## Install

```bash
npm install your-own-ql
```

If you use the React workbench:

```tsx
import "your-own-ql/style.css";
```

## Agent Install Prompt

Copy this prompt into Claude, Codex, or another coding agent from the root of your Next.js app:

```text
Install and wire up the `your-own-ql` npm package to add a safe custom reporting workbench to this Next.js app.

Before implementing, read the Prisma schema, auth/session code, RBAC/permissions code, dashboard routes/components, and any existing report or analytics code. Do not assume table names, tenant fields, roles, or route conventions.

Goals:
- Install `your-own-ql`.
- Create a custom query registry using `defineCustomQueryRegistry`.
- Choose only safe, product-appropriate reporting sources and derived fields from this app's schema.
- Build tenant/org/account-scoped Prisma fetch adapters for each source.
- Normalize records into safe aggregate rows with date bucket fields such as `createdDay` or `createdMonth`.
- Create a `createCustomQueryEngine` instance with a one-year range cap and bounded result limits.
- Add saved-query persistence if it does not already exist.
- Wire Next.js route handlers for:
  - `GET /api/report-queries`
  - `POST /api/report-queries`
  - `PATCH /api/report-queries/:id`
  - `DELETE /api/report-queries/:id`
  - `POST /api/report-queries/preview`
  - optionally `GET /api/report-queries/dashboard`
- Add a workbench UI using `QueryWorkbench` from `your-own-ql/react`.
- Add dashboard widgets for saved queries where `showOnDashboard = true`.
- Reuse this app's existing UI components, layout, auth helpers, Prisma client, and dashboard widget system where possible.

Security requirements:
- Never execute SQL from query text.
- Never pass query text to Prisma raw SQL.
- Never expose arbitrary table names, model reflection, joins, relations, order clauses, subqueries, raw JSON access, mutation verbs, or raw field paths.
- Every source, metric, where field, group field, trend field, and autocomplete suggestion must come from the same allowlist registry.
- Every org-owned fetch must filter by the current user's effective tenant/org/account id.
- Query text must not be allowed to specify tenant/org/account ids.
- Do not allow tenant ids, raw record ids, emails, auth provider ids, secrets, API keys, tokens, password fields, raw JSON payloads, note bodies, AI transcripts, IP addresses, user agents, or device ids in the reporting allowlist.
- PATCH and DELETE for saved queries must look up records by `{ id, tenant/org/account id }`, not by bare `id`.
- Preview routes must evaluate aggregates only. They must not call AI, create report drafts, or persist anything.
- Mutations must enforce this app's RBAC rules. Read-only users should not create, edit, delete, or toggle shared dashboard queries unless the product explicitly supports personal saved views.

Implementation guidance:
- Prefer derived fields such as `status`, `category`, `role`, `completed`, `overdue`, `hasNotes`, `hasPhoto`, `createdDay`, and `createdMonth`.
- For numeric metrics, include the field in `numericFields`.
- For trends and date filtering, include safe date bucket fields in `dateFields` and set `dateField`.
- Use `select` in Prisma queries so fetch adapters only retrieve fields needed for normalization.
- Keep range limits at or below 366 inclusive days.
- Return aggregate DTOs only, not raw database rows.
- Add prebuilt query templates that fit this app's data model.

Tests to add:
- Valid count, sum, group, trend, limit, and chart parsing.
- Unknown sources and unknown fields are rejected.
- SQL-like or injection-style attempts are rejected.
- Tenant/account/org fields are rejected in where and group clauses.
- Date range cap is enforced.
- Grouped and trend aggregation works.
- Empty grouped results return empty rows.
- Saved query PATCH/DELETE use scoped lookup.
- Preview does not call AI/generation code and does not create saved records or drafts.

Run validation before finishing:
- `git diff --check`
- `npx tsc --noEmit --pretty false`
- `npm run lint`
- `npm test`
- `npm run build`
- If Prisma schema changed, run this repo's Prisma generate and migration workflow.
```

## Define Safe Sources

Create one source-of-truth registry. Every source, metric, filter, group, trend field, and autocomplete suggestion comes from this object.

```ts
import { defineCustomQueryRegistry } from "your-own-ql";

export interface ReportContext {
  userId: string;
  effectiveOrgId: string;
}

export const customQueryRegistry = defineCustomQueryRegistry<ReportContext>({
  incidents: {
    fields: ["type", "severity", "resolved", "recordedDay", "recordedMonth"],
    dateFields: ["recordedDay", "recordedMonth"],
    dateField: "recordedDay",
    fetch: async ({ context, range }) => {
      return prisma.incident.findMany({
        where: {
          orgId: context.effectiveOrgId,
          recordedAt: range
            ? {
                gte: new Date(`${range.start}T00:00:00.000Z`),
                lte: new Date(`${range.end}T23:59:59.999Z`),
              }
            : undefined,
        },
        select: {
          type: true,
          severity: true,
          resolved: true,
          recordedAt: true,
        },
      });
    },
    normalize: (incident) => ({
      type: incident.type,
      severity: incident.severity,
      resolved: incident.resolved,
      recordedDay: incident.recordedAt.toISOString().slice(0, 10),
      recordedMonth: incident.recordedAt.toISOString().slice(0, 7),
    }),
  },
  fuel_transactions: {
    fields: ["fuelType", "litres", "transactionDay", "transactionMonth"],
    numericFields: ["litres"],
    dateFields: ["transactionDay", "transactionMonth"],
    dateField: "transactionDay",
    fetch: async ({ context, range }) => {
      return prisma.fuelTransaction.findMany({
        where: {
          orgId: context.effectiveOrgId,
          transactionAt: range
            ? {
                gte: new Date(`${range.start}T00:00:00.000Z`),
                lte: new Date(`${range.end}T23:59:59.999Z`),
              }
            : undefined,
        },
        select: {
          fuelType: true,
          litres: true,
          transactionAt: true,
        },
      });
    },
    normalize: (transaction) => ({
      fuelType: transaction.fuelType,
      litres: transaction.litres,
      transactionDay: transaction.transactionAt.toISOString().slice(0, 10),
      transactionMonth: transaction.transactionAt.toISOString().slice(0, 7),
    }),
  },
});
```

Do not include tenant IDs, raw record IDs, emails, auth provider IDs, secrets, API keys, raw JSON, note bodies, transcripts, IP addresses, or user agents in the allowlist.

## Evaluate Queries

```ts
import { createCustomQueryEngine } from "your-own-ql";
import { customQueryRegistry } from "./custom-query-registry";

export const customQueryEngine = createCustomQueryEngine({
  registry: customQueryRegistry,
  options: {
    maxRangeDays: 366,
    defaultLimit: 25,
    maxLimit: 50,
  },
});

const results = await customQueryEngine.evaluate({
  context: { userId: user.id, effectiveOrgId: user.orgId },
  queries: [
    "count from incidents group by severity chart bar",
    "sum litres from fuel_transactions group by fuelType trend by transactionDay chart line",
  ],
  options: {
    range: { start: "2026-05-03", end: "2026-06-02" },
  },
});
```

Invalid lines return `{ ok: false, error }` DTOs. Valid lines fetch only their referenced allowlisted sources.

## Next.js Route Handlers

Wire auth, scope, RBAC, and persistence from your app. The store methods receive `scope`, so implementations should use `{ id, orgId }`, `{ id, tenantId }`, or your equivalent composite filter for item reads and mutations.

```ts
// app/api/report-queries/_config.ts
import {
  createReportQueryCollectionHandlers,
  createReportQueryDashboardHandler,
  createReportQueryItemHandlers,
  createReportQueryPreviewHandler,
  type CustomQueryRouteConfig,
} from "your-own-ql/next";
import { customQueryEngine } from "@/reporting/custom-query-engine";

export const customQueryRoutes = {
  engine: customQueryEngine,
  authenticate: getCurrentUserContext,
  getScope: (context) => ({ orgId: context.effectiveOrgId }),
  permissions: {
    canPreview: (context) => context.permissions.canReadReports,
    canReadLibrary: (context) => context.permissions.canReadReports,
    canCreate: (context) => context.permissions.canManageReports,
    canUpdate: (context, savedQuery) =>
      context.permissions.canManageReports || savedQuery.createdById === context.userId,
    canDelete: (context, savedQuery) =>
      context.permissions.canManageReports || savedQuery.createdById === context.userId,
  },
  store: {
    list: ({ scope }) =>
      prisma.savedReportQuery.findMany({
        where: { orgId: String(scope.orgId) },
        orderBy: { updatedAt: "desc" },
      }),
    create: ({ context, scope, data }) =>
      prisma.savedReportQuery.create({
        data: {
          orgId: String(scope.orgId),
          createdById: context.userId,
          name: data.name,
          query: data.query,
          visualization: data.visualization,
          showOnDashboard: data.showOnDashboard ?? false,
        },
      }),
    get: ({ scope, id }) =>
      prisma.savedReportQuery.findFirst({
        where: { id, orgId: String(scope.orgId) },
      }),
    update: ({ scope, id, data }) =>
      prisma.savedReportQuery.update({
        where: { id_orgId: { id, orgId: String(scope.orgId) } },
        data,
      }),
    delete: ({ scope, id }) =>
      prisma.savedReportQuery.delete({
        where: { id_orgId: { id, orgId: String(scope.orgId) } },
      }),
  },
} satisfies CustomQueryRouteConfig<ReportContext>;
```

```ts
// app/api/report-queries/route.ts
import { createReportQueryCollectionHandlers } from "your-own-ql/next";
import { customQueryRoutes } from "./_config";

export const { GET, POST } = createReportQueryCollectionHandlers(customQueryRoutes);
```

```ts
// app/api/report-queries/[id]/route.ts
import { createReportQueryItemHandlers } from "your-own-ql/next";
import { customQueryRoutes } from "../_config";

export const { PATCH, DELETE } = createReportQueryItemHandlers(customQueryRoutes);
```

```ts
// app/api/report-queries/preview/route.ts
import { createReportQueryPreviewHandler } from "your-own-ql/next";
import { customQueryRoutes } from "../_config";

export const { POST } = createReportQueryPreviewHandler(customQueryRoutes);
```

```ts
// app/api/report-queries/dashboard/route.ts
import { createReportQueryDashboardHandler } from "your-own-ql/next";
import { customQueryRoutes } from "../_config";

export const { GET } = createReportQueryDashboardHandler(customQueryRoutes);
```

## React Workbench

```tsx
"use client";

import { useState } from "react";
import { QueryWorkbench } from "your-own-ql/react";
import "your-own-ql/style.css";
import { customQueryRegistry } from "@/reporting/custom-query-registry";

export function ReportingWorkbench() {
  const [results, setResults] = useState([]);

  return (
    <QueryWorkbench
      registry={customQueryRegistry}
      templates={[
        {
          id: "incidents-by-severity",
          label: "Incidents by severity",
          query: "count from incidents group by severity chart bar",
        },
      ]}
      results={results}
      onPreview={async ({ query, range, visualization }) => {
        const response = await fetch("/api/report-queries/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            queries: [{ query, visualization }],
            range,
          }),
        });
        const body = await response.json();
        setResults(body.results);
      }}
    />
  );
}
```

## Supported Grammar

```text
count from <source>
sum <numericField> from <source>
[between YYYY-MM-DD and YYYY-MM-DD]
[where <field> = <value>]
[group by <field>]
[trend by <dateBucketField>]
[limit N]
[chart number|table|bar|pie|line]
```

Examples:

```text
count from incidents group by severity chart bar
sum litres from fuel_transactions group by fuelType chart pie
sum litres from fuel_transactions between 2026-05-03 and 2026-06-02 group by fuelType trend by transactionDay chart line
```

## Validation

```bash
npm run validate
```

The validation script runs whitespace checks, TypeScript, ESLint, tests, npm audit, the production build, and `npm pack --dry-run`.

## Production Package Notes

This repository is set up for npm publishing with:

- Explicit `exports` for the core package, `your-own-ql/next`, `your-own-ql/react`, and `your-own-ql/style.css`.
- Bundled TypeScript declarations for every public export.
- A constrained `files` list so the published package contains `dist`, the stylesheet, README, license, and changelog.
- `engines` and `packageManager` metadata for reproducible contributor installs.
- `prepublishOnly` validation so publish attempts run the full check suite first.
- `publishConfig.provenance = true` and a GitHub Actions publish workflow for npm provenance.
- CI across Node 20.19, 22.14, and 24 for the development toolchain.
- Dependency supply-chain hardening in `.npmrc`, including package release-age delay, disabled dependency lifecycle scripts, restricted Git dependencies, exact saves, strict peer dependency resolution, and audit defaults.
- Lockfile host, HTTPS, package name, and integrity checks through `npm run security:lockfile`.
- A dedicated dependency-safety workflow that runs a clean install, lockfile linting, and npm audit.

Before the first GitHub release publish, configure npm trusted publishing for:

```text
jusso-dev/your_own_ql
```

Trusted publishing lets npm use GitHub Actions OIDC instead of a long-lived npm token. If you publish manually, use:

```bash
npm publish --provenance --access public --ignore-scripts=false
```

Check the final package contents any time with:

```bash
npm run pack:dry-run
```

## Dependency Safety

This package keeps dependency install policy in `.npmrc`:

```ini
min-release-age=7
ignore-scripts=true
allow-git=root
save-exact=true
strict-peer-deps=true
audit=true
```

These settings are intentionally conservative:

- `min-release-age=7` delays newly published package versions.
- `ignore-scripts=true` blocks dependency lifecycle scripts during install.
- `allow-git=root` restricts Git dependencies to direct root dependencies.
- `save-exact=true` avoids broad semver ranges for newly added packages.
- `strict-peer-deps=true` fails on peer dependency conflicts.
- `audit=true` keeps audit checks enabled.

Run these commands after dependency changes:

```bash
npm run security:install
npm run security:lockfile
npm run audit:security
npm run security:check
```

If a future dependency truly needs an install script, treat it as an explicit exception: review the package, pin it, document the reason, and re-run `npm run validate`.
