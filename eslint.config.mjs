// ESLint v10 flat config for ts-semantic-lint.
//
// Kept intentionally minimal: the project's style is enforced by Prettier, and
// `tsc --strict` (see tsconfig.json) catches most type-level mistakes. ESLint
// here adds the language-level rules that TypeScript can't express (unused
// vars, shadowing, equality discipline, etc.).
//
// References:
//   - https://eslint.org/docs/latest/use/configure/configuration-files
//   - https://typescript-eslint.io/getting-started
//   - https://eslint.org/docs/latest/use/migrate-to-10.0.0

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Repo-wide ignores that should never be linted.
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "**/*.d.ts",
      // Test fixtures are intentionally malformed samples for the linter-under-test
      // to consume; they would otherwise generate a flood of false positives.
      "**/__fixtures__/**",
      // Integration tests live under tests/ and exercise the live Jev API; they're
      // gated separately by the reusable workflow and skip unit-test runs.
      "tests/integration/**",
    ],
  },
  // Base recommended ruleset for plain ECMAScript.
  js.configs.recommended,
  // TypeScript-aware recommended ruleset. No TypeChecked variant: the project
  // is a small (~10k LOC) library and the speed penalty of typed linting isn't
  // worth it on CI; `tsc --noEmit` already runs as a separate gate.
  ...tseslint.configs.recommended,
  {
    // Project-wide overrides / tweaks.
    rules: {
      // The codebase uses `_`-prefixed unused args for destructured params where
      // the position is meaningful (e.g. `(_, index) => ...` in test files).
      // The default `argsIgnorePattern: "^_"` covers those.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // The codebase intentionally re-exports dynamic imports onto `globalThis`
      // (see src/index.ts) for embedders that want runtime access without a
      // top-level export. ESLint v10 turns `no-shadow-restricted-names` on by
      // default for `globalThis`; writing to it isn't shadowing so disable.
      "no-shadow-restricted-names": "off",
    },
  },
);
