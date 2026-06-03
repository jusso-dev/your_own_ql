import {
  combineRanges,
  isDateOnlyWithinRange,
  toDateOnly,
  validateCustomQueryRange,
} from "./date";
import { parseAndValidateCustomQuery, splitCustomQueryLines, getEffectiveCustomQueryLimit } from "./parser";
import {
  DEFAULT_CUSTOM_QUERY_LIMIT,
  DEFAULT_PIE_GROUP_WARNING_THRESHOLD,
  MAX_CUSTOM_QUERY_LIMIT,
  MAX_CUSTOM_QUERY_RANGE_DAYS,
  type CustomQueryAst,
  type CustomQueryEvaluationQuery,
  type CustomQueryEvaluationQueryInput,
  type CustomQueryEvaluationOptions,
  type CustomQueryResult,
  type CustomQueryResultRow,
  type CustomQueryResultSeries,
  type CustomQuerySourceDefinition,
  type CustomQuerySourceRegistry,
  type CustomQueryVisualization,
  type EvaluateCustomQueriesInput,
  type NormalizedCustomQueryRow,
  type NormalizedCustomQueryValue,
} from "./types";

type ParsedLine = {
  query: string;
  ast?: CustomQueryAst;
  error?: string;
};

const DEFAULT_EMPTY_LABEL = "(blank)";

function inferVisualization(ast: CustomQueryAst): CustomQueryVisualization {
  if (ast.visualization) {
    return ast.visualization;
  }

  if (ast.trendBy) {
    return "line";
  }

  if (ast.groupBy) {
    return "table";
  }

  return "number";
}

function normalizeQueryInputs(
  queries: string | readonly CustomQueryEvaluationQueryInput[],
): CustomQueryEvaluationQuery[] {
  if (typeof queries === "string") {
    return splitCustomQueryLines(queries).map((query) => ({ query }));
  }

  return queries.map((input) =>
    typeof input === "string"
      ? {
          query: input,
        }
      : input,
  );
}

function asNormalizedRows<Row>(
  rows: readonly Row[],
  source: CustomQuerySourceDefinition<Row>,
): NormalizedCustomQueryRow[] {
  if (source.normalize) {
    return rows.map((row) => source.normalize!(row));
  }

  return rows.map((row) => row as NormalizedCustomQueryRow);
}

function coerceNumericValue(value: NormalizedCustomQueryValue, field: string): number {
  if (value === null || typeof value === "undefined" || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Metric "${field}" contains a non-finite number.`);
    }

    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Metric "${field}" must be numeric after row normalization.`);
}

function addToMap(map: Map<string, number>, label: string, value: number): void {
  map.set(label, (map.get(label) ?? 0) + value);
}

function formatLabel(value: NormalizedCustomQueryValue, emptyLabel: string): string {
  if (value instanceof Date) {
    return toDateOnly(value) ?? emptyLabel;
  }

  if (value === null || typeof value === "undefined" || value === "") {
    return emptyLabel;
  }

  return String(value);
}

function valuesEqual(left: NormalizedCustomQueryValue, right: string): boolean {
  if (typeof left === "boolean") {
    return String(left).toLowerCase() === right.toLowerCase();
  }

  if (typeof left === "number") {
    return Number(right) === left;
  }

  if (left instanceof Date) {
    return (toDateOnly(left) ?? left.toISOString()) === right;
  }

  return String(left ?? "") === right;
}

function sortValueRows(rows: CustomQueryResultRow[]): CustomQueryResultRow[] {
  return [...rows].sort((a, b) => {
    const valueSort = b.value - a.value;
    return valueSort === 0 ? a.label.localeCompare(b.label) : valueSort;
  });
}

function sortLabelRows(rows: CustomQueryResultRow[]): CustomQueryResultRow[] {
  return [...rows].sort((a, b) => a.label.localeCompare(b.label));
}

function aggregateRows(
  ast: CustomQueryAst,
  rows: readonly NormalizedCustomQueryRow[],
): number {
  if (ast.operation === "count") {
    return rows.length;
  }

  const metric = ast.metric!;
  return rows.reduce((total, row) => total + coerceNumericValue(row[metric], metric), 0);
}

function filterRowsForAst(
  ast: CustomQueryAst,
  source: CustomQuerySourceDefinition,
  rows: readonly NormalizedCustomQueryRow[],
  optionsRange: CustomQueryEvaluationOptions["range"],
): NormalizedCustomQueryRow[] {
  const range = ast.between ?? optionsRange;

  return rows.filter((row) => {
    if (ast.where && !valuesEqual(row[ast.where.field], ast.where.value)) {
      return false;
    }

    if (range) {
      if (!source.dateField) {
        throw new Error(`Source "${ast.source}" does not support date range filtering.`);
      }

      return isDateOnlyWithinRange(toDateOnly(row[source.dateField]), range);
    }

    return true;
  });
}

function buildWarnings(
  ast: CustomQueryAst,
  source: CustomQuerySourceDefinition,
  result: Pick<CustomQueryResult, "rows" | "visualization">,
  options: Required<EvaluatorOptionDefaults>,
): string[] {
  const warnings: string[] = [];
  const visualization = result.visualization ?? inferVisualization(ast);

  if (ast.groupBy && visualization === "number") {
    warnings.push("Grouped results fit table, bar, or pie charts better than a number chart.");
  }

  if (!ast.trendBy && visualization === "line") {
    warnings.push("Line charts need a trend by date bucket field.");
  }

  if (ast.trendBy && visualization !== "line") {
    warnings.push("Trend queries usually fit chart line.");
  }

  if (visualization === "pie" && (result.rows?.length ?? 0) > options.pieGroupWarningThreshold) {
    warnings.push("Pie charts become hard to scan with many groups. Consider bar or table.");
  }

  if (source.snapshot && (ast.trendBy || ast.between)) {
    warnings.push(
      "This source is marked as a snapshot. Use transaction or history records for true trends.",
    );
  }

  return warnings;
}

interface EvaluatorOptionDefaults {
  maxRangeDays: number;
  maxLimit: number;
  defaultLimit: number;
  pieGroupWarningThreshold: number;
  emptyLabel: string;
}

function withOptionDefaults(options: CustomQueryEvaluationOptions = {}): Required<EvaluatorOptionDefaults> &
  Pick<CustomQueryEvaluationOptions, "range"> {
  return {
    range: options.range,
    maxRangeDays: options.maxRangeDays ?? MAX_CUSTOM_QUERY_RANGE_DAYS,
    maxLimit: options.maxLimit ?? MAX_CUSTOM_QUERY_LIMIT,
    defaultLimit: options.defaultLimit ?? DEFAULT_CUSTOM_QUERY_LIMIT,
    pieGroupWarningThreshold:
      options.pieGroupWarningThreshold ?? DEFAULT_PIE_GROUP_WARNING_THRESHOLD,
    emptyLabel: options.emptyLabel ?? DEFAULT_EMPTY_LABEL,
  };
}

function mapToRows(map: Map<string, number>): CustomQueryResultRow[] {
  return [...map.entries()].map(([label, value]) => ({ label, value }));
}

function evaluateTrendQuery(
  ast: CustomQueryAst,
  rows: readonly NormalizedCustomQueryRow[],
  limit: number,
  options: Required<EvaluatorOptionDefaults>,
): Pick<CustomQueryResult, "rows" | "series" | "value"> {
  const trendField = ast.trendBy!;
  const totalsByTrend = new Map<string, number>();
  const trendLabels = new Set<string>();
  const groupTotals = new Map<string, number>();
  const valuesByGroupThenTrend = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const trendLabel = formatLabel(row[trendField], options.emptyLabel);
    const value = ast.operation === "count" ? 1 : coerceNumericValue(row[ast.metric!], ast.metric!);
    trendLabels.add(trendLabel);
    addToMap(totalsByTrend, trendLabel, value);

    if (ast.groupBy) {
      const groupLabel = formatLabel(row[ast.groupBy], options.emptyLabel);
      addToMap(groupTotals, groupLabel, value);

      const byTrend = valuesByGroupThenTrend.get(groupLabel) ?? new Map<string, number>();
      addToMap(byTrend, trendLabel, value);
      valuesByGroupThenTrend.set(groupLabel, byTrend);
    }
  }

  const sortedTrendLabels = [...trendLabels].sort((a, b) => a.localeCompare(b));
  const rowsByTrend = sortedTrendLabels.map((label) => ({
    label,
    value: totalsByTrend.get(label) ?? 0,
  }));

  if (!ast.groupBy) {
    return {
      rows: rowsByTrend,
      series: [
        {
          label: ast.operation === "count" ? "count" : ast.metric!,
          rows: rowsByTrend,
        },
      ],
      value: aggregateRows(ast, rows),
    };
  }

  const groupLabels = sortValueRows(mapToRows(groupTotals))
    .slice(0, limit)
    .map((row) => row.label);

  const series: CustomQueryResultSeries[] = groupLabels.map((label) => {
    const byTrend = valuesByGroupThenTrend.get(label) ?? new Map<string, number>();
    return {
      label,
      rows: sortedTrendLabels.map((trendLabel) => ({
        label: trendLabel,
        value: byTrend.get(trendLabel) ?? 0,
      })),
    };
  });

  return {
    rows: rowsByTrend,
    series,
    value: aggregateRows(ast, rows),
  };
}

function evaluateOneAst(
  ast: CustomQueryAst,
  source: CustomQuerySourceDefinition,
  sourceRows: readonly NormalizedCustomQueryRow[],
  options: Required<EvaluatorOptionDefaults> & Pick<CustomQueryEvaluationOptions, "range">,
): CustomQueryResult {
  try {
    const filteredRows = filterRowsForAst(ast, source, sourceRows, options.range);
    const limit = getEffectiveCustomQueryLimit(ast, options);
    const visualization = inferVisualization(ast);
    const base: CustomQueryResult = {
      query: ast.query,
      ok: true,
      source: ast.source,
      operation: ast.operation,
      metric: ast.metric,
      groupBy: ast.groupBy,
      trendBy: ast.trendBy,
      visualization,
    };

    if (ast.trendBy) {
      const trendResult = evaluateTrendQuery(ast, filteredRows, limit, options);
      const result = {
        ...base,
        ...trendResult,
      };
      return {
        ...result,
        warnings: buildWarnings(ast, source, result, options),
      };
    }

    if (ast.groupBy) {
      const grouped = new Map<string, number>();
      for (const row of filteredRows) {
        const label = formatLabel(row[ast.groupBy], options.emptyLabel);
        const value = ast.operation === "count" ? 1 : coerceNumericValue(row[ast.metric!], ast.metric!);
        addToMap(grouped, label, value);
      }

      const rows = sortValueRows(mapToRows(grouped)).slice(0, limit);
      const result = {
        ...base,
        rows,
        value: aggregateRows(ast, filteredRows),
      };
      return {
        ...result,
        warnings: buildWarnings(ast, source, result, options),
      };
    }

    const value = aggregateRows(ast, filteredRows);
    const result = {
      ...base,
      value,
      rows: [{ label: ast.operation === "count" ? "count" : ast.metric!, value }],
    };

    if (visualization === "table" || visualization === "bar" || visualization === "pie") {
      result.rows = sortLabelRows(result.rows);
    }

    return {
      ...result,
      warnings: buildWarnings(ast, source, result, options),
    };
  } catch (error) {
    return {
      query: ast.query,
      ok: false,
      source: ast.source,
      operation: ast.operation,
      metric: ast.metric,
      groupBy: ast.groupBy,
      trendBy: ast.trendBy,
      visualization: inferVisualization(ast),
      error: error instanceof Error ? error.message : "Query evaluation failed.",
    };
  }
}

function errorResult(query: string, error: string): CustomQueryResult {
  return {
    query,
    ok: false,
    error,
  };
}

async function loadSourceRows<Context>(
  registry: CustomQuerySourceRegistry<Context>,
  sourceName: string,
  asts: CustomQueryAst[],
  input: EvaluateCustomQueriesInput<Context>,
  options: Required<EvaluatorOptionDefaults> & Pick<CustomQueryEvaluationOptions, "range">,
): Promise<NormalizedCustomQueryRow[]> {
  const source = registry[sourceName]!;
  const rawRows = input.rowsBySource?.[sourceName];

  if (rawRows) {
    return asNormalizedRows(rawRows, source);
  }

  if (!source.fetch) {
    throw new Error(`Source "${sourceName}" needs rowsBySource data or a fetch adapter.`);
  }

  const fetchRange = combineRanges(asts.map((ast) => ast.between ?? options.range));
  const fetched = await source.fetch({
    context: input.context as Context,
    source: sourceName,
    range: fetchRange,
    asts,
    limit: options.maxLimit,
  });

  return asNormalizedRows(fetched, source);
}

export async function evaluateCustomQueries<Context = unknown>(
  input: EvaluateCustomQueriesInput<Context>,
): Promise<CustomQueryResult[]> {
  const options = withOptionDefaults(input.options);
  const rangeError = validateCustomQueryRange(options.range, options.maxRangeDays);
  const queryInputs = normalizeQueryInputs(input.queries);

  if (queryInputs.length === 0) {
    return [errorResult("", "Query cannot be empty.")];
  }

  if (rangeError) {
    return queryInputs.map((query) => errorResult(query.query, rangeError));
  }

  const parsedLines: ParsedLine[] = queryInputs.map((queryInput) => {
    const parsed = parseAndValidateCustomQuery(
      queryInput.query,
      input.registry,
      options,
      { visualization: queryInput.visualization },
    );

    return parsed.ok
      ? {
          query: queryInput.query,
          ast: parsed.ast,
        }
      : {
          query: queryInput.query,
          error: parsed.error,
        };
  });

  const validAsts = parsedLines
    .map((line) => line.ast)
    .filter((ast): ast is CustomQueryAst => Boolean(ast));
  const astsBySource = new Map<string, CustomQueryAst[]>();

  for (const ast of validAsts) {
    const asts = astsBySource.get(ast.source) ?? [];
    asts.push(ast);
    astsBySource.set(ast.source, asts);
  }

  const rowsBySource = new Map<string, NormalizedCustomQueryRow[]>();
  const sourceErrors = new Map<string, string>();

  await Promise.all(
    [...astsBySource.entries()].map(async ([sourceName, asts]) => {
      try {
        rowsBySource.set(
          sourceName,
          await loadSourceRows(input.registry, sourceName, asts, input, options),
        );
      } catch (error) {
        sourceErrors.set(
          sourceName,
          error instanceof Error ? error.message : "Failed to fetch query source.",
        );
      }
    }),
  );

  return parsedLines.map((line) => {
    if (!line.ast) {
      return errorResult(line.query, line.error ?? "Query parsing failed.");
    }

    const sourceError = sourceErrors.get(line.ast.source);
    if (sourceError) {
      return errorResult(line.query, sourceError);
    }

    return evaluateOneAst(
      line.ast,
      input.registry[line.ast.source]!,
      rowsBySource.get(line.ast.source) ?? [],
      options,
    );
  });
}
