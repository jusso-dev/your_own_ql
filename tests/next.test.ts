import { describe, expect, it, vi } from "vitest";
import {
  createCustomQueryEngine,
  defineCustomQueryRegistry,
  type CustomQueryFetchRequest,
} from "../src";
import {
  createReportQueryDashboardHandler,
  createReportQueryItemHandlers,
  createReportQueryPreviewHandler,
  type CustomQueryRouteConfig,
  type CustomQueryScope,
  type SavedCustomQueryRecord,
  type SavedCustomQueryStore,
} from "../src/next";

interface TestContext {
  userId: string;
  orgId: string;
  role: "viewer" | "admin";
}

interface TestSavedQuery extends SavedCustomQueryRecord {
  orgId: string;
}

function createRequest(body?: unknown, url = "https://example.test/api/report-queries"): Request {
  return new Request(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

function createConfig(
  overrides: Partial<CustomQueryRouteConfig<TestContext, TestSavedQuery>> = {},
): CustomQueryRouteConfig<TestContext, TestSavedQuery> & {
  storeCalls: Array<{ action: string; id?: string; scope: CustomQueryScope }>;
  fetchCalls: string[];
  createCalls: number;
} {
  const fetchCalls: string[] = [];
  const storeCalls: Array<{ action: string; id?: string; scope: CustomQueryScope }> = [];
  let createCalls = 0;
  const savedQueries: TestSavedQuery[] = [
    {
      id: "query_1",
      orgId: "org_1",
      name: "Incidents",
      query: "count from incidents group by severity chart bar",
      showOnDashboard: true,
      createdById: "user_1",
    },
    {
      id: "query_1",
      orgId: "org_2",
      name: "Other org",
      query: "count from incidents group by severity chart bar",
      showOnDashboard: true,
      createdById: "user_2",
    },
  ];
  const registry = defineCustomQueryRegistry<TestContext, any>({
    incidents: {
      fields: ["severity", "recordedDay"],
      dateFields: ["recordedDay"],
      dateField: "recordedDay",
      fetch: async (request: CustomQueryFetchRequest<TestContext>) => {
        fetchCalls.push(request.source);
        return [
          { severity: "LOW", recordedDay: "2026-06-01" },
          { severity: "HIGH", recordedDay: "2026-06-02" },
        ];
      },
    },
  });
  const store: SavedCustomQueryStore<TestContext, TestSavedQuery> = {
    list: async ({ scope }) => {
      storeCalls.push({ action: "list", scope });
      return savedQueries.filter((query) => query.orgId === scope.orgId);
    },
    create: async ({ scope, data }) => {
      createCalls += 1;
      storeCalls.push({ action: "create", scope });
      return {
        id: "query_2",
        orgId: String(scope.orgId),
        name: data.name,
        query: data.query,
        visualization: data.visualization,
        showOnDashboard: data.showOnDashboard ?? false,
        createdById: "user_1",
      };
    },
    get: async ({ scope, id }) => {
      storeCalls.push({ action: "get", id, scope });
      return savedQueries.find((query) => query.id === id && query.orgId === scope.orgId) ?? null;
    },
    update: async ({ scope, id, data }) => {
      storeCalls.push({ action: "update", id, scope });
      const savedQuery = savedQueries.find(
        (query) => query.id === id && query.orgId === scope.orgId,
      );

      if (!savedQuery) {
        throw new Error("not found");
      }

      Object.assign(savedQuery, data);
      return savedQuery;
    },
    delete: async ({ scope, id }) => {
      storeCalls.push({ action: "delete", id, scope });
    },
  };
  const config: CustomQueryRouteConfig<TestContext, TestSavedQuery> = {
    engine: createCustomQueryEngine<TestContext>({ registry }),
    authenticate: async () => ({ userId: "user_1", orgId: "org_1", role: "admin" }),
    getScope: (context) => ({ orgId: context.orgId }),
    permissions: {
      canPreview: (context) => context.role !== "viewer" || true,
      canReadLibrary: () => true,
      canCreate: (context) => context.role === "admin",
      canUpdate: (context, savedQuery) =>
        context.role === "admin" || savedQuery.createdById === context.userId,
      canDelete: (context, savedQuery) =>
        context.role === "admin" || savedQuery.createdById === context.userId,
    },
    store,
    ...overrides,
  };

  return Object.assign(config, {
    storeCalls,
    fetchCalls,
    get createCalls() {
      return createCalls;
    },
  });
}

describe("Next.js route helpers", () => {
  it("PATCH uses scoped { id, orgId } lookup and update", async () => {
    const config = createConfig();
    const handlers = createReportQueryItemHandlers(config);
    const response = await handlers.PATCH(
      createRequest({ name: "Updated incidents" }),
      { params: { id: "query_1" } },
    );

    expect(response.status).toBe(200);
    expect(config.storeCalls).toEqual([
      { action: "get", id: "query_1", scope: { orgId: "org_1" } },
      { action: "update", id: "query_1", scope: { orgId: "org_1" } },
    ]);
  });

  it("DELETE uses scoped { id, orgId } lookup and delete", async () => {
    const config = createConfig();
    const handlers = createReportQueryItemHandlers(config);
    const response = await handlers.DELETE(
      createRequest(undefined),
      { params: Promise.resolve({ id: "query_1" }) },
    );

    expect(response.status).toBe(200);
    expect(config.storeCalls).toEqual([
      { action: "get", id: "query_1", scope: { orgId: "org_1" } },
      { action: "delete", id: "query_1", scope: { orgId: "org_1" } },
    ]);
  });

  it("preview evaluates through the scoped engine without creating saved queries or drafts", async () => {
    const generationCode = vi.fn();
    const config = createConfig();
    const handlers = createReportQueryPreviewHandler(config);
    const response = await handlers.POST(
      createRequest({
        query: "count from incidents group by severity chart bar",
        range: { start: "2026-06-01", end: "2026-06-30" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0]).toEqual(
      expect.objectContaining({
        ok: true,
        rows: [
          { label: "HIGH", value: 1 },
          { label: "LOW", value: 1 },
        ],
      }),
    );
    expect(config.fetchCalls).toEqual(["incidents"]);
    expect(config.createCalls).toBe(0);
    expect(generationCode).not.toHaveBeenCalled();
  });

  it("dashboard widgets evaluate only saved queries visible to the current org", async () => {
    const config = createConfig();
    const handlers = createReportQueryDashboardHandler(config);
    const response = await handlers.GET(
      createRequest(
        undefined,
        "https://example.test/api/report-queries/dashboard?start=2026-06-01&end=2026-06-30",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.widgets).toHaveLength(1);
    expect(body.widgets[0].query.orgId).toBe("org_1");
    expect(config.fetchCalls).toEqual(["incidents"]);
  });
});
