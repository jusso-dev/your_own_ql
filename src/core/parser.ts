import { validateCustomQueryRange } from "./date";
import {
  DEFAULT_CUSTOM_QUERY_LIMIT,
  MAX_CUSTOM_QUERY_LIMIT,
  MAX_CUSTOM_QUERY_RANGE_DAYS,
  type CustomQueryAst,
  type CustomQueryEvaluationOptions,
  type CustomQueryParseResult,
  type CustomQuerySourceRegistry,
  type CustomQueryVisualization,
} from "./types";
import {
  isCustomQueryVisualization,
  resolveFieldName,
  resolveSourceName,
} from "./registry";

const IDENTIFIER_PATTERN = "[A-Za-z][A-Za-z0-9_]*";
const DATE_PATTERN = "\\d{4}-\\d{2}-\\d{2}";
const WHERE_VALUE_PATTERN = `("[^"]+"|'[^']+'|[^\\s]+)`;

export const CUSTOM_QUERY_RE = new RegExp(
  [
    `^(count|sum\\s+(${IDENTIFIER_PATTERN}))`,
    `\\s+from\\s+(${IDENTIFIER_PATTERN})`,
    `(?:\\s+between\\s+(${DATE_PATTERN})\\s+and\\s+(${DATE_PATTERN}))?`,
    `(?:\\s+where\\s+(${IDENTIFIER_PATTERN})\\s*=\\s*${WHERE_VALUE_PATTERN})?`,
    `(?:\\s+group(?:\\s+|_)by\\s+(${IDENTIFIER_PATTERN}))?`,
    `(?:\\s+(?:trend|trending)(?:\\s+|_)by\\s+(${IDENTIFIER_PATTERN}))?`,
    `(?:\\s+limit\\s+([0-9]{1,2}))?`,
    `(?:\\s+(?:as|chart)\\s+(number|table|bar|pie|line))?$`,
  ].join(""),
  "i",
);

const FORBIDDEN_TEXT_RE = /(;|--|\/\*|\*\/)/;

function normalizeQueryText(query: string): string {
  return query.trim().replace(/\s+/g, " ");
}

function unquoteWhereValue(value: string): string {
  const first = value.at(0);
  const last = value.at(-1);

  if ((first === `"` && last === `"`) || (first === `'` && last === `'`)) {
    return value.slice(1, -1);
  }

  return value;
}

function parseVisualization(value: string | undefined): CustomQueryVisualization | undefined {
  if (!value) {
    return undefined;
  }

  const lower = value.toLowerCase();
  return isCustomQueryVisualization(lower) ? lower : undefined;
}

export function splitCustomQueryLines(queryText: string): string[] {
  return queryText
    .split(/\r?\n/)
    .map((line) => normalizeQueryText(line))
    .filter(Boolean);
}

export function parseCustomQuery(query: string): CustomQueryParseResult {
  const normalized = normalizeQueryText(query);

  if (!normalized) {
    return {
      ok: false,
      query,
      error: "Query cannot be empty.",
    };
  }

  if (FORBIDDEN_TEXT_RE.test(normalized)) {
    return {
      ok: false,
      query: normalized,
      error: "Query contains unsupported SQL-like syntax.",
    };
  }

  const match = CUSTOM_QUERY_RE.exec(normalized);
  if (!match) {
    return {
      ok: false,
      query: normalized,
      error:
        "Unsupported query syntax. Use count or sum with allowlisted from, where, group by/group_by, trend by/trend_by, limit, and chart clauses.",
    };
  }

  const [, operationText, metric, source, start, end, whereField, whereValue, groupBy, trendBy, limit, visualization] =
    match;

  const operation = operationText!.toLowerCase().startsWith("sum") ? "sum" : "count";
  const ast: CustomQueryAst = {
    query: normalized,
    operation,
    source: source!.toLowerCase(),
  };

  if (operation === "sum") {
    ast.metric = metric;
  }

  if (start && end) {
    ast.between = { start, end };
  }

  if (whereField && whereValue) {
    ast.where = {
      field: whereField,
      value: unquoteWhereValue(whereValue),
    };
  }

  if (groupBy) {
    ast.groupBy = groupBy;
  }

  if (trendBy) {
    ast.trendBy = trendBy;
  }

  if (limit) {
    ast.limit = Number(limit);
  }

  ast.visualization = parseVisualization(visualization);

  return {
    ok: true,
    ast,
  };
}

export function validateCustomQueryAst(
  ast: CustomQueryAst,
  registry: CustomQuerySourceRegistry,
  options: Pick<CustomQueryEvaluationOptions, "maxRangeDays" | "maxLimit"> = {},
): CustomQueryParseResult {
  const maxRangeDays = options.maxRangeDays ?? MAX_CUSTOM_QUERY_RANGE_DAYS;
  const maxLimit = options.maxLimit ?? MAX_CUSTOM_QUERY_LIMIT;
  const sourceName = resolveSourceName(registry, ast.source);

  if (!sourceName) {
    return {
      ok: false,
      query: ast.query,
      error: `Unknown query source "${ast.source}".`,
    };
  }

  const source = registry[sourceName]!;
  const nextAst: CustomQueryAst = {
    ...ast,
    source: sourceName,
  };

  if (nextAst.operation === "sum") {
    if (!nextAst.metric) {
      return {
        ok: false,
        query: ast.query,
        error: "Sum queries must include a metric field.",
      };
    }

    const metric = resolveFieldName(source, nextAst.metric);
    if (!metric) {
      return {
        ok: false,
        query: ast.query,
        error: `Unknown metric "${nextAst.metric}" for source "${sourceName}".`,
      };
    }

    if (source.numericFields && !source.numericFields.includes(metric)) {
      return {
        ok: false,
        query: ast.query,
        error: `Metric "${metric}" is not numeric for source "${sourceName}".`,
      };
    }

    nextAst.metric = metric;
  }

  if (nextAst.where) {
    const field = resolveFieldName(source, nextAst.where.field);
    if (!field) {
      return {
        ok: false,
        query: ast.query,
        error: `Unknown where field "${nextAst.where.field}" for source "${sourceName}".`,
      };
    }

    nextAst.where = {
      ...nextAst.where,
      field,
    };
  }

  if (nextAst.groupBy) {
    const field = resolveFieldName(source, nextAst.groupBy);
    if (!field) {
      return {
        ok: false,
        query: ast.query,
        error: `Unknown group field "${nextAst.groupBy}" for source "${sourceName}".`,
      };
    }

    nextAst.groupBy = field;
  }

  if (nextAst.trendBy) {
    const field = resolveFieldName(source, nextAst.trendBy);
    if (!field) {
      return {
        ok: false,
        query: ast.query,
        error: `Unknown trend field "${nextAst.trendBy}" for source "${sourceName}".`,
      };
    }

    if (source.dateFields && !source.dateFields.includes(field)) {
      return {
        ok: false,
        query: ast.query,
        error: `Trend field "${field}" is not a date bucket field for source "${sourceName}".`,
      };
    }

    nextAst.trendBy = field;
  }

  if (nextAst.between) {
    const rangeError = validateCustomQueryRange(nextAst.between, maxRangeDays);
    if (rangeError) {
      return {
        ok: false,
        query: ast.query,
        error: rangeError,
      };
    }
  }

  if (typeof nextAst.limit === "number" && nextAst.limit > maxLimit) {
    return {
      ok: false,
      query: ast.query,
      error: `Limit cannot exceed ${maxLimit}.`,
    };
  }

  return {
    ok: true,
    ast: nextAst,
  };
}

export function parseAndValidateCustomQuery(
  query: string,
  registry: CustomQuerySourceRegistry,
  options: Pick<CustomQueryEvaluationOptions, "maxRangeDays" | "maxLimit"> = {},
  override: Partial<Pick<CustomQueryAst, "visualization">> = {},
): CustomQueryParseResult {
  const parsed = parseCustomQuery(query);
  if (!parsed.ok) {
    return parsed;
  }

  const ast: CustomQueryAst = {
    ...parsed.ast,
    visualization: override.visualization ?? parsed.ast.visualization,
  };

  return validateCustomQueryAst(ast, registry, options);
}

export function parseAndValidateCustomQueryLines(
  queryText: string,
  registry: CustomQuerySourceRegistry,
  options: Pick<CustomQueryEvaluationOptions, "maxRangeDays" | "maxLimit"> = {},
): CustomQueryParseResult[] {
  const lines = splitCustomQueryLines(queryText);

  if (lines.length === 0) {
    return [
      {
        ok: false,
        query: queryText,
        error: "Query cannot be empty.",
      },
    ];
  }

  return lines.map((line) => parseAndValidateCustomQuery(line, registry, options));
}

export function getEffectiveCustomQueryLimit(
  ast: Pick<CustomQueryAst, "limit">,
  options: Pick<CustomQueryEvaluationOptions, "defaultLimit" | "maxLimit"> = {},
): number {
  const defaultLimit = options.defaultLimit ?? DEFAULT_CUSTOM_QUERY_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_CUSTOM_QUERY_LIMIT;
  return Math.min(ast.limit ?? defaultLimit, maxLimit);
}
