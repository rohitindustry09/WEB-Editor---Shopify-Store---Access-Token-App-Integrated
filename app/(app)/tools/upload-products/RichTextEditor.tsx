"use client";

import { useEffect, useRef } from "react";
import { Button, ButtonGroup } from "@shopify/polaris";

type EditorCommand = "bold" | "italic" | "insertUnorderedList" | "insertOrderedList" | "removeFormat";

const TOOLS: { command: EditorCommand; label: string; text: string }[] = [
  { command: "bold", label: "Bold", text: "B" },
  { command: "italic", label: "Italic", text: "I" },
  { command: "insertUnorderedList", label: "Bulleted list", text: "• List" },
  { command: "insertOrderedList", label: "Numbered list", text: "1. List" },
  { command: "removeFormat", label: "Clear formatting", text: "Clear" },
];

/**
 * A small rich text area (bold, italic, bulleted and numbered lists) for writing
 * one piece of content that is then saved on every product. It is uncontrolled —
 * `initialHtml` seeds it once — so typing never fights React for the caret; the
 * current HTML is reported through `onChange`.
 */
export function RichTextEditor({
  id,
  label,
  initialHtml,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  initialHtml: string;
  onChange: (html: string) => void;
  disabled?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = initialHtml;
    // Seeded once on mount: later edits live in the DOM, and re-seeding would reset the caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const report = () => onChange(editorRef.current?.innerHTML ?? "");

  const run = (command: EditorCommand) => {
    editorRef.current?.focus();
    document.execCommand(command);
    report();
  };

  return (
    <div>
      {/* Keeps the text selection while a toolbar button is pressed. */}
      <div onMouseDown={(event) => event.preventDefault()} role="toolbar" aria-label={`${label} formatting`}>
        <ButtonGroup variant="segmented">
          {TOOLS.map((tool) => (
            <Button key={tool.command} size="slim" disabled={disabled} accessibilityLabel={tool.label} onClick={() => run(tool.command)}>
              {tool.text}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <div
        ref={editorRef}
        id={id}
        className="rich-editor"
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder="Write the content here…"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={report}
        onBlur={report}
        onPaste={(event) => {
          // Paste as plain text so foreign styles never leak into the content.
          event.preventDefault();
          document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
        }}
      />
    </div>
  );
}
