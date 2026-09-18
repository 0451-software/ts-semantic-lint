/**
 * Fixture for `function-simplicity`.
 *
 * `formatUser` does an avoidable boolean-toggle dance between two
 * near-identical branches. The control `summarizeUsers` is the same
 * length, but every line carries its weight.
 */

export interface User {
  readonly id: string;
  readonly name: string;
  readonly active: boolean;
}

export function formatUser(user: User, verbose: boolean): string {
  let result: string;
  if (verbose) {
    result = `${user.name} (${user.id})`;
  } else {
    result = user.name;
  }
  if (user.active) {
    result = result + " *";
  }
  return result;
}

export function summarizeUsers(users: ReadonlyArray<User>): string {
  const active = users.filter((u) => u.active).length;
  const inactive = users.length - active;
  return `${active} active, ${inactive} inactive`;
}
