# Contributing

## Requirements

- Node.js 18.17 or newer.
- npm 9 or newer.

## Setup

```bash
npm ci
```

## Development

```bash
npm test
npm run typecheck
npm run lint
```

## Release Checks

Run the full package validation before opening a release PR:

```bash
npm run validate
```

This checks whitespace, TypeScript, ESLint, tests, npm audit, build output, and the publish tarball contents.

## Dependency Changes

This repo uses `.npmrc` supply-chain guardrails inspired by `depshield-cli`:

- freshly published package versions are delayed
- dependency lifecycle scripts are disabled by default
- Git dependencies are restricted
- newly saved packages use exact versions
- peer dependency conflicts fail installs

After changing dependencies, run:

```bash
npm run security:install
npm run security:lockfile
npm run audit:security
npm run validate
```

Review `package-lock.json` diffs carefully. Avoid broad update commands unless that is the explicit purpose of the change.

## Publishing

Publishing should happen from the GitHub Actions publish workflow after a GitHub release is published. Configure npm trusted publishing for `jusso-dev/your_own_ql` before relying on that workflow.

For manual emergency publishes, use:

```bash
npm publish --provenance --access public --ignore-scripts=false
```

Do not publish without running `npm run validate`.
