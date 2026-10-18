"use client";

import { ActionList, Icon, Popover } from "@shopify/polaris";
import {
  MoonIcon,
  SunIcon,
  DesktopIcon,
  SelectIcon,
} from "@shopify/polaris-icons";
import { useState } from "react";
import { useThemeMode, type ThemeMode } from "./ThemeContext";
import { useCursorEnabled } from "@/lib/cursorPreference";

const OPTIONS: { mode: ThemeMode; label: string; icon: typeof SunIcon }[] = [
  { mode: "light", label: "Light", icon: SunIcon },
  { mode: "dark", label: "Dark", icon: MoonIcon },
  { mode: "system", label: "Match system", icon: DesktopIcon },
];

export function ThemeToggle() {
  const { mode, resolved, setMode } = useThemeMode();
  const [open, setOpen] = useState(false);
  const [cursorEnabled, setCursorEnabled] = useCursorEnabled();

  const current = OPTIONS.find((option) => option.mode === mode) ?? OPTIONS[2];
  const shortLabel = current.mode === "system" ? "System" : current.label;

  return (
    <div className="topbar-theme">
      <Popover
        active={open}
        onClose={() => setOpen(false)}
        activator={
          <button
            type="button"
            className="topbar-theme-button"
            aria-label="Theme settings"
            title={`Theme: ${shortLabel}`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="topbar-theme-icon">
              <Icon
                source={resolved === "dark" ? MoonIcon : SunIcon}
                tone="inherit"
              />
            </span>
            <span>{shortLabel}</span>
            <span className="topbar-theme-caret">
              <Icon source={SelectIcon} tone="inherit" />
            </span>
          </button>
        }
      >
        <ActionList
          actionRole="menuitem"
          sections={[
            {
              title: "Theme",
              items: OPTIONS.map((option) => ({
                content: option.label,
                icon: option.icon,
                active: mode === option.mode,
                onAction: () => {
                  setMode(option.mode);
                  setOpen(false);
                },
              })),
            },
            {
              title: "Mouse",
              items: [
                {
                  content: "Custom cursor",
                  helpText: cursorEnabled ? "On — dot, ring and spark cursor that shows on any background" : "Off — using the system cursor",
                  active: cursorEnabled,
                  onAction: () => {
                    setCursorEnabled(!cursorEnabled);
                    setOpen(false);
                  },
                },
              ],
            },
          ]}
        />
      </Popover>
    </div>
  );
}
