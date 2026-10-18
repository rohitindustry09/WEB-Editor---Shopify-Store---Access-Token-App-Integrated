"use client";

import { BlockStack, InlineStack, InlineGrid, Text, Button, ButtonGroup, DropZone, Icon, RangeSlider, Spinner } from "@shopify/polaris";
import { DeleteIcon, EyeDropperIcon } from "@shopify/polaris-icons";
import type { RadialPosition } from "@/lib/backgroundComposite";
import { isImageFilename } from "@/lib/skuMediaZip";
import type { BackgroundEditorState, BgKind } from "./backgroundEditorState";
import { effectiveBgKindFor } from "./backgroundEditorState";
import { ColorSwatchPicker } from "./ColorSwatchPicker";

const RADIAL_POSITIONS: { value: RadialPosition; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "top", label: "Top" },
  { value: "right", label: "Right" },
  { value: "bottom", label: "Bottom" },
  { value: "left", label: "Left" },
  { value: "custom", label: "Custom" },
];

type Props = {
  state: BackgroundEditorState;
  onChange: (patch: Partial<BackgroundEditorState>) => void;
  sampleTransparent: boolean | null;
  hasSample: boolean;
  /** Parent owns object-URL creation/tracking (it revokes every tracked URL on unmount) — this component just hands back the dropped file. */
  onImageDrop: (file: File) => void;
};

/**
 * The full Solid color / Gradient / Image / Replace color picker — one
 * instance per column (A and B), each driven entirely by its own
 * `BackgroundEditorState` so the two columns are completely independent of
 * each other. Extracted out of `BgCustomiserForm.tsx` specifically so both
 * columns render from the exact same code instead of two hand-maintained
 * copies drifting apart. The eyedropper click target itself lives in the
 * parent's own Preview card (the "Original" image) rather than a second
 * copy of it here — see `BgCustomiserForm.tsx`.
 */
export function BackgroundModeEditor({ state, onChange, sampleTransparent, hasSample, onImageDrop }: Props) {
  const effectiveBgKind: BgKind = effectiveBgKindFor(state.bgKind, sampleTransparent);

  const setBgKind = (bgKind: BgKind) => onChange({ bgKind });

  return (
    <BlockStack gap="300">
      <ButtonGroup variant="segmented">
        <Button pressed={effectiveBgKind === "color"} disabled={sampleTransparent === false} onClick={() => setBgKind("color")}>
          Solid color
        </Button>
        <Button pressed={effectiveBgKind === "gradient"} disabled={sampleTransparent === false} onClick={() => setBgKind("gradient")}>
          Gradient
        </Button>
        <Button pressed={effectiveBgKind === "image"} disabled={sampleTransparent === false} onClick={() => setBgKind("image")}>
          Image
        </Button>
        <Button pressed={effectiveBgKind === "replace-color"} disabled={sampleTransparent === true} onClick={() => setBgKind("replace-color")}>
          Replace color
        </Button>
      </ButtonGroup>

      {sampleTransparent === null && hasSample && (
        <InlineStack gap="150" blockAlign="center">
          <Spinner size="small" />
          <Text as="span" tone="subdued" variant="bodySm">Checking whether this image has a transparent background…</Text>
        </InlineStack>
      )}

      {effectiveBgKind === "replace-color" && (
        <BlockStack gap="300">
          <InlineStack gap="150" blockAlign="center">
            <Icon source={EyeDropperIcon} tone="subdued" />
            <Text as="span" tone="subdued" variant="bodySm">
              Click the Original image in the preview below to pick the color to replace.
            </Text>
          </InlineStack>

          <InlineStack gap="400" blockAlign="center">
            <InlineStack gap="150" blockAlign="center">
              <ColorSwatchPicker
                label="Color to replace"
                value={state.replaceSourceColor}
                onChange={(hex) => onChange({ replaceSourceColor: hex })}
              />
              <BlockStack gap="0">
                <Text as="span" variant="bodySm">Replace this</Text>
                <Text as="span" tone="subdued" variant="bodySm">{state.replaceSourceColor}</Text>
              </BlockStack>
            </InlineStack>
            <InlineStack gap="150" blockAlign="center">
              <ColorSwatchPicker
                label="Replacement color"
                value={state.replaceTargetColor}
                onChange={(hex) => onChange({ replaceTargetColor: hex })}
              />
              <BlockStack gap="0">
                <Text as="span" variant="bodySm">With this</Text>
                <Text as="span" tone="subdued" variant="bodySm">{state.replaceTargetColor}</Text>
              </BlockStack>
            </InlineStack>
          </InlineStack>

          <RangeSlider
            label={`Tolerance — ${state.replaceTolerance}`}
            helpText="How close a pixel's color must be to count as a match — higher catches more (shadows, compression noise) but risks touching the product itself."
            min={0}
            max={100}
            value={state.replaceTolerance}
            onChange={(v) => onChange({ replaceTolerance: Array.isArray(v) ? v[0] : v })}
            output
          />
        </BlockStack>
      )}

      {effectiveBgKind === "color" && (
        <InlineStack gap="300" blockAlign="center">
          <ColorSwatchPicker label="Background color" value={state.solidColor} onChange={(hex) => onChange({ solidColor: hex })} />
          <Text as="span" tone="subdued" variant="bodySm">{state.solidColor}</Text>
        </InlineStack>
      )}

      {effectiveBgKind === "gradient" && (
        <BlockStack gap="300">
          <ButtonGroup variant="segmented">
            <Button pressed={state.gradientType === "linear"} onClick={() => onChange({ gradientType: "linear" })}>Linear</Button>
            <Button pressed={state.gradientType === "radial"} onClick={() => onChange({ gradientType: "radial" })}>Radial</Button>
          </ButtonGroup>

          <InlineStack gap="400" blockAlign="center">
            <InlineStack gap="150" blockAlign="center">
              <ColorSwatchPicker label="Gradient start color" value={state.colorStart} onChange={(hex) => onChange({ colorStart: hex })} />
              <Text as="span" tone="subdued" variant="bodySm">Start</Text>
            </InlineStack>
            <InlineStack gap="150" blockAlign="center">
              <ColorSwatchPicker label="Gradient end color" value={state.colorEnd} onChange={(hex) => onChange({ colorEnd: hex })} />
              <Text as="span" tone="subdued" variant="bodySm">End</Text>
            </InlineStack>
          </InlineStack>

          {state.gradientType === "linear" ? (
            <RangeSlider
              label={`Angle — ${state.angleDeg}°`}
              min={0}
              max={360}
              value={state.angleDeg}
              onChange={(v) => onChange({ angleDeg: Array.isArray(v) ? v[0] : v })}
              output
            />
          ) : (
            <BlockStack gap="300">
              <InlineStack gap="200" wrap>
                {RADIAL_POSITIONS.map((p) => (
                  <Button key={p.value} pressed={state.radialPosition === p.value} onClick={() => onChange({ radialPosition: p.value })}>
                    {p.label}
                  </Button>
                ))}
              </InlineStack>
              {state.radialPosition === "custom" && (
                <InlineGrid columns={2} gap="300">
                  <RangeSlider
                    label={`Horizontal — ${state.customX}%`}
                    min={0}
                    max={100}
                    value={state.customX}
                    onChange={(v) => onChange({ customX: Array.isArray(v) ? v[0] : v })}
                    output
                  />
                  <RangeSlider
                    label={`Vertical — ${state.customY}%`}
                    min={0}
                    max={100}
                    value={state.customY}
                    onChange={(v) => onChange({ customY: Array.isArray(v) ? v[0] : v })}
                    output
                  />
                </InlineGrid>
              )}
            </BlockStack>
          )}
        </BlockStack>
      )}

      {effectiveBgKind === "image" && (
        <BlockStack gap="300">
          {!state.bgImageFile ? (
            <DropZone
              accept="image/*"
              type="file"
              allowMultiple={false}
              onDrop={(_files, accepted) => {
                const file = accepted.find((f) => isImageFilename(f.name));
                if (file) onImageDrop(file);
              }}
            >
              <DropZone.FileUpload actionTitle="Add background image" actionHint="or drop an image" />
            </DropZone>
          ) : (
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                {state.bgImagePreviewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL
                  <img src={state.bgImagePreviewUrl} alt="" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 6 }} />
                )}
                <Text as="span">{state.bgImageFile.name}</Text>
              </InlineStack>
              <Button icon={DeleteIcon} onClick={() => onChange({ bgImageFile: null, bgImagePreviewUrl: null })}>
                Remove
              </Button>
            </InlineStack>
          )}

          <ButtonGroup variant="segmented">
            <Button pressed={state.imageFit === "cover"} onClick={() => onChange({ imageFit: "cover" })}>Cover</Button>
            <Button pressed={state.imageFit === "contain"} onClick={() => onChange({ imageFit: "contain" })}>Contain</Button>
          </ButtonGroup>

          <RangeSlider
            label={`Zoom — ${state.imageZoomPercent}%`}
            min={50}
            max={300}
            value={state.imageZoomPercent}
            onChange={(v) => onChange({ imageZoomPercent: Array.isArray(v) ? v[0] : v })}
            output
          />
          <InlineGrid columns={2} gap="300">
            <RangeSlider
              label={`Move horizontally — ${state.imageOffsetX}%`}
              min={-50}
              max={50}
              value={state.imageOffsetX}
              onChange={(v) => onChange({ imageOffsetX: Array.isArray(v) ? v[0] : v })}
              output
            />
            <RangeSlider
              label={`Move vertically — ${state.imageOffsetY}%`}
              min={-50}
              max={50}
              value={state.imageOffsetY}
              onChange={(v) => onChange({ imageOffsetY: Array.isArray(v) ? v[0] : v })}
              output
            />
          </InlineGrid>
        </BlockStack>
      )}
    </BlockStack>
  );
}
