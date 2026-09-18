# ts-semantic-lint

Configurable TypeScript semantic linter powered by Jev. Send selected TypeScript source to
TypeSafe's Jev API as a model judgment, map answers to warnings or errors, render
Rust-style diagnostics.

> **Status:** rewrite in progress — see `/root/workspace/source/Eriskii--ErisLint` for the
> Rust original this is being ported from. License of the original is AGPL-3.0; this
> rewrite is MIT (no source reuse — same behavior, fresh implementation).

## Install

```bash
npm install -g ts-semantic-lint
```

## Usage

```bash
export jev_key='your-typesafe-api-key'
ts-semantic-lint --check-config
ts-semantic-lint --dry-run
ts-semantic-lint
```

See `docs/` (added as modules land) for the full command reference and configuration
schema.

## License

MIT — see `LICENSE`.
