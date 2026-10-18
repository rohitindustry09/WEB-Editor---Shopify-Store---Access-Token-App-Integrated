import "server-only";
import * as cheerio from "cheerio";
import type { CustomFieldEntry } from "./types";

/** Matches a "Label: value" line — a short leading label (letters/digits/punctuation, no colon) then a colon then the rest. */
const LABEL_VALUE_LINE = /^([A-Za-z][A-Za-z0-9 /&()+.'-]{1,40}?)\s*:\s*(.+)$/;

/** Elements that reuse "Label: value"-shaped text for something that isn't a product spec (shipping/returns popups, dialogs) — stripped from a clone before the generic scan so they can't be picked up. */
const NOISE_SELECTOR = "dialog, .drawer, .popup, [data-popup], .modal, script, style, noscript";

/** Where the generic (no explicit container classes given) scan looks first — common "main product info" containers across Shopify/WooCommerce/Magento themes, falling back to <main> or the whole body. */
const AUTO_SCOPE_SELECTORS = [
  ".product__content",
  ".product-single__content",
  ".product-info",
  ".product-details",
  ".product-summary",
  "#product-content",
  "main",
];

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

function normalizeValue(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Adds `{label, value}`, numbering repeats instead of silently overwriting
 * them (`Material`, `Material (2)`, ...) — a real spec table can legitimately
 * repeat a label (e.g. two "Includes" bullet groups).
 */
function pushField(fields: CustomFieldEntry[], rawLabel: string, rawValue: string): void {
  const label = normalizeLabel(rawLabel);
  const value = normalizeValue(rawValue);
  if (!label || !value) return;
  const existingCount = fields.filter((f) => f.label === label || f.label.startsWith(`${label} (`)).length;
  fields.push({ label: existingCount === 0 ? label : `${label} (${existingCount + 1})`, value });
}

/**
 * Reads EVERY <li> under `$container` as a field, with no "Label: value"
 * shape required — a colon-less item becomes a positionally numbered field
 * ("Feature 1", "Feature 2", ...). This is what makes the explicit
 * "custom field container classes" option able to capture spec lists the
 * generic label:value scan below would otherwise silently drop.
 */
function readEveryListItem($: cheerio.CheerioAPI, $container: ReturnType<cheerio.CheerioAPI>, fields: CustomFieldEntry[]): void {
  let featureIndex = 0;
  $container.find("li").each((_, el) => {
    const text = normalizeValue($(el).text());
    if (!text) return;
    const match = text.match(LABEL_VALUE_LINE);
    if (match) {
      pushField(fields, match[1], match[2]);
    } else {
      featureIndex += 1;
      pushField(fields, `Feature ${featureIndex}`, text);
    }
  });
}

function readLabelValueLines($: cheerio.CheerioAPI, $scope: ReturnType<cheerio.CheerioAPI>, fields: CustomFieldEntry[]): void {
  $scope.find("li").each((_, el) => {
    const text = normalizeValue($(el).text());
    const match = text.match(LABEL_VALUE_LINE);
    if (match) pushField(fields, match[1], match[2]);
  });

  $scope.find("table").each((_, table) => {
    $(table)
      .find("tr")
      .each((_, row) => {
        const cells = $(row).find("th, td");
        if (cells.length < 2) return;
        pushField(fields, $(cells[0]).text(), $(cells[1]).text());
      });
  });

  $scope.find("dl").each((_, dl) => {
    const terms = $(dl).find("dt");
    const defs = $(dl).find("dd");
    const count = Math.min(terms.length, defs.length);
    for (let i = 0; i < count; i++) {
      pushField(fields, $(terms[i]).text(), $(defs[i]).text());
    }
  });
}

export interface ExtractCustomFieldsOptions {
  /** CSS class names (without the leading dot) to read wholesale via `readEveryListItem`. */
  containerClasses: string[];
}

/**
 * Extracts every spec-looking field from a loaded document (or HTML
 * fragment) — always captures everything found; filtering down to a
 * user-requested subset of field names happens later, at export time, so
 * nothing is lost if the user broadens their request after scraping.
 */
export function extractCustomFields($: cheerio.CheerioAPI, options: ExtractCustomFieldsOptions): CustomFieldEntry[] {
  const fields: CustomFieldEntry[] = [];
  const containerSelectors = options.containerClasses.map((c) => `.${c.replace(/^\./, "")}`);

  if (containerSelectors.length > 0) {
    const $containers = $(containerSelectors.join(", "));
    if ($containers.length > 0) {
      readEveryListItem($, $containers, fields);
    }
  }

  // The generic scan still runs over the rest of the page even when
  // container classes matched, but excludes those matched elements so the
  // same spec list isn't captured twice.
  const $clone = cheerio.load($.html());
  $clone(NOISE_SELECTOR).remove();
  if (containerSelectors.length > 0) {
    $clone(containerSelectors.join(", ")).remove();
  }

  let $scope = $clone(AUTO_SCOPE_SELECTORS.join(", ")).first();
  if ($scope.length === 0) $scope = $clone("body");
  readLabelValueLines($clone, $scope, fields);

  return fields;
}

/** Filters a product's captured custom fields down to only the requested labels (case-insensitive), or returns everything when the list is empty. */
export function filterCustomFields(fields: CustomFieldEntry[], requestedFields: string[]): CustomFieldEntry[] {
  if (requestedFields.length === 0) return fields;
  const wanted = new Set(requestedFields.map((f) => f.trim().toLowerCase()).filter(Boolean));
  return fields.filter((f) => wanted.has(f.label.toLowerCase()));
}
