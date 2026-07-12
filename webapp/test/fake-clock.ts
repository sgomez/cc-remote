// Deterministic Clock for tests. Starts at a fixed instant; `advance` moves it.

import type { Clock } from "../src/core/ports/clock";

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date("2026-01-01T00:00:00.000Z")) {
    this.current = new Date(start.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
