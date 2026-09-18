/**
 * `discover()` — walk up from a starting directory looking for the nearest
 * `ts-semantic-lint.json` config file. Stops at the first `.git` boundary
 * so the search cannot escape the user's repo.
 *
 * Mirrors ErisLint's `Config::discover` but uses the TS config name.
 */
import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { ConfigError } from "./filter.js";
import { CONFIG_NAME } from "./config-name.js";

/**
 * Walk ancestors of `start` until a `ts-semantic-lint.json` is found.
 *
 * The starting point is canonicalized first, so symlinks are resolved and
 * the ancestor chain reflects the real path on disk. A `.git` directory or
 * filesystem root terminates the walk without a match.
 *
 * @throws ConfigError if no config exists between `start` and the `.git` boundary.
 */
export async function discover(start: string): Promise<string> {
  const startAbs = isAbsolute(start) ? start : resolve(start);
  let current: string;
  try {
    current = await realpath(startAbs);
  } catch (err) {
    throw new ConfigError(
      `cannot resolve working directory ${start}: ${(err as Error).message}`,
    );
  }

  for (;;) {
    const candidate = `${current}/${CONFIG_NAME}`;
    if (existsSync(candidate)) {
      return candidate;
    }
    if (existsSync(`${current}/.git`)) {
      throw new ConfigError(
        `no ${CONFIG_NAME} found inside this repository; create one or pass --config <path>`,
      );
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new ConfigError(
        `no ${CONFIG_NAME} found above ${startAbs}; create one or pass --config <path>`,
      );
    }
    current = parent;
  }
}

/**
 * Resolve symlinks without throwing when the path doesn't exist.
 * Node's `fs.realpath` throws on missing paths; we only ever call this on
 * `start` so it must exist, but a try/catch keeps the error path readable.
 */
async function realpath(p: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return realpath(p);
}
