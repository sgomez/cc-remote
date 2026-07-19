// Deterministic IdGenerator for tests: predictable, sequential ids.

import type { IdGenerator } from "../src/core/ports/id-generator";

export class FakeIdGenerator implements IdGenerator {
  private idCounter = 0;
  private secretCounter = 0;

  constructor(private readonly prefix = "id") {}

  newId(): string {
    this.idCounter += 1;
    return `${this.prefix}-${this.idCounter}`;
  }

  newSecret(): string {
    this.secretCounter += 1;
    return `secret-${this.prefix}-${this.secretCounter}`;
  }
}
