// Deterministic IdGenerator for tests: predictable, sequential ids.

import type { IdGenerator } from "../src/core/ports/id-generator";

export class FakeIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = "id") {}

  newId(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter}`;
  }
}
