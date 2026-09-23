# Changelog

All notable changes to this project are documented in this file. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project does not yet follow Semantic Versioning for releases, but new entries
should land under `## [Unreleased]` until a release is cut.

## [Unreleased]

### Fixed

- Exclude `tests/integration/` from the unit-test gate so PR CI no longer fails
  on `Error: ts-semantic-lint CLI not built. Run npm run build first (looked
  for dist/cli.js)`. The integration suite shells out to `dist/cli.js`; the
  build job and the unit-test job run on separate runners, so even with
  `needs: [build]` the artifact is not shared unless the build job uploads
  `dist/` for download. Adds a `test:unit` script (`vitest run --exclude
  '**/integration/**'`) and points the reusable-workflows unit-test gate at
  it. The live Jev suite still runs via the `integration-tests` gate on
  weekly cron + manual dispatch (where `TYPESAFE_API_KEY` is available). The
  structural reusable-workflows fix (build uploads `dist/`, unit-tests
  downloads it) is tracked separately as upstream PR #45 / kanban t_8e0a7b6c
  / t_55373397.

[Unreleased]: https://github.com/0451-software/ts-semantic-lint/compare/main...HEAD
