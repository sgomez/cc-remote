// System adapters: the trivial real implementations of the deterministic ports
// the core takes for time and id generation (Clock, IdGenerator). Kept out of
// core (which stays framework-free and injects them) and out of the route
// modules. `newId` backs both Account ids (which name the Account Config Volume)
// and Session UUIDs (SESSION_UUID for remote-control pairing), so it must be a
// stable, collision-free, volume-name-safe token — a v4 UUID satisfies all.

import { randomUUID } from "node:crypto";
import type { Clock, IdGenerator } from "~/core";

export const systemClock: Clock = {
  now: () => new Date(),
};

export const uuidGenerator: IdGenerator = {
  newId: () => randomUUID(),
};
