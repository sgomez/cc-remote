// Pure view-transition typing for navigations. The router hands the result to
// `document.startViewTransition({ update, types })`, and the strings become
// `:active-view-transition-type(...)` selectors in app.css.
//
// Direction for a lateral move is the SIDEBAR's order, not the history index.
// History index only tells browser back from browser forward: every sidebar
// click is a push, so sessions→accounts and accounts→sessions both look like
// "forward" by that measure and the slide never mirrors — which defeats the
// whole point of a directional transition. Ordering by the menu gives the
// tab-strip feel instead: moving right in the sidebar slides in from the right,
// moving left slides in from the left.

/** Sidebar order. Index = position on the strip; direction is derived from it. */
export const SECTIONS = ["sessions", "accounts", "repositories"] as const;

export type Section = (typeof SECTIONS)[number];

/** The sidebar section a pathname belongs to, if any (`/login` belongs to none). */
export function sectionOf(pathname: string): Section | undefined {
  return SECTIONS.find((s) => pathname === `/${s}` || pathname.startsWith(`/${s}/`));
}

export type NavigationContext = {
  fromPath: string | undefined;
  toPath: string;
  /** The pathname actually changed (a pure search/hash change must not animate). */
  pathChanged: boolean;
  reducedMotion: boolean;
};

/**
 * View-transition types for a navigation, or `false` to skip the transition
 * entirely (the router then applies the update without one).
 *
 * - reduced motion / no path change → `false`, no transition at all.
 * - within one section (list↔detail) → `morph`: no page-level motion, because the
 *   shared elements (card→header, title, status pill) carry it themselves.
 * - between sections → `forward`/`backward` by sidebar order.
 * - anything off the sidebar (login) → no type: a plain cross-fade.
 */
export function navigationTypes(ctx: NavigationContext): string[] | false {
  if (!ctx.pathChanged || ctx.reducedMotion) return false;

  const from = ctx.fromPath ? sectionOf(ctx.fromPath) : undefined;
  const to = sectionOf(ctx.toPath);
  if (!from || !to) return [];
  if (from === to) return ["morph"];

  return [SECTIONS.indexOf(to) > SECTIONS.indexOf(from) ? "forward" : "backward"];
}
