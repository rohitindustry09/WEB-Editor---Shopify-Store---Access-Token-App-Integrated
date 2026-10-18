import type { LogoPosition } from "@/lib/backgroundComposite";

export const LOGO_POSITIONS: { value: LogoPosition; label: string }[] = [
  { value: "top-left", label: "Top left" },
  { value: "top-right", label: "Top right" },
  { value: "bottom-left", label: "Bottom left" },
  { value: "bottom-right", label: "Bottom right" },
  { value: "center", label: "Center" },
  { value: "custom", label: "Custom" },
];
