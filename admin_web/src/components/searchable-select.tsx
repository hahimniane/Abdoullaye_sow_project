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
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
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
      {open && !disabled && (
        <div
          aria-label={listLabel}
          className="customer-searchable-options"
          id={listId}
          role="listbox"
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
        </div>
      )}
    </div>
  );
}
