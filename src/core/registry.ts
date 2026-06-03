import {
  CUSTOM_QUERY_VISUALIZATIONS,
  type CustomQueryAutocompleteData,
  type CustomQueryAutocompleteOption,
  type CustomQuerySourceDefinition,
  type CustomQuerySourceRegistry,
  type CustomQueryTemplate,
  type CustomQueryVisualization,
} from "./types";

export const EXAMPLE_CUSTOM_QUERY_FIELDS_BY_SOURCE = {
  incidents: ["type", "severity", "resolved", "recordedDay", "recordedMonth"],
  users: ["role", "isActive", "createdDay", "createdMonth"],
  fuel_transactions: [
    "fuelType",
    "litres",
    "transactionDay",
    "transactionMonth",
  ],
} as const;

export function defineCustomQueryRegistry<Context, Registry extends CustomQuerySourceRegistry<Context>>(
  registry: Registry,
): Registry {
  return registry;
}

export function defineCustomQuerySource<Row = unknown, Context = unknown>(
  source: CustomQuerySourceDefinition<Row, Context>,
): CustomQuerySourceDefinition<Row, Context> {
  return source;
}

export function getSourceNames(registry: CustomQuerySourceRegistry): string[] {
  return Object.keys(registry).sort((a, b) => a.localeCompare(b));
}

export function resolveSourceName(
  registry: CustomQuerySourceRegistry,
  source: string,
): string | null {
  const direct = registry[source];
  if (direct) {
    return source;
  }

  const lower = source.toLowerCase();
  return getSourceNames(registry).find((name) => name.toLowerCase() === lower) ?? null;
}

export function resolveFieldName(
  source: CustomQuerySourceDefinition,
  field: string,
): string | null {
  const direct = source.fields.find((candidate) => candidate === field);
  if (direct) {
    return direct;
  }

  const lower = field.toLowerCase();
  return source.fields.find((candidate) => candidate.toLowerCase() === lower) ?? null;
}

export function isCustomQueryVisualization(
  value: unknown,
): value is CustomQueryVisualization {
  return (
    typeof value === "string" &&
    CUSTOM_QUERY_VISUALIZATIONS.includes(value as CustomQueryVisualization)
  );
}

export function getFieldsBySource(
  registry: CustomQuerySourceRegistry,
): Record<string, string[]> {
  return Object.fromEntries(
    getSourceNames(registry).map((source) => [
      source,
      [...registry[source]!.fields].sort((a, b) => a.localeCompare(b)),
    ]),
  );
}

export function getCustomQueryAutocompleteData(
  registry: CustomQuerySourceRegistry,
  templates: readonly CustomQueryTemplate[] = [],
): CustomQueryAutocompleteData {
  const sources = getSourceNames(registry);
  const fieldsBySource = getFieldsBySource(registry);
  const keywordOptions: CustomQueryAutocompleteOption[] = [
    "count",
    "sum",
    "from",
    "between",
    "and",
    "where",
    "group by",
    "group_by",
    "trend by",
    "trend_by",
    "trending by",
    "trending_by",
    "limit",
    "chart",
  ].map((label) => ({
    label,
    type: "keyword",
  }));

  const sourceOptions: CustomQueryAutocompleteOption[] = sources.map((source) => ({
    label: source,
    type: "source",
  }));

  const fieldOptions: CustomQueryAutocompleteOption[] = sources.flatMap((source) =>
    fieldsBySource[source]!.map((field) => ({
      label: field,
      type: "field",
      detail: source,
    })),
  );

  const chartOptions: CustomQueryAutocompleteOption[] = CUSTOM_QUERY_VISUALIZATIONS.map(
    (chart) => ({
      label: chart,
      type: "chart",
    }),
  );

  const templateOptions: CustomQueryAutocompleteOption[] = templates.map((template) => ({
    label: template.label,
    apply: template.query,
    detail: template.description,
    type: "template",
  }));

  return {
    sources,
    fieldsBySource,
    charts: [...CUSTOM_QUERY_VISUALIZATIONS],
    templates: [...templates],
    options: [
      ...keywordOptions,
      ...sourceOptions,
      ...fieldOptions,
      ...chartOptions,
      ...templateOptions,
    ],
  };
}
