/**
 * Fixture for `comment-value`.
 *
 * `addNoisy` carries JSDoc that restates the function name and the
 * parameter types. The control `valuesBelow` has a comment that captures
 * a real invariant the type signature can't express.
 */

export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Adds two numbers together and returns the result.
 *
 * @param a the first number
 * @param b the second number
 * @returns the sum of a and b
 */
export function addNoisy(a: number, b: number): number {
  return a + b;
}

/**
 * `cutoff` is exclusive — values equal to it are NOT included.
 */
export function valuesBelow(values: ReadonlyArray<number>, cutoff: number): number[] {
  return values.filter((v) => v < cutoff);
}
