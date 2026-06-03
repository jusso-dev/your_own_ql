export const CUSTOM_QUERY_VISUALIZATIONS = [
  "number",
  "table",
  "bar",
  "pie",
  "line",
] as const;

export const MAX_CUSTOM_QUERY_RANGE_DAYS = 366;
export const DEFAULT_CUSTOM_QUERY_LIMIT = 25;
export const MAX_CUSTOM_QUERY_LIMIT = 50;
export const DEFAULT_PIE_GROUP_WARNING_THRESHOLD = 8;

export type CustomQueryVisualization =
  (typeof CUSTOM_QUERY_VISUALIZATIONS)[number];

export type CustomQueryOperation = "count" | "sum";

export interface CustomQueryRange {
  start: string;
  end: string;
}

export interface CustomQueryWhereClause {
  field: string;
  value: string;
}

export interface CustomQueryAst {
  query: string;
  operation: CustomQueryOperation;
  source: string;
  metric?: string;
  between?: CustomQueryRange;
  where?: CustomQueryWhereClause;
  groupBy?: string;
  trendBy?: string;
  limit?: number;
  visualization?: CustomQueryVisualization;
}

export interface CustomQueryResultRow {
  label: string;
  value: number;
}

export interface CustomQueryResultSeries {
  label: string;
  rows: CustomQueryResultRow[];
}

export interface CustomQueryResult {
  query: string;
  ok: boolean;
  source?: string;
  operation?: CustomQueryOperation;
  metric?: string;
  groupBy?: string;
  trendBy?: string;
  visualization?: CustomQueryVisualization;
  value?: number;
  rows?: CustomQueryResultRow[];
  series?: CustomQueryResultSeries[];
  warnings?: string[];
  error?: string;
}

export type NormalizedCustomQueryValue =
  | string
  | number
  | boolean
  | Date
  | null
  | undefined;

export type NormalizedCustomQueryRow = Record<string, NormalizedCustomQueryValue>;

export interface CustomQueryFetchRequest<Context = any> {
  context: Context;
  source: string;
  range?: CustomQueryRange;
  asts: CustomQueryAst[];
  limit: number;
}

export interface CustomQuerySourceDefinition<Row = unknown, Context = any> {
  fields: readonly string[];
  numericFields?: readonly string[];
  dateFields?: readonly string[];
  dateField?: string;
  label?: string;
  snapshot?: boolean;
  fetch?: (request: CustomQueryFetchRequest<Context>) => Promise<readonly Row[]>;
  normalize?: (row: Row) => NormalizedCustomQueryRow;
}

export type CustomQuerySourceRegistry<Context = any> = Record<
  string,
  CustomQuerySourceDefinition<any, Context>
>;

export interface CustomQueryTemplate {
  id: string;
  label: string;
  description?: string;
  query: string;
}

export interface CustomQueryEvaluationOptions {
  range?: CustomQueryRange;
  maxRangeDays?: number;
  maxLimit?: number;
  defaultLimit?: number;
  pieGroupWarningThreshold?: number;
  emptyLabel?: string;
}

export interface CustomQueryEvaluationQuery {
  query: string;
  visualization?: CustomQueryVisualization;
}

export type CustomQueryEvaluationQueryInput =
  | string
  | CustomQueryEvaluationQuery;

export interface EvaluateCustomQueriesInput<Context = unknown> {
  queries: string | readonly CustomQueryEvaluationQueryInput[];
  registry: CustomQuerySourceRegistry<Context>;
  context?: Context;
  rowsBySource?: Record<string, readonly unknown[]>;
  options?: CustomQueryEvaluationOptions;
}

export interface CustomQueryParseSuccess {
  ok: true;
  ast: CustomQueryAst;
}

export interface CustomQueryParseFailure {
  ok: false;
  query: string;
  error: string;
}

export type CustomQueryParseResult =
  | CustomQueryParseSuccess
  | CustomQueryParseFailure;

export interface CustomQueryEngine<Context = unknown> {
  registry: CustomQuerySourceRegistry<Context>;
  templates: CustomQueryTemplate[];
  options: Required<
    Pick<
      CustomQueryEvaluationOptions,
      "maxRangeDays" | "maxLimit" | "defaultLimit" | "pieGroupWarningThreshold" | "emptyLabel"
    >
  >;
  parse: (
    query: string,
    override?: Partial<Pick<CustomQueryAst, "visualization">>,
  ) => CustomQueryParseResult;
  parseLines: (queryText: string) => CustomQueryParseResult[];
  evaluate: (
    input: Omit<EvaluateCustomQueriesInput<Context>, "registry">,
  ) => Promise<CustomQueryResult[]>;
  autocomplete: () => CustomQueryAutocompleteData;
}

export interface CreateCustomQueryEngineInput<Context = unknown> {
  registry: CustomQuerySourceRegistry<Context>;
  templates?: readonly CustomQueryTemplate[];
  options?: CustomQueryEvaluationOptions;
}

export interface CustomQueryAutocompleteOption {
  label: string;
  type:
    | "keyword"
    | "source"
    | "field"
    | "chart"
    | "template"
    | "operator";
  detail?: string;
  apply?: string;
}

export interface CustomQueryAutocompleteData {
  sources: string[];
  fieldsBySource: Record<string, string[]>;
  charts: CustomQueryVisualization[];
  templates: CustomQueryTemplate[];
  options: CustomQueryAutocompleteOption[];
}
