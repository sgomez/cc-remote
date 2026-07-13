// A real combobox (repo-autocomplete regression fix). The new-session repo
// field used to be a native `<datalist>`: unstyleable, no visible affordance
// that it was a dropdown, and inconsistent open/keyboard behaviour across
// browsers. This is a plain text input underneath — free text always
// submits — plus a filtered, keyboard-navigable listbox that opens on focus,
// per the ARIA 1.2 combobox pattern (role="combobox" on the input,
// aria-expanded/aria-controls/aria-activedescendant, role="listbox" +
// role="option" on the panel). All filtering/highlighting/index math is pure
// (~/ui/view-models/combobox) — this component only wires DOM events to it.
import { useId, useState } from "react";
import { comboboxEmptyState, filterOptions, highlightMatch } from "~/ui/view-models/combobox";

export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  noOptionsLabel = "No options available.",
  noMatchesLabel,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  placeholder?: string;
  /** Shown when `options` is empty outright (nothing was ever loaded). */
  noOptionsLabel?: string;
  /** Shown when the current filter matches none of `options`. Defaults to a
   * generic message quoting the typed text. */
  noMatchesLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();

  const filtered = filterOptions(options, value);
  const emptyState = comboboxEmptyState(options.length, filtered);
  const expanded = open && (filtered.length > 0 || emptyState !== null);
  const activeId = activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined;

  const select = (option: string) => {
    onChange(option);
    setOpen(false);
    setActiveIndex(-1);
  };

  const move = (direction: 1 | -1) => {
    setOpen(true);
    setActiveIndex((current) => {
      const length = filtered.length;
      if (length === 0) return -1;
      if (current === -1) return direction === 1 ? 0 : length - 1;
      return (current + direction + length) % length;
    });
  };

  return (
    <div className="combobox">
      <div className={`combobox-control${open ? " open" : ""}`}>
        <input
          id={id}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          className="combobox-input"
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            switch (e.key) {
              case "ArrowDown":
                e.preventDefault();
                move(1);
                break;
              case "ArrowUp":
                e.preventDefault();
                move(-1);
                break;
              case "Enter":
                if (open && activeIndex >= 0 && filtered[activeIndex] !== undefined) {
                  e.preventDefault();
                  select(filtered[activeIndex]);
                }
                break;
              case "Escape":
                if (open) {
                  e.preventDefault();
                  setOpen(false);
                }
                break;
              default:
                break;
            }
          }}
        />
        <span className="combobox-chevron" aria-hidden="true" />
      </div>
      {expanded && (
        // ARIA 1.2 "aria-activedescendant" combobox pattern: a listbox whose
        // options are deliberately NOT DOM-focusable — focus stays on the
        // input the whole time, and aria-activedescendant (plus each option's
        // id) is what tells assistive tech which option is "active"; all
        // keyboard handling lives on the input above, not per-option.
        <div id={listboxId} className="combobox-panel" role="listbox">
          {filtered.map((option, index) => (
            // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: see the comment above the listbox — options aren't DOM-focusable by design (aria-activedescendant pattern).
            <div
              key={option}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`combobox-option${index === activeIndex ? " active" : ""}`}
              // Keep focus on the input across a click (which would otherwise
              // fire blur before this option's onClick runs, closing the list
              // first and dropping the selection).
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(option)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {highlightMatch(option, value).map((segment) => (
                <span key={`${segment.matched}-${segment.text}`}>
                  {segment.matched ? <mark>{segment.text}</mark> : segment.text}
                </span>
              ))}
            </div>
          ))}
          {emptyState && (
            <div className="combobox-empty" role="presentation">
              {emptyState === "no-options"
                ? noOptionsLabel
                : (noMatchesLabel ?? `No matches for "${value.trim()}".`)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
