// Pure filtering/highlighting/keyboard-index logic for the Combobox component
// (repo-autocomplete regression fix). The repo field used to be a native
// `<datalist>` — unstyleable, no open affordance, inconsistent keyboard
// behaviour across browsers. The replacement is a real combobox; this module
// is the framework-free half of it (filtering, match highlighting, active-index
// math, empty-state classification), matching the split forms.ts/badges.ts
// already use — components only render what these functions return.

/** Options whose value contains `query` anywhere, case-insensitively. Empty
 * query matches everything (the on-focus "show me everything" state). */
export function filterOptions(options: readonly string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...options];
  return options.filter((o) => o.toLowerCase().includes(q));
}

export type HighlightSegment = { text: string; matched: boolean };

/** Split `option` into segments so the first case-insensitive match of `query`
 * can be rendered highlighted. Returns a single unmatched segment when the
 * query is empty or doesn't occur (defensive — callers only highlight options
 * `filterOptions` already matched). */
export function highlightMatch(option: string, query: string): HighlightSegment[] {
  const q = query.trim();
  if (q === "") return [{ text: option, matched: false }];
  const idx = option.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return [{ text: option, matched: false }];

  const segments: HighlightSegment[] = [];
  if (idx > 0) segments.push({ text: option.slice(0, idx), matched: false });
  segments.push({ text: option.slice(idx, idx + q.length), matched: true });
  if (idx + q.length < option.length) {
    segments.push({ text: option.slice(idx + q.length), matched: false });
  }
  return segments;
}

/**
 * Next active index for ArrowDown (`direction: 1`) / ArrowUp (`direction: -1`),
 * wrapping around both ends. `current: -1` means "nothing highlighted yet" —
 * ArrowDown lands on the first option, ArrowUp on the last (so a single key
 * press from a fresh open always reaches a real option, not a no-op).
 * `length: 0` always yields -1 (nothing to highlight).
 */
export function moveActiveIndex(current: number, direction: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current === -1) return direction === 1 ? 0 : length - 1;
  return (current + direction + length) % length;
}

export type ComboboxEmptyState = "no-options" | "no-matches" | null;

/** Which honest empty state (if any) the dropdown should show: no options were
 * ever available (e.g. no repos loaded), vs. the current filter matches none
 * of the options that do exist. `null` means render the option list. */
export function comboboxEmptyState(
  totalOptions: number,
  filtered: readonly string[],
): ComboboxEmptyState {
  if (totalOptions === 0) return "no-options";
  if (filtered.length === 0) return "no-matches";
  return null;
}
