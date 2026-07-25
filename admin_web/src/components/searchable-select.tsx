"use client";

import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Search } from "lucide-react";

import {
  filterSearchableOptions,
  type SearchableOption,
} from "@/lib/searchable-options";

export function SearchableSelect({
  className = "",
  clearOnSearch = false,
  dataField,
  disabled = false,
  emptyMessage,
  hideLabel = false,
  id,
  invalid = false,
  label,
  listLabel,
  name,
  onChange,
  options,
  placeholder,
  required = false,
  value,
}: {
  className?: string;
  clearOnSearch?: boolean;
  dataField?: string;
  disabled?: boolean;
  emptyMessage: string;
  hideLabel?: boolean;
  id?: string;
  invalid?: boolean;
  label: string;
  listLabel: string;
  name?: string;
  onChange: (value: string) => void;
  options: readonly SearchableOption[];
  placeholder: string;
  required?: boolean;
  value: string;
}) {
  const generatedInputId = useId();
  const inputId = id ?? generatedInputId;
  const listId = useId();
  const editingRef = useRef(false);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dropdown, setDropdown] = useState<{
    left: number;
    width: number;
    maxHeight: number;
    placement: "below" | "above";
    // Viewport-relative, paired with the CSS property matching `placement`
    // (top when below the field, bottom when above it) so the fixed-position
    // popup tracks the field regardless of scroll position.
    offset: number;
  } | null>(null);
  const selected = options.find((option) => option.value === value);
  const selectedText = selected?.selectedLabel ?? selected?.label ?? "";
  const filterQuery = selectedText === query ? "" : query;
  const filtered = useMemo(
    () => filterSearchableOptions(options, filterQuery),
    [filterQuery, options],
  );
  const activeOption = filtered[activeIndex];

  useEffect(() => {
    if (value) {
      setQuery(selectedText);
    } else if (!editingRef.current) {
      setQuery("");
    }
    editingRef.current = false;
    setActiveIndex(0);
  }, [selectedText, value]);

  useEffect(() => {
    if (open) {
      optionRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  // The options list can open inside any card/panel, and most of those
  // panels use `overflow: hidden` for their rounded corners - so an
  // absolutely-positioned dropdown gets hard-clipped at the panel's edge
  // long before it runs out of actual screen space, leaving only a sliver
  // visible no matter how much room the viewport has. Rendering the list
  // through a portal with viewport-relative fixed coordinates (computed from
  // the field's own position, flipping above and shrinking to fit whichever
  // side has more room) sidesteps every ancestor's overflow/stacking context
  // entirely, the same way a native <select> escapes its container.
  useEffect(() => {
    if (!open) return;
    const preferredHeight = 260;
    const minHeight = 120;
    const viewportMargin = 12;

    function updatePosition() {
      const element = wrapperRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - viewportMargin;
      const spaceAbove = rect.top - viewportMargin;
      if (spaceBelow >= minHeight || spaceBelow >= spaceAbove) {
        setDropdown({
          offset: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          placement: "below",
          maxHeight: Math.max(minHeight, Math.min(preferredHeight, spaceBelow)),
        });
      } else {
        setDropdown({
          offset: window.innerHeight - rect.top + 4,
          left: rect.left,
          width: rect.width,
          placement: "above",
          maxHeight: Math.max(minHeight, Math.min(preferredHeight, spaceAbove)),
        });
      }
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  function choose(option: SearchableOption) {
    editingRef.current = false;
    setQuery(option.selectedLabel ?? option.label);
    setOpen(false);
    setActiveIndex(0);
    onChange(option.value);
  }

  function close(event: FocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setOpen(false);
    if (selected) setQuery(selectedText);
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        open
          ? Math.min(current + 1, Math.max(filtered.length - 1, 0))
          : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        open ? Math.max(current - 1, 0) : Math.max(filtered.length - 1, 0),
      );
    } else if (event.key === "Enter" && open && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Escape") {
      setOpen(false);
      setQuery(selectedText);
    } else if (event.key === "Tab") {
      setOpen(false);
      setQuery(selectedText);
    }
  }

  return (
    <div
      className={`customer-searchable-select ${className}`.trim()}
      onBlur={close}
      ref={wrapperRef}
    >
      <label className={hideLabel ? "sr-only" : undefined} htmlFor={inputId}>
        {label}
      </label>
      <div className="customer-searchable-control">
        <Search aria-hidden="true" size={18} />
        <input
          aria-activedescendant={
            open && activeOption
              ? `${listId}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-invalid={invalid}
          autoComplete="off"
          data-pool-field={dataField}
          disabled={disabled}
          id={inputId}
          name={name}
          onChange={(event) => {
            editingRef.current = true;
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            if (clearOnSearch && value) onChange("");
          }}
          onFocus={(event) => {
            setOpen(true);
            event.currentTarget.select();
          }}
          onKeyDown={keyDown}
          placeholder={placeholder}
          required={required}
          role="combobox"
          value={query}
        />
        <ChevronDown aria-hidden="true" size={18} />
      </div>
      {open &&
        !disabled &&
        dropdown &&
        createPortal(
          <div
            aria-label={listLabel}
            className="customer-searchable-options customer-searchable-options-portal"
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              left: dropdown.left,
              width: dropdown.width,
              maxHeight: dropdown.maxHeight,
              ...(dropdown.placement === "above"
                ? { bottom: dropdown.offset }
                : { top: dropdown.offset }),
            }}
          >
            {filtered.length === 0 ? (
              <p>{emptyMessage}</p>
            ) : (
              filtered.map((option, index) => (
                <button
                  aria-selected={option.value === value}
                  className={
                    index === activeIndex ? "active" : undefined
                  }
                  id={`${listId}-option-${index}`}
                  key={option.value}
                  onClick={() => choose(option)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  {option.label}
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
