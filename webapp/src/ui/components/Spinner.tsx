// Inline busy spinner for in-flight action buttons (#16 follow-up). Inherits the
// button's text colour via `currentColor`; sizing/animation live in app.css.
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
