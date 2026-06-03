import {
  MAX_CUSTOM_QUERY_RANGE_DAYS,
  type CustomQueryRange,
} from "./types";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY_RE.test(value)) {
    return null;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

export function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function toDateOnly(value: unknown): string | null {
  if (value instanceof Date) {
    return formatDateOnly(value);
  }

  if (typeof value === "string") {
    if (DATE_ONLY_RE.test(value)) {
      return parseDateOnly(value) ? value : null;
    }

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return formatDateOnly(date);
    }
  }

  return null;
}

export function getInclusiveRangeDays(range: CustomQueryRange): number | null {
  const start = parseDateOnly(range.start);
  const end = parseDateOnly(range.end);

  if (!start || !end) {
    return null;
  }

  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

export function validateCustomQueryRange(
  range: CustomQueryRange | undefined,
  maxRangeDays = MAX_CUSTOM_QUERY_RANGE_DAYS,
): string | null {
  if (!range) {
    return null;
  }

  const start = parseDateOnly(range.start);
  const end = parseDateOnly(range.end);

  if (!start || !end) {
    return "Date ranges must use valid YYYY-MM-DD dates.";
  }

  if (end.getTime() < start.getTime()) {
    return "Date range end must be on or after the start date.";
  }

  const days = getInclusiveRangeDays(range);
  if (!days || days > maxRangeDays) {
    return `Date ranges cannot exceed ${maxRangeDays} days.`;
  }

  return null;
}

export function combineRanges(
  ranges: Array<CustomQueryRange | undefined>,
): CustomQueryRange | undefined {
  const present = ranges.filter((range): range is CustomQueryRange => Boolean(range));

  if (present.length === 0 || present.length !== ranges.length) {
    return undefined;
  }

  return present.reduce<CustomQueryRange>(
    (combined, range) => ({
      start: range.start < combined.start ? range.start : combined.start,
      end: range.end > combined.end ? range.end : combined.end,
    }),
    present[0]!,
  );
}

export function isDateOnlyWithinRange(
  dateValue: string | null,
  range: CustomQueryRange,
): boolean {
  if (!dateValue) {
    return false;
  }

  return dateValue >= range.start && dateValue <= range.end;
}
