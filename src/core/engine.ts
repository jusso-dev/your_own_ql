import { evaluateCustomQueries } from "./evaluator";
import { getCustomQueryAutocompleteData } from "./registry";
import { parseAndValidateCustomQuery, parseAndValidateCustomQueryLines } from "./parser";
import {
  DEFAULT_CUSTOM_QUERY_LIMIT,
  DEFAULT_PIE_GROUP_WARNING_THRESHOLD,
  MAX_CUSTOM_QUERY_LIMIT,
  MAX_CUSTOM_QUERY_RANGE_DAYS,
  type CreateCustomQueryEngineInput,
  type CustomQueryEngine,
} from "./types";

const DEFAULT_EMPTY_LABEL = "(blank)";

export function createCustomQueryEngine<Context = unknown>(
  input: CreateCustomQueryEngineInput<Context>,
): CustomQueryEngine<Context> {
  const templates = [...(input.templates ?? [])];
  const options = {
    maxRangeDays: input.options?.maxRangeDays ?? MAX_CUSTOM_QUERY_RANGE_DAYS,
    maxLimit: input.options?.maxLimit ?? MAX_CUSTOM_QUERY_LIMIT,
    defaultLimit: input.options?.defaultLimit ?? DEFAULT_CUSTOM_QUERY_LIMIT,
    pieGroupWarningThreshold:
      input.options?.pieGroupWarningThreshold ?? DEFAULT_PIE_GROUP_WARNING_THRESHOLD,
    emptyLabel: input.options?.emptyLabel ?? DEFAULT_EMPTY_LABEL,
  };

  return {
    registry: input.registry,
    templates,
    options,
    parse(query, override) {
      return parseAndValidateCustomQuery(query, input.registry, options, override);
    },
    parseLines(queryText) {
      return parseAndValidateCustomQueryLines(queryText, input.registry, options);
    },
    evaluate(evaluateInput) {
      return evaluateCustomQueries({
        ...evaluateInput,
        registry: input.registry,
        options: {
          ...options,
          ...evaluateInput.options,
        },
      });
    },
    autocomplete() {
      return getCustomQueryAutocompleteData(input.registry, templates);
    },
  };
}
