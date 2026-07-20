// Presentational badge components (#16). They render the pure view-model output
// (badges.ts / capabilities.ts) onto the legacy design-token classes — no logic
// of their own beyond a catalogue label lookup. `vtName` sets a
// `view-transition-name` so a badge morphs smoothly between list and detail and
// across a status flip.

import { findProviderType } from "~/core";
import type { StatusBadge } from "~/ui/view-models/badges";
import type { PermissionModeBadge } from "~/ui/view-models/permission-mode";

export function ProviderBadge({ providerType }: { providerType: string }) {
  const type = findProviderType(providerType);
  return (
    <span className={`badge provider provider-${providerType}`}>{type?.label ?? providerType}</span>
  );
}

export function StatusPill({ badge, vtName }: { badge: StatusBadge; vtName?: string }) {
  return (
    <span
      className={`status-badge ${badge.className}${badge.animated ? " animated" : ""}`}
      style={vtName ? { viewTransitionName: vtName } : undefined}
    >
      <span className="status-dot" />
      {badge.label}
    </span>
  );
}

/** The Session's Permission Mode. Renders nothing when the mode was never recorded. */
export function PermissionModePill({ badge }: { badge: PermissionModeBadge | null }) {
  if (!badge) return null;
  return <span className={`badge perm perm-${badge.tone}`}>{badge.label}</span>;
}

export function Capability({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`badge cap ${on ? "cap-on" : "cap-off"}`}>
      {on ? "✓" : "✗"} {label}
    </span>
  );
}
