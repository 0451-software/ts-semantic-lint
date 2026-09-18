/**
 * `--version` command — print the package version and exit.
 *
 * The version comes from the `version` field on `CommandContext`
 * (resolved by `runCli()` from `package.json`). Output goes to stdout
 * (matching `tsc --version` / `cargo --version` conventions).
 */
import { ExitCode } from "../exit-codes.js";
import type { CommandContext } from "../options.js";

export async function runVersion(ctx: CommandContext): Promise<number> {
  ctx.streams.stdout.write(`${ctx.version}\n`);
  return ExitCode.Success;
}
