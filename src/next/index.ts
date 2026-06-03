import {
  CUSTOM_QUERY_VISUALIZATIONS,
  type CustomQueryEngine,
  type CustomQueryRange,
  type CustomQueryVisualization,
} from "../core/types";
import { isCustomQueryVisualization } from "../core/registry";
import { validateCustomQueryRange } from "../core/date";

export type CustomQueryScope = Record<string, string | number | boolean>;

export interface SavedCustomQueryRecord {
  id: string;
  name: string;
  query: string;
  visualization?: CustomQueryVisualization;
  showOnDashboard: boolean;
  createdById?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  [key: string]: unknown;
}

export interface SavedCustomQueryCreateInput {
  name: string;
  query: string;
  visualization?: CustomQueryVisualization;
  showOnDashboard?: boolean;
}

export interface SavedCustomQueryUpdateInput {
  name?: string;
  query?: string;
  visualization?: CustomQueryVisualization;
  showOnDashboard?: boolean;
}

export interface SavedCustomQueryStore<
  Context,
  SavedQuery extends SavedCustomQueryRecord = SavedCustomQueryRecord,
> {
  list: (input: {
    context: Context;
    scope: CustomQueryScope;
  }) => Promise<readonly SavedQuery[]>;
  create: (input: {
    context: Context;
    scope: CustomQueryScope;
    data: SavedCustomQueryCreateInput;
  }) => Promise<SavedQuery>;
  get: (input: {
    context: Context;
    scope: CustomQueryScope;
    id: string;
  }) => Promise<SavedQuery | null>;
  update: (input: {
    context: Context;
    scope: CustomQueryScope;
    id: string;
    data: SavedCustomQueryUpdateInput;
  }) => Promise<SavedQuery>;
  delete: (input: {
    context: Context;
    scope: CustomQueryScope;
    id: string;
  }) => Promise<void>;
}

export interface CustomQueryRoutePermissions<
  Context,
  SavedQuery extends SavedCustomQueryRecord = SavedCustomQueryRecord,
> {
  canPreview: (context: Context) => boolean | Promise<boolean>;
  canReadLibrary: (context: Context) => boolean | Promise<boolean>;
  canCreate: (context: Context) => boolean | Promise<boolean>;
  canUpdate: (
    context: Context,
    savedQuery: SavedQuery,
  ) => boolean | Promise<boolean>;
  canDelete: (
    context: Context,
    savedQuery: SavedQuery,
  ) => boolean | Promise<boolean>;
}

export interface CustomQueryRouteConfig<
  Context,
  SavedQuery extends SavedCustomQueryRecord = SavedCustomQueryRecord,
> {
  engine: CustomQueryEngine<Context>;
  authenticate: (request: Request) => Promise<Context | null>;
  getScope: (context: Context) => CustomQueryScope | Promise<CustomQueryScope>;
  permissions: CustomQueryRoutePermissions<Context, SavedQuery>;
  store: SavedCustomQueryStore<Context, SavedQuery>;
}

type RouteContext =
  | {
      params?: { id?: string } | Promise<{ id?: string }>;
    }
  | undefined;

interface PreviewRequestBody {
  query?: string;
  queries?: Array<string | { query: string; visualization?: CustomQueryVisualization }>;
  range?: CustomQueryRange;
}

interface SavedQueryRequestBody {
  name?: unknown;
  query?: unknown;
  visualization?: unknown;
  showOnDashboard?: unknown;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function requireContext<Context>(
  request: Request,
  config: Pick<CustomQueryRouteConfig<Context>, "authenticate">,
): Promise<Context | Response> {
  const context = await config.authenticate(request);

  if (!context) {
    return json({ error: "Authentication required." }, 401);
  }

  return context;
}

async function resolveRouteId(routeContext: RouteContext): Promise<string | null> {
  const params = await routeContext?.params;
  return params?.id ?? null;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const name = value.trim();
  return name.length > 0 ? name : null;
}

function cleanQuery(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const query = value.trim();
  return query.length > 0 ? query : null;
}

function cleanVisualization(value: unknown): CustomQueryVisualization | undefined {
  if (typeof value === "undefined" || value === null || value === "") {
    return undefined;
  }

  if (!isCustomQueryVisualization(value)) {
    throw new Error(
      `Visualization must be one of ${CUSTOM_QUERY_VISUALIZATIONS.join(", ")}.`,
    );
  }

  return value;
}

function cleanShowOnDashboard(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function validateSavedQueryText<Context>(
  engine: CustomQueryEngine<Context>,
  query: string,
  visualization?: CustomQueryVisualization,
): string | null {
  const parsed = engine.parse(query, { visualization });
  return parsed.ok ? null : parsed.error;
}

function getDashboardRange(url: string): CustomQueryRange | undefined {
  const requestUrl = new URL(url);
  const start = requestUrl.searchParams.get("start");
  const end = requestUrl.searchParams.get("end");

  if (!start || !end) {
    return undefined;
  }

  return { start, end };
}

export function createReportQueryPreviewHandler<
  Context,
  SavedQuery extends SavedCustomQueryRecord = SavedCustomQueryRecord,
>(config: CustomQueryRouteConfig<Context, SavedQuery>) {
  return {
    POST: async (request: Request) => {
      const context = await requireContext(request, config);
      if (context instanceof Response) {
        return context;
      }

      if (!(await config.permissions.canPreview(context))) {
        return json({ error: "You do not have permission to preview custom queries." }, 403);
      }

      const body = await readJsonBody<PreviewRequestBody>(request);
      if (!body) {
        return json({ error: "Request body must be valid JSON." }, 400);
      }

      const queries = body.queries ?? body.query;
      if (!queries) {
        return json({ error: "Provide query or queries to preview." }, 400);
      }

      const rangeError = validateCustomQueryRange(
        body.range,
        config.engine.options.maxRangeDays,
      );
      if (rangeError) {
        return json({ error: rangeError }, 400);
      }

      const results = await config.engine.evaluate({
        context,
        queries,
        options: {
          range: body.range,
        },
      });

      return json({ results });
    },
  };
}

export function createReportQueryCollectionHandlers<
  Context,
  SavedQuery extends SavedCustomQueryRecord = SavedCustomQueryRecord,
>(config: CustomQueryRouteConfig<Context, SavedQuery>) {
  return {
    GET: async (request: Request) => {
      const context = await requireContext(request, config);
      if (context instanceof Response) {
        return context;
      }

      if (!(await config.permissions.canReadLibrary(context))) {
        return json({ error: "You do not have permission to read saved queries." }, 403);
      }

      const scope = await config.getScope(context);
      const queries = await config.store.list({ context, scope });

      return json({ queries });
    },
    POST: async (request: Request) => {
      const context = await requireContext(request, config);
      if (context instanceof Response) {
        return context;
      }

      if (!(await config.permissions.canCreate(context))) {
        return json({ error: "You do not have permission to save custom queries." }, 403);
      }

      const body = await readJsonBody<SavedQueryRequestBody>(request);
      if (!body) {
        return json({ error: "Request body must be valid JSON." }, 400);
      }

      const name = cleanName(body.name);
      const query = cleanQuery(body.query);
      if (!name || !query) {
        return json({ error: "Saved queries require a name and query." }, 400);
      }

      let visualization: CustomQueryVisualization | undefined;
      try {
        visualization = cleanVisualization(body.visualization);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid visualization." }, 400);
      }

      const queryError = validateSavedQueryText(config.engine, query, visualization);
      if (queryError) {
        return json({ error: queryError }, 400);
      }

      const scope = await config.getScope(context);
      const saved = await config.store.create({
        context,
        scope,
        data: {
          name,
          query,
          visualization,
          showOnDashboard: cleanShowOnDashboard(body.showOnDashboard) ?? false,
        },
      });

      return json({ query: saved }, 201);
    },
  };
}

export function createReportQueryItemHandlers<
  Context,
  SavedQuery extends SavedCustomQueryRecord = SavedCustomQueryRecord,
>(config: CustomQueryRouteConfig<Context, SavedQuery>) {
  return {
    PATCH: async (request: Request, routeContext?: RouteContext) => {
      const context = await requireContext(request, config);
      if (context instanceof Response) {
        return context;
      }

      const id = await resolveRouteId(routeContext);
      if (!id) {
        return json({ error: "Saved query id is required." }, 400);
      }

      const body = await readJsonBody<SavedQueryRequestBody>(request);
      if (!body) {
        return json({ error: "Request body must be valid JSON." }, 400);
      }

      const scope = await config.getScope(context);
      const existing = await config.store.get({ context, scope, id });
      if (!existing) {
        return json({ error: "Saved query not found." }, 404);
      }

      if (!(await config.permissions.canUpdate(context, existing))) {
        return json({ error: "You do not have permission to edit this query." }, 403);
      }

      const data: SavedCustomQueryUpdateInput = {};
      const name = cleanName(body.name);
      const query = cleanQuery(body.query);

      if (typeof body.name !== "undefined") {
        if (!name) {
          return json({ error: "Saved query name cannot be empty." }, 400);
        }

        data.name = name;
      }

      if (typeof body.query !== "undefined") {
        if (!query) {
          return json({ error: "Saved query text cannot be empty." }, 400);
        }

        data.query = query;
      }

      try {
        const visualization = cleanVisualization(body.visualization);
        if (typeof body.visualization !== "undefined") {
          data.visualization = visualization;
        }
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Invalid visualization." }, 400);
      }

      const showOnDashboard = cleanShowOnDashboard(body.showOnDashboard);
      if (typeof showOnDashboard !== "undefined") {
        data.showOnDashboard = showOnDashboard;
      }

      const queryToValidate = data.query ?? existing.query;
      const visualizationToValidate = data.visualization ?? existing.visualization;
      const queryError = validateSavedQueryText(
        config.engine,
        queryToValidate,
        visualizationToValidate,
      );
      if (queryError) {
        return json({ error: queryError }, 400);
      }

      const saved = await config.store.update({ context, scope, id, data });

      return json({ query: saved });
    },
    DELETE: async (request: Request, routeContext?: RouteContext) => {
      const context = await requireContext(request, config);
      if (context instanceof Response) {
        return context;
      }

      const id = await resolveRouteId(routeContext);
      if (!id) {
        return json({ error: "Saved query id is required." }, 400);
      }

      const scope = await config.getScope(context);
      const existing = await config.store.get({ context, scope, id });
      if (!existing) {
        return json({ error: "Saved query not found." }, 404);
      }

      if (!(await config.permissions.canDelete(context, existing))) {
        return json({ error: "You do not have permission to delete this query." }, 403);
      }

      await config.store.delete({ context, scope, id });

      return json({ ok: true });
    },
  };
}

export function createReportQueryDashboardHandler<
  Context,
  SavedQuery extends SavedCustomQueryRecord = SavedCustomQueryRecord,
>(config: CustomQueryRouteConfig<Context, SavedQuery>) {
  return {
    GET: async (request: Request) => {
      const context = await requireContext(request, config);
      if (context instanceof Response) {
        return context;
      }

      if (!(await config.permissions.canPreview(context))) {
        return json({ error: "You do not have permission to view query widgets." }, 403);
      }

      const range = getDashboardRange(request.url);
      const rangeError = validateCustomQueryRange(
        range,
        config.engine.options.maxRangeDays,
      );
      if (rangeError) {
        return json({ error: rangeError }, 400);
      }

      const scope = await config.getScope(context);
      const savedQueries = (await config.store.list({ context, scope })).filter(
        (savedQuery) => savedQuery.showOnDashboard,
      );
      const results = await config.engine.evaluate({
        context,
        queries: savedQueries.map((savedQuery) => ({
          query: savedQuery.query,
          visualization: savedQuery.visualization,
        })),
        options: {
          range,
        },
      });

      return json({
        widgets: savedQueries.map((query, index) => ({
          query,
          result: results[index] ?? {
            query: query.query,
            ok: false,
            error: "Query widget evaluation failed.",
          },
        })),
      });
    },
  };
}
