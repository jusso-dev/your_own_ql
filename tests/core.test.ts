import { describe, expect, it } from "vitest";
import {
  createCustomQueryEngine,
  defineCustomQueryRegistry,
  evaluateCustomQueries,
  parseAndValidateCustomQuery,
  type CustomQuerySourceRegistry,
} from "../src";

const registry = defineCustomQueryRegistry({
  incidents: {
    fields: ["type", "severity", "resolved", "recordedDay", "recordedMonth"],
    dateFields: ["recordedDay", "recordedMonth"],
    dateField: "recordedDay",
  },
  users: {
    fields: ["role", "isActive", "createdDay", "createdMonth"],
    dateFields: ["createdDay", "createdMonth"],
    dateField: "createdDay",
  },
  fuel_transactions: {
    fields: ["fuelType", "litres", "transactionDay", "transactionMonth"],
    numericFields: ["litres"],
    dateFields: ["transactionDay", "transactionMonth"],
    dateField: "transactionDay",
  },
} satisfies CustomQuerySourceRegistry);

describe("parser and allowlist validation", () => {
  it("parses count, sum, group, trend, limit, and chart clauses", () => {
    const count = parseAndValidateCustomQuery(
      "count from incidents group by severity chart bar",
      registry,
    );
    const sum = parseAndValidateCustomQuery(
      "sum litres from fuel_transactions between 2026-05-03 and 2026-06-02 group by fuelType trend by transactionDay limit 20 chart line",
      registry,
    );

    expect(count).toEqual({
      ok: true,
      ast: expect.objectContaining({
        operation: "count",
        source: "incidents",
        groupBy: "severity",
        visualization: "bar",
      }),
    });
    expect(sum).toEqual({
      ok: true,
      ast: expect.objectContaining({
        operation: "sum",
        metric: "litres",
        source: "fuel_transactions",
        between: { start: "2026-05-03", end: "2026-06-02" },
        groupBy: "fuelType",
        trendBy: "transactionDay",
        limit: 20,
        visualization: "line",
      }),
    });
  });

  it("supports group_by and trending aliases", () => {
    const grouped = parseAndValidateCustomQuery(
      "count from incidents group_by severity chart bar",
      registry,
    );
    const trending = parseAndValidateCustomQuery(
      "sum litres from fuel_transactions group_by fuelType trending_by transactionDay chart line",
      registry,
    );
    const spacedTrending = parseAndValidateCustomQuery(
      "count from incidents trending by recordedDay chart line",
      registry,
    );

    expect(grouped).toEqual({
      ok: true,
      ast: expect.objectContaining({
        groupBy: "severity",
        visualization: "bar",
      }),
    });
    expect(trending).toEqual({
      ok: true,
      ast: expect.objectContaining({
        groupBy: "fuelType",
        trendBy: "transactionDay",
        visualization: "line",
      }),
    });
    expect(spacedTrending).toEqual({
      ok: true,
      ast: expect.objectContaining({
        trendBy: "recordedDay",
        visualization: "line",
      }),
    });
  });

  it("rejects unknown sources and unknown fields", () => {
    expect(parseAndValidateCustomQuery("count from secrets", registry)).toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining("Unknown query source") }),
    );
    expect(
      parseAndValidateCustomQuery("count from incidents group by createdById", registry),
    ).toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining("Unknown group field") }),
    );
  });

  it("rejects SQL-like and cross-tenant malicious attempts", () => {
    const malicious = [
      "count from incidents; delete from incidents",
      "count from incidents where orgId = other_org",
      "count from incidents where createdById = user_123",
      "count from incidents where severity != LOW",
      "count from incidents join users",
      "count from incidents group by orgId",
      "sum passwordHash from users",
    ];

    for (const query of malicious) {
      expect(parseAndValidateCustomQuery(query, registry), query).toEqual(
        expect.objectContaining({ ok: false }),
      );
    }
  });

  it("enforces the one-year inclusive date range cap", () => {
    expect(
      parseAndValidateCustomQuery(
        "count from incidents between 2025-01-01 and 2026-01-02",
        registry,
      ),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        error: expect.stringContaining("Date ranges cannot exceed 366 days"),
      }),
    );
  });
});

describe("evaluator", () => {
  it("aggregates grouped count queries", async () => {
    const [result] = await evaluateCustomQueries({
      queries: "count from incidents group by severity chart bar",
      registry,
      rowsBySource: {
        incidents: [
          { severity: "HIGH", recordedDay: "2026-06-01" },
          { severity: "HIGH", recordedDay: "2026-06-02" },
          { severity: "LOW", recordedDay: "2026-06-02" },
        ],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        reportType: "grouped",
        visualization: "bar",
        rows: [
          { label: "HIGH", value: 2 },
          { label: "LOW", value: 1 },
        ],
      }),
    );
  });

  it("returns empty rows for an empty grouped result", async () => {
    const [result] = await evaluateCustomQueries({
      queries: "count from incidents group by severity chart table",
      registry,
      rowsBySource: {
        incidents: [],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        rows: [],
        value: 0,
      }),
    );
  });

  it("builds multi-series line chart results", async () => {
    const [result] = await evaluateCustomQueries({
      queries:
        "sum litres from fuel_transactions group by fuelType trend by transactionDay chart line",
      registry,
      rowsBySource: {
        fuel_transactions: [
          { fuelType: "DIESEL", litres: 120, transactionDay: "2026-06-01" },
          { fuelType: "DIESEL", litres: 80, transactionDay: "2026-06-02" },
          { fuelType: "PETROL", litres: 45, transactionDay: "2026-06-02" },
        ],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        reportType: "grouped_trend",
        trendBy: "transactionDay",
        groupBy: "fuelType",
        rows: [
          { label: "2026-06-01", value: 120 },
          { label: "2026-06-02", value: 125 },
        ],
        series: [
          {
            label: "DIESEL",
            rows: [
              { label: "2026-06-01", value: 120 },
              { label: "2026-06-02", value: 80 },
            ],
          },
          {
            label: "PETROL",
            rows: [
              { label: "2026-06-01", value: 0 },
              { label: "2026-06-02", value: 45 },
            ],
          },
        ],
      }),
    );
  });

  it("fills ranged trend buckets with zero values", async () => {
    const [result] = await evaluateCustomQueries({
      queries:
        "count from incidents between 2026-06-01 and 2026-06-03 trend_by recordedDay chart line",
      registry,
      rowsBySource: {
        incidents: [
          { severity: "HIGH", recordedDay: "2026-06-01" },
          { severity: "LOW", recordedDay: "2026-06-03" },
        ],
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        reportType: "trend",
        rows: [
          { label: "2026-06-01", value: 1 },
          { label: "2026-06-02", value: 0 },
          { label: "2026-06-03", value: 1 },
        ],
        series: [
          {
            label: "count",
            rows: [
              { label: "2026-06-01", value: 1 },
              { label: "2026-06-02", value: 0 },
              { label: "2026-06-03", value: 1 },
            ],
          },
        ],
      }),
    );
  });

  it("fetches only sources needed by parsed valid queries", async () => {
    const fetches: string[] = [];
    const engine = createCustomQueryEngine({
      registry: {
        incidents: {
          ...registry.incidents,
          fetch: async () => {
            fetches.push("incidents");
            return [{ severity: "LOW", recordedDay: "2026-06-01" }];
          },
        },
        users: {
          ...registry.users,
          fetch: async () => {
            fetches.push("users");
            return [];
          },
        },
      },
    });

    await engine.evaluate({
      queries: [
        "count from incidents group by severity",
        "count from missing_source group by role",
      ],
    });

    expect(fetches).toEqual(["incidents"]);
  });
});
