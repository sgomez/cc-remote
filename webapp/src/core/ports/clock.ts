// Clock — injectable time source so use cases stay deterministic under test.

export interface Clock {
  now(): Date;
}
