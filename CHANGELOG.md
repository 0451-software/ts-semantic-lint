# Changelog

All notable changes to this project are documented in this file. The format is
loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this
project does not yet follow Semantic Versioning for releases, but new entries
should land under `## [Unreleased]` until a release is cut.

## [Unreleased]

### Fixed

- Format repo with prettier so CI's `prettier --check` gate passes on PRs.
  Adds `.prettierignore` (lockfile + test fixtures) and reformats 53 source
  files. No semantic changes.

[Unreleased]: https://github.com/0451-software/ts-semantic-lint/compare/main...HEAD
