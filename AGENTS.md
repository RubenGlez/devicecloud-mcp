# AGENTS.md

This file provides guidance to Claude Code and other AI agents when working with this repository.

## Commands

```bash
pnpm install      # install deps and build dist/
pnpm build        # compile TypeScript → dist/
pnpm test         # run unit tests
```

## Releasing

```bash
pnpm version patch   # or minor / major
```

The `postversion` hook pushes the commit and tag automatically. The publish workflow on GitHub Actions fires from the tag and handles building, testing, and publishing to npm.
