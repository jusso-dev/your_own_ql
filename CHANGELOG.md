# Changelog

All notable changes to this project will be documented in this file.

This project follows semantic versioning.

## 0.2.0 - 2026-06-03

- Added `group_by`, `trend_by`, and `trending_by` query-language aliases.
- Added explicit `reportType` metadata for summary, grouped, trend, and grouped trend results.
- Trend reports with a date range now include zero-value day or month buckets for missing periods.

## 0.1.0 - Unreleased

- Initial safe custom QL parser and evaluator.
- Next.js route-handler helpers for preview, saved query library, mutations, and dashboard widgets.
- React CodeMirror workbench and shared number, table, bar, pie, and line renderers.
- Focused tests for parser validation, malicious query rejection, aggregation, and scoped saved-query mutations.
