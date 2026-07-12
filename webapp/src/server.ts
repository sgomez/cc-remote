import handler, { createServerEntry } from "@tanstack/react-start/server-entry";

// TanStack Start server entry. Kept under src/ (not repo root) so it does not
// double as the Vite SSR input and trigger a dev-server warning.
export default createServerEntry({
  fetch(request) {
    return handler.fetch(request);
  },
});
