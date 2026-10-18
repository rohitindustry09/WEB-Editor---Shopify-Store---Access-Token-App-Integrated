"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon, Modal, Text, TextField } from "@shopify/polaris";
import { SearchIcon } from "@shopify/polaris-icons";
import { flattenNav } from "./navItems";

const MAX_RESULTS = 12;

/**
 * "Search" in the sidebar (also Ctrl/⌘ + K): type a few letters of a page or tool,
 * pick it with the arrow keys or the mouse and press Enter to jump straight there.
 * It searches the app's own navigation, so it always matches what is in the sidebar.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const entries = useMemo(() => flattenNav(), []);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const needle = query.trim().toLowerCase();
  const results = (needle
    ? entries.filter((entry) => `${entry.group} ${entry.label}`.toLowerCase().includes(needle))
    : entries
  ).slice(0, MAX_RESULTS);
  const active = Math.min(highlight, Math.max(0, results.length - 1));

  const close = () => {
    setQuery("");
    setHighlight(0);
    onClose();
  };

  const go = (url: string) => {
    close();
    router.push(url);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight(Math.min(results.length - 1, active + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight(Math.max(0, active - 1));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      go(results[active].url);
    }
  };

  return (
    <Modal open={open} onClose={close} title="Search pages and tools" titleHidden size="small">
      <Modal.Section>
        <div onKeyDown={onKeyDown}>
          <TextField
            label="Search pages and tools"
            labelHidden
            autoFocus
            autoComplete="off"
            prefix={<Icon source={SearchIcon} />}
            placeholder="Search pages and tools…"
            value={query}
            onChange={(value) => {
              setQuery(value);
              setHighlight(0);
            }}
            clearButton
            onClearButtonClick={() => setQuery("")}
          />
          <div className="palette-results" role="listbox" aria-label="Matching pages">
            {results.length === 0 ? (
              <div className="palette-empty">
                <Text as="p" tone="subdued">{`Nothing matches "${query}".`}</Text>
              </div>
            ) : (
              results.map((entry, index) => (
                <button
                  key={entry.url + entry.label}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className="palette-result"
                  data-active={index === active}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => go(entry.url)}
                >
                  <span className="palette-label">{entry.label}</span>
                  {entry.group && <span className="palette-group">{entry.group}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      </Modal.Section>
    </Modal>
  );
}
