"use server";

import { createCollection } from "@/lib/shopify/collections";

const COLUMNS = ["TAG", "TITLE", "TYPE", "VENDOR", "VARIANT_PRICE", "VARIANT_COMPARE_AT_PRICE", "VARIANT_WEIGHT", "VARIANT_INVENTORY", "VARIANT_TITLE", "IS_PRICE_REDUCED"] as const;
const RELATIONS = ["EQUALS", "NOT_EQUALS", "GREATER_THAN", "LESS_THAN", "STARTS_WITH", "ENDS_WITH", "CONTAINS", "NOT_CONTAINS", "IS_SET", "IS_NOT_SET"] as const;
const MAX_RULES = 60;
const MAX_TITLE = 255;
const MAX_CONDITION = 255;

export interface SmartRule {
  column: string;
  relation: string;
  condition: string;
}

export interface CreatedCollection {
  id: string;
  title: string;
  handle: string;
}

/**
 * Creates a smart collection: Shopify keeps it filled by itself, adding and removing products as they match
 * the rules. Everything is validated against Shopify's known columns and relations before it is sent.
 */
export async function createSmartCollectionAction(title: string, matchAny: boolean, rules: SmartRule[]): Promise<{ ok: true; collection: CreatedCollection } | { ok: false; error: string }> {
  const cleanTitle = typeof title === "string" ? title.trim() : "";
  if (!cleanTitle || cleanTitle.length > MAX_TITLE) return { ok: false, error: "Give the collection a name (up to 255 characters)." };
  if (!Array.isArray(rules) || rules.length === 0 || rules.length > MAX_RULES) return { ok: false, error: "Add at least one rule." };

  const cleanRules: SmartRule[] = [];
  for (const rule of rules) {
    if (!COLUMNS.includes(rule?.column as (typeof COLUMNS)[number]) || !RELATIONS.includes(rule?.relation as (typeof RELATIONS)[number])) return { ok: false, error: "A rule uses a field or comparison Shopify doesn't know." };
    const condition = typeof rule.condition === "string" ? rule.condition.trim() : "";
    const needsValue = rule.relation !== "IS_SET" && rule.relation !== "IS_NOT_SET" && rule.column !== "IS_PRICE_REDUCED";
    if (needsValue && !condition) return { ok: false, error: "Fill in the value of every rule." };
    if (condition.length > MAX_CONDITION) return { ok: false, error: "A rule value is too long." };
    cleanRules.push({ column: rule.column, relation: rule.relation, condition });
  }

  try {
    const { collection, userErrors } = await createCollection({ title: cleanTitle, ruleSet: { appliedDisjunctively: Boolean(matchAny), rules: cleanRules } });
    if (userErrors.length > 0 || !collection) return { ok: false, error: userErrors.map((error) => error.message).join("; ") || "Shopify didn't create the collection." };
    return { ok: true, collection };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't create the collection." };
  }
}
