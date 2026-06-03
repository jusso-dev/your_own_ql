import type { CustomQuerySourceRegistry, CustomQueryTemplate } from "./types";

function hasSource(registry: CustomQuerySourceRegistry, source: string): boolean {
  return Boolean(registry[source]);
}

function hasField(
  registry: CustomQuerySourceRegistry,
  source: string,
  field: string,
): boolean {
  return Boolean(registry[source]?.fields.includes(field));
}

export function createPrebuiltCustomQueryTemplates(
  registry: CustomQuerySourceRegistry,
): CustomQueryTemplate[] {
  const templates: CustomQueryTemplate[] = [];

  if (
    hasSource(registry, "incidents") &&
    hasField(registry, "incidents", "severity")
  ) {
    templates.push({
      id: "incidents-by-severity",
      label: "Incidents by severity",
      description: "Incident counts grouped by severity.",
      query: "count from incidents group by severity chart bar",
    });
  }

  if (
    hasSource(registry, "fuel_transactions") &&
    hasField(registry, "fuel_transactions", "litres") &&
    hasField(registry, "fuel_transactions", "fuelType") &&
    hasField(registry, "fuel_transactions", "transactionDay")
  ) {
    templates.push({
      id: "fuel-litres-trend",
      label: "Fuel litres trend",
      description: "Fuel litres over time, split by fuel type.",
      query:
        "sum litres from fuel_transactions group by fuelType trend by transactionDay chart line",
    });
  }

  return templates;
}
