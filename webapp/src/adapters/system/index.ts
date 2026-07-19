// System adapters: the trivial real implementations of the deterministic ports
// the core takes for time and id generation (Clock, IdGenerator). Kept out of
// core (which stays framework-free and injects them) and out of the route
// modules. `newId` backs Account ids (which name the Account Config Volume)
// and Session UUIDs (SESSION_UUID for remote-control pairing). `newSecret` is
// for per-Session broker secrets — distinct so a secret is never a valid id.

import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "~/core";

export const systemClock: Clock = {
  now: () => new Date(),
};

export const uuidGenerator: IdGenerator = {
  newId: () => randomUUID(),
  newSecret: () => `bs_${randomUUID()}`,
};
