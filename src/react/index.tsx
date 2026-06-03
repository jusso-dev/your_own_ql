import { autocompletion, type Completion } from "@codemirror/autocomplete";
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import CodeMirror from "@uiw/react-codemirror";
import { tags } from "@lezer/highlight";
import {
  Eye,
  EyeOff,
  LayoutDashboard,
  Play,
  Save,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CUSTOM_QUERY_VISUALIZATIONS,
  getCustomQueryAutocompleteData,
  type CustomQueryRange,
  type CustomQueryResult,
  type CustomQueryResultRow,
  type CustomQuerySourceRegistry,
  type CustomQueryTemplate,
  type CustomQueryVisualization,
} from "../index";

export interface QueryWorkbenchPreviewInput {
  query: string;
  visualization?: CustomQueryVisualization;
  range?: CustomQueryRange;
}

export interface QueryWorkbenchSaveInput {
  name: string;
  query: string;
  visualization?: CustomQueryVisualization;
  showOnDashboard: boolean;
}

export interface CustomQueryLibraryItem {
  id: string;
  name: string;
  query: string;
  visualization?: CustomQueryVisualization;
  showOnDashboard: boolean;
  updatedAt?: string | Date;
}

export interface QueryWorkbenchProps {
  registry: CustomQuerySourceRegistry;
  templates?: readonly CustomQueryTemplate[];
  initialQuery?: string;
  initialRange?: CustomQueryRange;
  results?: readonly CustomQueryResult[];
  savedQueries?: readonly CustomQueryLibraryItem[];
  isPreviewing?: boolean;
  isSaving?: boolean;
  className?: string;
  onPreview?: (input: QueryWorkbenchPreviewInput) => void | Promise<void>;
  onSave?: (input: QueryWorkbenchSaveInput) => void | Promise<void>;
  onSelectSaved?: (query: CustomQueryLibraryItem) => void;
  onDeleteSaved?: (id: string) => void | Promise<void>;
  onToggleDashboard?: (id: string, showOnDashboard: boolean) => void | Promise<void>;
}

export interface CustomQueryVisualizationProps {
  result: CustomQueryResult;
  visualization?: CustomQueryVisualization;
  className?: string;
}

export interface CustomQueryDashboardWidgetProps {
  title: string;
  result: CustomQueryResult;
  visualization?: CustomQueryVisualization;
  onHide?: () => void;
  className?: string;
}

const CHART_COLORS = [
  "oklch(56% 0.18 245)",
  "oklch(61% 0.16 152)",
  "oklch(67% 0.17 54)",
  "oklch(58% 0.16 322)",
  "oklch(62% 0.14 23)",
  "oklch(59% 0.13 190)",
  "oklch(53% 0.15 285)",
  "oklch(69% 0.15 105)",
];

const qlLanguage = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match(/"(?:[^"]*)"/) || stream.match(/'(?:[^']*)'/)) {
      return "string";
    }

    if (stream.match(/\d{4}-\d{2}-\d{2}/) || stream.match(/[0-9]+(?:\.[0-9]+)?/)) {
      return "number";
    }

    if (
      stream.match(
        /\b(count|sum|from|between|and|where|group|by|trend|limit|chart|as)\b/i,
      )
    ) {
      return "keyword";
    }

    if (stream.match(/\b(number|table|bar|pie|line)\b/i)) {
      return "atom";
    }

    stream.next();
    return null;
  },
});

const qlHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--yoql-accent-strong)", fontWeight: "600" },
  { tag: tags.atom, color: "var(--yoql-success-strong)" },
  { tag: tags.number, color: "var(--yoql-warning-strong)" },
  { tag: tags.string, color: "var(--yoql-text)" },
]);

function createAutocompleteExtension(
  registry: CustomQuerySourceRegistry,
  templates: readonly CustomQueryTemplate[],
): Extension {
  const data = getCustomQueryAutocompleteData(registry, templates);
  const options: Completion[] = data.options.map((option) => ({
    label: option.label,
    type: option.type,
    detail: option.detail,
    apply: option.apply,
  }));

  return autocompletion({
    override: [
      (context) => {
        const word = context.matchBefore(/[\w_]+/);

        if (!context.explicit && (!word || word.from === word.to)) {
          return null;
        }

        return {
          from: word?.from ?? context.pos,
          options,
          validFor: /^[\w_]*$/,
        };
      },
    ],
  });
}

function formatNumber(value: number | undefined): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function firstResult(results: readonly CustomQueryResult[] | undefined): CustomQueryResult | undefined {
  return results?.[0];
}

function cx(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function ResultWarnings({ result }: { result: CustomQueryResult }): ReactNode {
  if (!result.warnings?.length) {
    return null;
  }

  return (
    <ul className="yoql-warnings" aria-label="Query warnings">
      {result.warnings.map((warning) => (
        <li key={warning}>{warning}</li>
      ))}
    </ul>
  );
}

function EmptyResult(): ReactNode {
  return <div className="yoql-empty">Run a preview to see aggregate results.</div>;
}

function ErrorResult({ result }: { result: CustomQueryResult }): ReactNode {
  return (
    <div className="yoql-error" role="status">
      {result.error ?? "Query failed."}
    </div>
  );
}

export function CustomQueryResultTable({
  result,
}: {
  result?: CustomQueryResult;
}): ReactNode {
  if (!result) {
    return <EmptyResult />;
  }

  if (!result.ok) {
    return <ErrorResult result={result} />;
  }

  const rows = result.rows?.length
    ? result.rows
    : [{ label: result.operation === "count" ? "count" : result.metric ?? "value", value: result.value ?? 0 }];

  return (
    <div className="yoql-table-wrap">
      <table className="yoql-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{formatNumber(row.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NumberVisualization({ result }: { result: CustomQueryResult }): ReactNode {
  return (
    <div className="yoql-number">
      <span>{formatNumber(result.value ?? result.rows?.[0]?.value ?? 0)}</span>
    </div>
  );
}

function BarVisualization({ rows }: { rows: CustomQueryResultRow[] }): ReactNode {
  return (
    <div className="yoql-chart" aria-label="Bar chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--yoql-grid)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <Tooltip />
          <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieVisualization({ rows }: { rows: CustomQueryResultRow[] }): ReactNode {
  return (
    <div className="yoql-chart" aria-label="Pie chart">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <Pie
            data={rows}
            dataKey="value"
            nameKey="label"
            innerRadius="52%"
            outerRadius="82%"
            paddingAngle={2}
          >
            {rows.map((row, index) => (
              <Cell
                key={row.label}
                fill={CHART_COLORS[index % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function getLineChartData(result: CustomQueryResult): {
  data: Array<Record<string, string | number>>;
  lines: Array<{ key: string; name: string }>;
} {
  if (!result.series?.length) {
    return {
      data: (result.rows ?? []).map((row) => ({ label: row.label, value: row.value })),
      lines: [{ key: "value", name: result.metric ?? result.operation ?? "value" }],
    };
  }

  const labels = [
    ...new Set(result.series.flatMap((series) => series.rows.map((row) => row.label))),
  ].sort((a, b) => a.localeCompare(b));
  const lines = result.series.map((series, index) => ({
    key: `series_${index}`,
    name: series.label,
  }));
  const data = labels.map((label) => {
    const item: Record<string, string | number> = { label };

    result.series!.forEach((series, index) => {
      item[`series_${index}`] =
        series.rows.find((row) => row.label === label)?.value ?? 0;
    });

    return item;
  });

  return { data, lines };
}

function LineVisualization({ result }: { result: CustomQueryResult }): ReactNode {
  const { data, lines } = getLineChartData(result);

  return (
    <div className="yoql-chart" aria-label="Line chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--yoql-grid)" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} />
          <YAxis tickLine={false} axisLine={false} width={48} />
          <Tooltip />
          {lines.length > 1 ? <Legend /> : null}
          {lines.map((line, index) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.name}
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CustomQueryVisualizationView({
  result,
  visualization,
  className,
}: CustomQueryVisualizationProps): ReactNode {
  if (!result.ok) {
    return <ErrorResult result={result} />;
  }

  const chart = visualization ?? result.visualization ?? "table";
  const rows = result.rows ?? [];

  return (
    <div className={cx("yoql-visual", className)}>
      {chart === "number" ? <NumberVisualization result={result} /> : null}
      {chart === "table" ? <CustomQueryResultTable result={result} /> : null}
      {chart === "bar" ? <BarVisualization rows={rows} /> : null}
      {chart === "pie" ? <PieVisualization rows={rows} /> : null}
      {chart === "line" ? <LineVisualization result={result} /> : null}
      <ResultWarnings result={result} />
    </div>
  );
}

function SavedQueryLibrary({
  savedQueries,
  onSelectSaved,
  onDeleteSaved,
  onToggleDashboard,
}: Pick<
  QueryWorkbenchProps,
  "savedQueries" | "onSelectSaved" | "onDeleteSaved" | "onToggleDashboard"
>): ReactNode {
  if (!savedQueries) {
    return null;
  }

  return (
    <aside className="yoql-library" aria-label="Saved queries">
      <div className="yoql-section-heading">
        <h3>Saved</h3>
      </div>
      {savedQueries.length === 0 ? (
        <div className="yoql-empty yoql-empty-small">No saved queries.</div>
      ) : (
        <ul className="yoql-library-list">
          {savedQueries.map((savedQuery) => (
            <li key={savedQuery.id} className="yoql-library-item">
              <button
                type="button"
                className="yoql-library-main"
                onClick={() => onSelectSaved?.(savedQuery)}
              >
                <span>{savedQuery.name}</span>
                <small>{savedQuery.query}</small>
              </button>
              <div className="yoql-library-actions">
                <button
                  type="button"
                  className="yoql-icon-button"
                  aria-label={
                    savedQuery.showOnDashboard
                      ? "Hide from dashboard"
                      : "Show on dashboard"
                  }
                  title={
                    savedQuery.showOnDashboard
                      ? "Hide from dashboard"
                      : "Show on dashboard"
                  }
                  onClick={() =>
                    onToggleDashboard?.(savedQuery.id, !savedQuery.showOnDashboard)
                  }
                >
                  {savedQuery.showOnDashboard ? (
                    <EyeOff aria-hidden size={16} />
                  ) : (
                    <Eye aria-hidden size={16} />
                  )}
                </button>
                <button
                  type="button"
                  className="yoql-icon-button"
                  aria-label="Delete saved query"
                  title="Delete saved query"
                  onClick={() => onDeleteSaved?.(savedQuery.id)}
                >
                  <Trash2 aria-hidden size={16} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

export function QueryWorkbench({
  registry,
  templates = [],
  initialQuery,
  initialRange,
  results,
  savedQueries,
  isPreviewing = false,
  isSaving = false,
  className,
  onPreview,
  onSave,
  onSelectSaved,
  onDeleteSaved,
  onToggleDashboard,
}: QueryWorkbenchProps): ReactNode {
  const [query, setQuery] = useState(initialQuery ?? templates[0]?.query ?? "");
  const [start, setStart] = useState(initialRange?.start ?? "");
  const [end, setEnd] = useState(initialRange?.end ?? "");
  const [saveName, setSaveName] = useState("");
  const [visualization, setVisualization] = useState<CustomQueryVisualization | "">("");
  const [showOnDashboard, setShowOnDashboard] = useState(false);
  const extensions = useMemo(
    () => [
      qlLanguage,
      syntaxHighlighting(qlHighlight),
      createAutocompleteExtension(registry, templates),
    ],
    [registry, templates],
  );
  const primaryResult = firstResult(results);
  const range = start && end ? { start, end } : undefined;

  return (
    <section className={cx("yoql-workbench", className)}>
      <div className="yoql-main">
        <div className="yoql-toolbar">
          <label className="yoql-field">
            <span>Template</span>
            <select
              value=""
              onChange={(event) => {
                const template = templates.find((item) => item.id === event.target.value);
                if (template) {
                  setQuery(template.query);
                  setSaveName(template.label);
                }
              }}
            >
              <option value="">Choose template</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label}
                </option>
              ))}
            </select>
          </label>
          <label className="yoql-field yoql-date">
            <span>Start</span>
            <input
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label className="yoql-field yoql-date">
            <span>End</span>
            <input
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
          <label className="yoql-field yoql-chart-select">
            <span>Visual</span>
            <select
              value={visualization}
              onChange={(event) =>
                setVisualization(event.target.value as CustomQueryVisualization | "")
              }
            >
              <option value="">From query</option>
              {CUSTOM_QUERY_VISUALIZATIONS.map((chart) => (
                <option key={chart} value={chart}>
                  {chart}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="yoql-editor-shell">
          <CodeMirror
            value={query}
            minHeight="180px"
            basicSetup={{
              lineNumbers: true,
              foldGutter: false,
              highlightActiveLine: true,
            }}
            extensions={extensions}
            onChange={setQuery}
          />
        </div>

        <div className="yoql-actions">
          <button
            type="button"
            className="yoql-button yoql-button-primary"
            disabled={isPreviewing || !query.trim()}
            onClick={() =>
              onPreview?.({
                query,
                range,
                visualization: visualization || undefined,
              })
            }
          >
            <Play aria-hidden size={16} />
            {isPreviewing ? "Previewing" : "Preview"}
          </button>
          {onSave ? (
            <div className="yoql-save-row">
              <input
                type="text"
                value={saveName}
                placeholder="Saved query name"
                onChange={(event) => setSaveName(event.target.value)}
              />
              <label className="yoql-checkbox">
                <input
                  type="checkbox"
                  checked={showOnDashboard}
                  onChange={(event) => setShowOnDashboard(event.target.checked)}
                />
                <LayoutDashboard aria-hidden size={16} />
                Dashboard
              </label>
              <button
                type="button"
                className="yoql-button"
                disabled={isSaving || !query.trim() || !saveName.trim()}
                onClick={() =>
                  onSave({
                    name: saveName,
                    query,
                    visualization: visualization || undefined,
                    showOnDashboard,
                  })
                }
              >
                <Save aria-hidden size={16} />
                {isSaving ? "Saving" : "Save"}
              </button>
            </div>
          ) : null}
        </div>

        <div className="yoql-results">
          <section className="yoql-result-panel">
            <div className="yoql-section-heading">
              <h3>Table</h3>
            </div>
            <CustomQueryResultTable result={primaryResult} />
          </section>
          <section className="yoql-result-panel">
            <div className="yoql-section-heading">
              <h3>Visual</h3>
            </div>
            {primaryResult ? (
              <CustomQueryVisualizationView
                result={primaryResult}
                visualization={visualization || undefined}
              />
            ) : (
              <EmptyResult />
            )}
          </section>
        </div>
      </div>

      <SavedQueryLibrary
        savedQueries={savedQueries}
        onSelectSaved={(savedQuery) => {
          setQuery(savedQuery.query);
          setSaveName(savedQuery.name);
          setVisualization(savedQuery.visualization ?? "");
          setShowOnDashboard(savedQuery.showOnDashboard);
          onSelectSaved?.(savedQuery);
        }}
        onDeleteSaved={onDeleteSaved}
        onToggleDashboard={onToggleDashboard}
      />
    </section>
  );
}

export function CustomQueryDashboardWidget({
  title,
  result,
  visualization,
  onHide,
  className,
}: CustomQueryDashboardWidgetProps): ReactNode {
  return (
    <article className={cx("yoql-widget", className)}>
      <header className="yoql-widget-header">
        <h3>{title}</h3>
        {onHide ? (
          <button
            type="button"
            className="yoql-icon-button"
            aria-label="Hide widget"
            title="Hide widget"
            onClick={onHide}
          >
            <EyeOff aria-hidden size={16} />
          </button>
        ) : null}
      </header>
      <CustomQueryVisualizationView
        result={result}
        visualization={visualization ?? result.visualization}
      />
    </article>
  );
}
