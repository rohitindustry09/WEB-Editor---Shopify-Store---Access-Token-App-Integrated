"use client";

import { useState } from "react";
import {
  Modal,
  BlockStack,
  InlineStack,
  Box,
  Text,
  TextField,
  Button,
  ButtonGroup,
  DropZone,
  Banner,
  Divider,
} from "@shopify/polaris";
import { DeleteIcon } from "@shopify/polaris-icons";
import { parseMenuCsv, type MenuItemDraft } from "./menuCsv";

type Mode = "manual" | "csv";

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "menu";
}

function emptyItem(): MenuItemDraft {
  return { title: "", url: "#", items: [] };
}

function addTopLevel(items: MenuItemDraft[]): MenuItemDraft[] {
  return [...items, emptyItem()];
}

function addChild(items: MenuItemDraft[], parentIndex: number): MenuItemDraft[] {
  return items.map((item, i) => (i === parentIndex ? { ...item, items: [...item.items, emptyItem()] } : item));
}

function updateTopLevel(items: MenuItemDraft[], index: number, patch: Partial<MenuItemDraft>): MenuItemDraft[] {
  return items.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

function updateChild(items: MenuItemDraft[], parentIndex: number, childIndex: number, patch: Partial<MenuItemDraft>): MenuItemDraft[] {
  return items.map((item, i) =>
    i === parentIndex ? { ...item, items: item.items.map((child, j) => (j === childIndex ? { ...child, ...patch } : child)) } : item,
  );
}

function removeTopLevel(items: MenuItemDraft[], index: number): MenuItemDraft[] {
  return items.filter((_, i) => i !== index);
}

function removeChild(items: MenuItemDraft[], parentIndex: number, childIndex: number): MenuItemDraft[] {
  return items.map((item, i) => (i === parentIndex ? { ...item, items: item.items.filter((_, j) => j !== childIndex) } : item));
}

function countItems(items: MenuItemDraft[]): number {
  return items.reduce((sum, item) => sum + 1 + item.items.length, 0);
}

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

/**
 * Two ways in, one shared tree: manual entry builds `items` one add-item
 * click at a time, and importing a CSV (see `menuCsv.ts` — one top-level
 * item per column, its children filling that column downward) replaces
 * `items` wholesale in one shot. Either way lands in the same preview/edit
 * list before "Create menu" actually submits, so a CSV import can still be
 * tweaked by hand afterward instead of being all-or-nothing.
 */
export function AddMenuModal({ open, onClose, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>("manual");
  const [title, setTitle] = useState("");
  const [handle, setHandle] = useState("");
  const [handleEditedManually, setHandleEditedManually] = useState(false);
  const [items, setItems] = useState<MenuItemDraft[]>([]);
  const [csvText, setCsvText] = useState("");
  const [csvError, setCsvError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const reset = () => {
    setMode("manual");
    setTitle("");
    setHandle("");
    setHandleEditedManually(false);
    setItems([]);
    setCsvText("");
    setCsvError(null);
    setSubmitError(null);
  };

  const handleClose = () => {
    if (!submitting) {
      reset();
      onClose();
    }
  };

  const handleTitleChange = (value: string) => {
    setTitle(value);
    if (!handleEditedManually) setHandle(slugify(value));
  };

  const handleCsvFile = async (file: File) => {
    const text = await file.text();
    applyCsv(text);
  };

  const applyCsv = (text: string) => {
    setCsvText(text);
    const parsed = parseMenuCsv(text);
    if (parsed.length === 0) {
      setCsvError("Couldn't find any menu items in that CSV.");
      return;
    }
    setCsvError(null);
    setItems(parsed);
  };

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!title.trim()) {
      setSubmitError("Give the menu a name first.");
      return;
    }
    if (items.length === 0) {
      setSubmitError("Add at least one menu item first.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/menus/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          handle: handle.trim() || slugify(title),
          items: items
            .filter((item) => item.title.trim())
            .map((item) => ({
              title: item.title.trim(),
              type: "HTTP" as const,
              url: item.url.trim() || "#",
              items: item.items
                .filter((child) => child.title.trim())
                .map((child) => ({ title: child.title.trim(), type: "HTTP" as const, url: child.url.trim() || "#" })),
            })),
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setSubmitError(data.error ?? "Couldn't create the menu.");
        return;
      }
      reset();
      onCreated();
      onClose();
    } catch {
      setSubmitError("Couldn't create the menu.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add menu" primaryAction={{ content: "Create menu", onAction: () => void handleSubmit(), loading: submitting }} secondaryActions={[{ content: "Cancel", onAction: handleClose, disabled: submitting }]}>
      <Modal.Section>
        <BlockStack gap="400">
          <TextField label="Name" autoComplete="off" value={title} onChange={handleTitleChange} placeholder="Main menu" />
          <TextField
            label="Handle"
            autoComplete="off"
            value={handle}
            onChange={(value) => {
              setHandle(value);
              setHandleEditedManually(true);
            }}
            helpText="Used in the menu's own URL — lowercase, hyphenated."
          />

          <Divider />

          <ButtonGroup variant="segmented">
            <Button pressed={mode === "manual"} onClick={() => setMode("manual")}>
              Add manually
            </Button>
            <Button pressed={mode === "csv"} onClick={() => setMode("csv")}>
              Import from CSV
            </Button>
          </ButtonGroup>

          {mode === "csv" && (
            <BlockStack gap="300">
              <Text as="p" tone="subdued" variant="bodySm">
                One top-level menu item per column, in the first row — every row below fills in that column&apos;s
                sub-items, top to bottom. Every item is created linking to &quot;#&quot; — set real links afterward.
              </Text>
              <DropZone accept=".csv,text/csv" type="file" allowMultiple={false} onDrop={(_files, accepted) => accepted[0] && void handleCsvFile(accepted[0])}>
                <DropZone.FileUpload actionTitle="Add CSV file" actionHint="or drop a .csv file" />
              </DropZone>
              <TextField
                label="Or paste CSV text"
                multiline={4}
                autoComplete="off"
                value={csvText}
                onChange={applyCsv}
                placeholder={"About Us,Bats,Gloves\n,English Willow,Traditional Gloves\n,Junior Bats,Lightweight Gloves"}
              />
              {csvError && <Banner tone="warning">{csvError}</Banner>}
              {items.length > 0 && (
                <Text as="p" tone="subdued" variant="bodySm">
                  {`Parsed ${items.length} top-level item${items.length === 1 ? "" : "s"}, ${countItems(items)} total. Switch to "Add manually" to review or edit before creating.`}
                </Text>
              )}
            </BlockStack>
          )}

          {mode === "manual" && (
            <BlockStack gap="300">
              {items.length === 0 && (
                <Text as="p" tone="subdued" variant="bodySm">
                  No items yet — add one below, or import a CSV.
                </Text>
              )}
              {items.map((item, itemIndex) => (
                <Box key={itemIndex} background="bg-surface-secondary" padding="300" borderRadius="200">
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="end" wrap={false}>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Label"
                          autoComplete="off"
                          value={item.title}
                          onChange={(value) => setItems(updateTopLevel(items, itemIndex, { title: value }))}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label="Link"
                          autoComplete="off"
                          value={item.url}
                          onChange={(value) => setItems(updateTopLevel(items, itemIndex, { url: value }))}
                        />
                      </div>
                      <Button icon={DeleteIcon} accessibilityLabel="Remove item" onClick={() => setItems(removeTopLevel(items, itemIndex))} />
                    </InlineStack>

                    {item.items.map((child, childIndex) => (
                      <InlineStack key={childIndex} gap="200" blockAlign="end" wrap={false}>
                        <div style={{ width: 24 }} />
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Label"
                            labelHidden
                            autoComplete="off"
                            value={child.title}
                            onChange={(value) => setItems(updateChild(items, itemIndex, childIndex, { title: value }))}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <TextField
                            label="Link"
                            labelHidden
                            autoComplete="off"
                            value={child.url}
                            onChange={(value) => setItems(updateChild(items, itemIndex, childIndex, { url: value }))}
                          />
                        </div>
                        <Button
                          icon={DeleteIcon}
                          accessibilityLabel="Remove sub-item"
                          onClick={() => setItems(removeChild(items, itemIndex, childIndex))}
                        />
                      </InlineStack>
                    ))}

                    <InlineStack>
                      <Button size="micro" onClick={() => setItems(addChild(items, itemIndex))}>
                        Add sub-item
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Box>
              ))}
              <InlineStack>
                <Button onClick={() => setItems(addTopLevel(items))}>Add menu item</Button>
              </InlineStack>
            </BlockStack>
          )}

          {submitError && (
            <Banner tone="critical" onDismiss={() => setSubmitError(null)}>
              <p>{submitError}</p>
            </Banner>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
