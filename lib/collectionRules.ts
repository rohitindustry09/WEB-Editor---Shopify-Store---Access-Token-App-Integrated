export const RULE_COLUMNS = [
  { value: "TITLE", label: "Title" },
  { value: "TYPE", label: "Product type" },
  { value: "VENDOR", label: "Vendor" },
  { value: "VARIANT_PRICE", label: "Price" },
  { value: "VARIANT_COMPARE_AT_PRICE", label: "Compare-at price" },
  { value: "TAG", label: "Tag" },
  { value: "VARIANT_INVENTORY", label: "Inventory stock" },
  { value: "VARIANT_TITLE", label: "Variant title" },
  { value: "VARIANT_WEIGHT", label: "Weight" },
  { value: "VARIANT_BARCODE", label: "Barcode" },
] as const;

export const RULE_RELATIONS = [
  { value: "EQUALS", label: "is equal to" },
  { value: "NOT_EQUALS", label: "is not equal to" },
  { value: "GREATER_THAN", label: "is greater than" },
  { value: "LESS_THAN", label: "is less than" },
  { value: "STARTS_WITH", label: "starts with" },
  { value: "ENDS_WITH", label: "ends with" },
  { value: "CONTAINS", label: "contains" },
  { value: "NOT_CONTAINS", label: "does not contain" },
] as const;

export type RuleColumn = (typeof RULE_COLUMNS)[number]["value"];
export type RuleRelation = (typeof RULE_RELATIONS)[number]["value"];

export interface Rule {
  column: string;
  relation: string;
  condition: string;
}

export function columnLabel(column: string): string {
  return RULE_COLUMNS.find((c) => c.value === column)?.label ?? column;
}

export function relationLabel(column: string, relation: string): string {
  if (relation === "CONTAINS" && column === "TAG") return "includes";
  if (relation === "NOT_CONTAINS" && column === "TAG") return "does not include";
  return RULE_RELATIONS.find((r) => r.value === relation)?.label ?? relation;
}

export function describeRule(rule: Rule): string {
  const value = rule.column === "VARIANT_PRICE" || rule.column === "VARIANT_COMPARE_AT_PRICE"
    ? `$${rule.condition}`
    : rule.condition;
  return `${columnLabel(rule.column)} ${relationLabel(rule.column, rule.relation)} ${value}`;
}

/**
 * Summarizes a rule set the way Shopify's own collections list does:
 * one line per distinct column, with a "+N more" suffix when a column
 * (typically Tag) has several conditions.
 */
export function summarizeRuleSet(rules: Rule[]): string {
  if (rules.length === 0) return "";
  const byColumn = new Map<string, Rule[]>();
  for (const rule of rules) {
    const list = byColumn.get(rule.column) ?? [];
    list.push(rule);
    byColumn.set(rule.column, list);
  }

  const lines: string[] = [];
  for (const [column, group] of byColumn) {
    if (group.length === 1) {
      lines.push(describeRule(group[0]));
      continue;
    }
    const relation = relationLabel(column, group[0].relation);
    const values = group.map((r) => r.condition);
    const shown = values.slice(0, 2).join(", ");
    const extra = values.length > 2 ? `, +${values.length - 2} more` : "";
    lines.push(`${columnLabel(column)} ${relation} ${shown}${extra}`);
  }
  return lines.join(" · ");
}
