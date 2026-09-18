export function greet(name: string): string {
  return `hello ${name}`;
}

export class Greeter {
  sayHi(target: string): string {
    return `hi ${target}`;
  }
}

export interface Greetable {
  greet(name: string): string;
}

export type Greeting = string;