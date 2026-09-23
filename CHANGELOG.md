# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Bump `vitest` from `2.1.9` to `5.0.1` to clear 6 of 7 outstanding security
  advisories surfaced by `pnpm audit` on CI (PR #16). `vite` is now pinned to
  `^6.4.3` and `esbuild` to `^0.25.0` via `pnpm.overrides` so vitest's
  transitive `vite@5.4.21` no longer carries the `server.fs.deny` bypass, the
  `launch-editor` NTLMv2 hash disclosure, the optimized-deps `.map` path
  traversal, or the dev-server CSRF advisory. Remaining advisories: 0
  (`pnpm audit --audit-level high` exits 0).
