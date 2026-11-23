/**
 * Builds Shopify rich-text metafield values. A rich_text_field only accepts a JSON
 * document — {"type":"root","children":[paragraph | heading | list …]} — never plain
 * text or HTML, so everything the tool writes into one goes through here.
 */

export type RichTextFormat = "paragraphs" | "bullets" | "numbered";

export const RICH_TEXT_FORMAT_OPTIONS: { value: RichTextFormat; label: string }[] = [
  { value: "paragraphs", label: "Paragraphs" },
  { value: "bullets", label: "Bulleted list" },
  { value: "numbered", label: "Numbered list" },
];

interface TextNode {
  type: "text";
  value: string;
  bold?: true;
  italic?: true;
}
interface ListItemNode {
  type: "list-item";
  children: TextNode[];
}
type BlockNode =
  | { type: "paragraph"; children: TextNode[] }
  | { type: "heading"; level: number; children: TextNode[] }
  | { type: "list"; listType: "ordered" | "unordered"; children: ListItemNode[] };

const textNode = (value: string): TextNode => ({ type: "text", value });
const toDocument = (children: BlockNode[]): string => JSON.stringify({ type: "root", children });

/** A bullet marker typed in front of a piece ("* ", "• " or "- "): it only has to be followed by a space, so "-5 °C" stays intact. */
const BULLET_MARKER = /^[*•\-–]\s+/;

/**
 * A cell's pieces: a line break, a `|` or a `||` each starts the next piece. A bullet marker in front of a
 * piece is dropped, so "* Height 5 cm | Width 3 cm" gives the pieces "Height 5 cm" and "Width 3 cm".
 */
export function splitSegments(text: string): string[] {
  return text
    .split(/\n+|\s*\|+\s*/)
    .map((piece) => piece.trim().replace(BULLET_MARKER, "").trim())
    .filter(Boolean);
}

/** Plain text → paragraphs, a bulleted list or a numbered list, one piece per paragraph / item. */
export function plainTextToRichText(text: string, format: RichTextFormat): string {
  const segments = splitSegments(text);
  if (segments.length === 0) return toDocument([]);
  // A cell that starts with a bullet marker is a bulleted list even when "Paragraphs" is selected.
  const asBullets = format === "paragraphs" && BULLET_MARKER.test(text.trim());
  if (format === "paragraphs" && !asBullets) {
    return toDocument(segments.map((piece) => ({ type: "paragraph", children: [textNode(piece)] })));
  }
  return toDocument([
    {
      type: "list",
      listType: format === "numbered" ? "ordered" : "unordered", // bullets, and a cell that started with a bullet marker, are unordered
      children: segments.map((piece) => ({ type: "list-item", children: [textNode(piece)] })),
    },
  ]);
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
const decodeEntities = (text: string): string => text.replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/** Trims the ends of an inline run and drops pieces that became empty. */
function tidyInline(nodes: TextNode[]): TextNode[] {
  const tidy = nodes.map((n) => ({ ...n }));
  while (tidy.length > 0 && tidy[0].value.trim() === "") tidy.shift();
  while (tidy.length > 0 && tidy[tidy.length - 1].value.trim() === "") tidy.pop();
  if (tidy.length > 0) {
    tidy[0].value = tidy[0].value.replace(/^\s+/, "");
    tidy[tidy.length - 1].value = tidy[tidy.length - 1].value.replace(/\s+$/, "");
  }
  return tidy;
}

const TOKEN = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>|[^<]+/g;

/**
 * HTML → rich text document. Understands paragraphs / divs / line breaks,
 * h1–h6, bold, italic and bulleted / numbered lists (what the editor in the
 * tool produces and what a typical HTML cell contains). Anything else is
 * ignored, keeping only its text.
 */
export function htmlToRichText(html: string): string {
  const blocks: BlockNode[] = [];
  const lists: { listType: "ordered" | "unordered"; items: ListItemNode[] }[] = [];
  let inline: TextNode[] = [];
  let bold = 0;
  let italic = 0;
  let heading = 0;
  let inItem = false;

  const flush = () => {
    const children = tidyInline(inline);
    inline = [];
    if (children.length === 0) return;
    if (lists.length > 0 && inItem) lists[lists.length - 1].items.push({ type: "list-item", children });
    else if (heading > 0) blocks.push({ type: "heading", level: heading, children });
    else blocks.push({ type: "paragraph", children });
  };

  for (const match of html.matchAll(TOKEN)) {
    const [token, rawTag] = match;
    if (!rawTag) {
      const value = decodeEntities(token).replace(/\s+/g, " ");
      if (value !== "") inline.push({ type: "text", value, ...(bold > 0 ? { bold: true as const } : {}), ...(italic > 0 ? { italic: true as const } : {}) });
      continue;
    }
    const tag = rawTag.toLowerCase();
    const closing = token.startsWith("</");
    if (tag === "b" || tag === "strong") bold = Math.max(0, bold + (closing ? -1 : 1));
    else if (tag === "i" || tag === "em") italic = Math.max(0, italic + (closing ? -1 : 1));
    else if (tag === "br") flush();
    else if (/^h[1-6]$/.test(tag)) {
      flush();
      heading = closing ? 0 : Number(tag[1]);
    } else if (tag === "p" || tag === "div") flush();
    else if (tag === "ul" || tag === "ol") {
      flush();
      if (!closing) {
        lists.push({ listType: tag === "ol" ? "ordered" : "unordered", items: [] });
      } else {
        const done = lists.pop();
        if (done && done.items.length > 0) {
          // Shopify lists don't nest here, so a nested list's items join its parent.
          if (lists.length > 0) lists[lists.length - 1].items.push(...done.items);
          else blocks.push({ type: "list", listType: done.listType, children: done.items });
        }
      }
    } else if (tag === "li") {
      flush();
      inItem = !closing;
    }
  }
  flush();
  return toDocument(blocks);
}

/** True when a rich text document has no content — such a value must not be written (it would be rejected). */
export function isEmptyRichText(json: string): boolean {
  try {
    const doc = JSON.parse(json) as { children?: unknown[] };
    return !Array.isArray(doc.children) || doc.children.length === 0;
  } catch {
    return true;
  }
}
