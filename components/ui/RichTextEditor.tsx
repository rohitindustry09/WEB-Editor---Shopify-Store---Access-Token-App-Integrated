"use client";

import { useEffect, useRef, useState } from "react";
import { Box, InlineStack, Button, Text, Popover, TextField, BlockStack } from "@shopify/polaris";

interface RichTextEditorProps {
  label: string;
  value: string;
  onChange: (html: string) => void;
}

type Command = { cmd: string; arg?: string; label: string; icon: string };

const INLINE_COMMANDS: Command[] = [
  { cmd: "bold", label: "Bold", icon: "B" },
  { cmd: "italic", label: "Italic", icon: "I" },
  { cmd: "underline", label: "Underline", icon: "U" },
  { cmd: "strikeThrough", label: "Strikethrough", icon: "S" },
];

const BLOCK_COMMANDS: Command[] = [
  { cmd: "formatBlock", arg: "h2", label: "Heading", icon: "H2" },
  { cmd: "formatBlock", arg: "h3", label: "Subheading", icon: "H3" },
  { cmd: "formatBlock", arg: "p", label: "Paragraph", icon: "¶" },
];

const LIST_COMMANDS: Command[] = [
  { cmd: "insertUnorderedList", label: "Bulleted list", icon: "•" },
  { cmd: "insertOrderedList", label: "Numbered list", icon: "1." },
];

export function RichTextEditor({ label, value, onChange }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [linkPopoverActive, setLinkPopoverActive] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const savedSelection = useRef<Range | null>(null);

  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value || "";
    }
    // Only sync from external value changes (e.g. loading a product); typing
    // updates flow the other direction via handleInput.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(cmd, false, arg);
    onChange(ref.current?.innerHTML ?? "");
  };

  const handleInput = () => {
    onChange(ref.current?.innerHTML ?? "");
  };

  const openLinkPopover = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      savedSelection.current = selection.getRangeAt(0).cloneRange();
    }
    setLinkUrl("");
    setLinkPopoverActive(true);
  };

  const applyLink = () => {
    const selection = window.getSelection();
    if (selection && savedSelection.current) {
      selection.removeAllRanges();
      selection.addRange(savedSelection.current);
    }
    ref.current?.focus();
    if (linkUrl.trim()) {
      document.execCommand("createLink", false, linkUrl.trim());
    }
    onChange(ref.current?.innerHTML ?? "");
    setLinkPopoverActive(false);
  };

  return (
    <BlockStack gap="150">
      <Text as="span" variant="bodyMd" fontWeight="medium">{label}</Text>
      <Box borderWidth="025" borderColor="border" borderRadius="200">
        <Box padding="150" borderBlockEndWidth="025" borderColor="border">
          <InlineStack gap="100" wrap>
            {BLOCK_COMMANDS.map((c) => (
              <ToolbarButton key={c.icon} command={c} onClick={() => exec(c.cmd, c.arg)} />
            ))}
            <Divider />
            {INLINE_COMMANDS.map((c) => (
              <ToolbarButton key={c.icon} command={c} onClick={() => exec(c.cmd, c.arg)} />
            ))}
            <Divider />
            {LIST_COMMANDS.map((c) => (
              <ToolbarButton key={c.icon} command={c} onClick={() => exec(c.cmd, c.arg)} />
            ))}
            <Divider />
            <Popover
              active={linkPopoverActive}
              onClose={() => setLinkPopoverActive(false)}
              activator={
                <button
                  type="button"
                  onClick={openLinkPopover}
                  style={toolbarBtnStyle}
                  title="Link"
                  aria-label="Insert link"
                >
                  🔗
                </button>
              }
            >
              <Box padding="300" minWidth="260px">
                <BlockStack gap="200">
                  <TextField
                    label="Link URL"
                    labelHidden
                    autoComplete="off"
                    placeholder="https://…"
                    value={linkUrl}
                    onChange={setLinkUrl}
                    autoFocus
                  />
                  <InlineStack align="end">
                    <Button size="slim" variant="primary" onClick={applyLink}>Apply</Button>
                  </InlineStack>
                </BlockStack>
              </Box>
            </Popover>
          </InlineStack>
        </Box>
        <div
          ref={ref}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          className="rte-content"
          style={{
            minHeight: "180px",
            padding: "0.75rem",
            fontSize: "0.8125rem",
            lineHeight: 1.6,
            outline: "none",
          }}
        />
      </Box>
      <style>{`
        .rte-content h2 { font-size: 1.25rem; font-weight: 600; margin: 0.5em 0; }
        .rte-content h3 { font-size: 1.05rem; font-weight: 600; margin: 0.5em 0; }
        .rte-content p { margin: 0 0 0.75em; }
        .rte-content ul, .rte-content ol { margin: 0 0 0.75em; padding-left: 1.5em; }
        .rte-content a { color: var(--p-color-text-link); text-decoration: underline; }
        .rte-content:empty:before {
          content: "Describe the product…";
          color: var(--p-color-text-secondary);
        }
      `}</style>
    </BlockStack>
  );
}

function ToolbarButton({ command, onClick }: { command: Command; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={toolbarBtnStyle} title={command.label} aria-label={command.label}>
      {command.icon}
    </button>
  );
}

function Divider() {
  return <div style={{ width: 1, alignSelf: "stretch", background: "var(--p-color-border)" }} />;
}

const toolbarBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  borderRadius: 4,
  padding: "0.3rem 0.5rem",
  fontSize: "0.75rem",
  fontWeight: 600,
  cursor: "pointer",
  color: "var(--p-color-text)",
};
