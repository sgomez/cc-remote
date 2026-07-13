import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const SECTION = /^\/(sessions|accounts)(?:\/|$)/;
const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function getRouter() {
  return createRouter({
    routeTree,
    // Every navigation runs through the View Transitions API
    // (document.startViewTransition) for list→detail morphs (#16). The shared
    // element morphs (sess-card-*/sess-title-*/…) are what carry the effect and
    // need none of this.
    //
    // The `types` branch below is a progressive enhancement that is currently
    // INERT: the router only passes types when
    // `CSS.supports("selector(:active-view-transition-type(a))")` is true, and
    // as of 2026-07 neither Chrome 149 nor Firefox 152 report support (verified
    // by logging what the router hands to startViewTransition — a bare function,
    // not `{update, types}`). It degrades to a plain cross-fade, so the
    // :active-view-transition-type rules in app.css are dormant until engines
    // report support. Don't add motion that depends on them.
    defaultViewTransition: {
      types: ({ fromLocation, toLocation, pathChanged }) => {
        if (!pathChanged || reduceMotion()) return false;
        const from = fromLocation?.pathname.match(SECTION)?.[1];
        const to = toLocation.pathname.match(SECTION)?.[1];
        if (from && from === to) return ["morph"]; // list↔detail: named morphs carry it
        const fromIdx = fromLocation?.state.__TSR_index ?? 0;
        const toIdx = toLocation.state.__TSR_index ?? 0;
        return [toIdx < fromIdx ? "backward" : "forward"];
      },
    },
    scrollRestoration: true,
    defaultErrorComponent: () => <div style={{ padding: 24 }}>Internal Server Error</div>,
    defaultNotFoundComponent: () => <div style={{ padding: 24 }}>Not Found</div>,
  });
}
