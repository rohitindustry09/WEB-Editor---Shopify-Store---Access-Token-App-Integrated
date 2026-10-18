"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon, Labelled, Popover } from "@shopify/polaris";
import { CheckIcon, SelectIcon } from "@shopify/polaris-icons";

export interface SelectOption {
  label: string;
  value: string;
  disabled?: boolean;
  /** A smaller second line under the label. */
  helpText?: string;
}

export interface SelectProps {
  label: string;
  /** Hides the visible label (it is still read by assistive tech). */
  labelHidden?: boolean;
  /** Shows the label inside the field, before the chosen value. */
  labelInline?: boolean;
  options: ReadonlyArray<string | SelectOption>;
  value: string;
  onChange: (value: string, id: string) => void;
  disabled?: boolean;
  helpText?: string;
  error?: string;
  /** Shown when the current value matches no option. */
  placeholder?: string;
}

const TYPEAHEAD_RESET_MS = 700;

/**
 * The app's own dropdown, in place of the browser's built-in select list. Same props as Polaris's
 * Select, but the list is a glass panel under the field: rows that light up on hover, the
 * chosen one marked with a brass tick, and a chevron that turns while it is open.
 * Fully keyboard-driven (arrows, Home / End, Enter / Space, Esc, type-ahead) and announced as a
 * combobox with a listbox of options.
 */
export function Select({ label, labelHidden = false, labelInline = false, options, value, onChange, disabled = false, helpText, error, placeholder = "Select…" }: SelectProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const typed = useRef({ text: "", at: 0 });

  const items = useMemo<SelectOption[]>(() => options.map((option) => (typeof option === "string" ? { label: option, value: option } : option)), [options]);
  const selectedIndex = items.findIndex((item) => item.value === value);
  const selected = selectedIndex >= 0 ? items[selectedIndex] : null;

  const nextEnabled = (from: number, step: 1 | -1): number => {
    for (let i = from + step; i >= 0 && i < items.length; i += step) if (!items[i].disabled) return i;
    return from;
  };
  const firstEnabled = () => items.findIndex((item) => !item.disabled);

  const openList = () => {
    if (disabled) return;
    setActive(selectedIndex >= 0 && !items[selectedIndex].disabled ? selectedIndex : firstEnabled());
    setOpen(true);
  };
  const closeList = () => setOpen(false);

  const choose = (index: number) => {
    const item = items[index];
    if (!item || item.disabled) return;
    onChange(item.value, id);
    closeList();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp": {
        event.preventDefault();
        if (!open) return openList();
        setActive((current) => nextEnabled(current < 0 ? (event.key === "ArrowDown" ? -1 : items.length) : current, event.key === "ArrowDown" ? 1 : -1));
        return;
      }
      case "Home":
      case "End":
        if (!open) return;
        event.preventDefault();
        setActive(event.key === "Home" ? firstEnabled() : nextEnabled(items.length, -1));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open && active >= 0) choose(active);
        else openList();
        return;
      case "Escape":
        if (open) {
          event.preventDefault();
          closeList();
        }
        return;
      case "Tab":
        closeList();
        return;
      default: {
        // Type-ahead: a few letters jump to the next option starting with them.
        if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
        const now = Date.now();
        typed.current = { text: (now - typed.current.at > TYPEAHEAD_RESET_MS ? "" : typed.current.text) + event.key.toLowerCase(), at: now };
        const from = open ? active : selectedIndex;
        const order = [...items.keys()].map((i) => (i + from + 1) % items.length);
        const match = order.find((i) => !items[i].disabled && items[i].label.toLowerCase().startsWith(typed.current.text));
        if (match === undefined) return;
        if (open) setActive(match);
        else onChange(items[match].value, id);
      }
    }
  };

  const button = (
    <button
      type="button"
      id={id}
      className="ui-select-button"
      data-open={open}
      data-error={Boolean(error)}
      disabled={disabled}
      role="combobox"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listId}
      aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
      aria-invalid={Boolean(error) || undefined}
      onClick={() => (open ? closeList() : openList())}
      onKeyDown={onKeyDown}
    >
      {labelInline && <span className="ui-select-inline-label">{label}</span>}
      <span className="ui-select-value" data-placeholder={!selected}>
        {selected ? selected.label : placeholder}
      </span>
      <span className="ui-select-chevron">
        <Icon source={SelectIcon} tone="inherit" />
      </span>
    </button>
  );

  return (
    <Labelled id={id} label={label} labelHidden={labelHidden || labelInline} helpText={helpText} error={error}>
      <Popover active={open} activator={button} onClose={closeList} fullWidth autofocusTarget="none" preventFocusOnClose>
        <Popover.Pane fixed>
          <div
            className="ui-select-list"
            id={listId}
            role="listbox"
            aria-label={label}
            ref={(node) => {
              // Keep the highlighted row in view while arrowing through a long list.
              node?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
            }}
          >
            {items.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <div
                  key={item.value + index}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={item.disabled || undefined}
                  className="ui-select-option"
                  data-active={index === active}
                  data-selected={isSelected}
                  data-disabled={item.disabled || undefined}
                  onMouseEnter={() => !item.disabled && setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span className="ui-select-option-text">
                    <span className="ui-select-option-label">{item.label}</span>
                    {item.helpText && <span className="ui-select-option-help">{item.helpText}</span>}
                  </span>
                  {isSelected && (
                    <span className="ui-select-tick">
                      <Icon source={CheckIcon} tone="inherit" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Popover.Pane>
      </Popover>
    </Labelled>
  );
}
