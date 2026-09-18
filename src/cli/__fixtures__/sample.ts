/**
 * Fixture: a tiny TypeScript file the CLI's lint / dry-run paths can
 * point at without needing real project structure.
 */
export function greet(name: string): string {
  return `hello, ${name}`;
}
