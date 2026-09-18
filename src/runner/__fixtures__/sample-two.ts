function double(n: number): number {
  return n * 2;
}

export function tripled(value: number): number {
  return double(value) + value;
}

export class Multiplier {
  multiply(a: number, b: number): number {
    return a * b;
  }
}

export type Pair = { left: number; right: number };