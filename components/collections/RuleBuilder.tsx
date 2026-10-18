"use client";

import { BlockStack, InlineStack, TextField, Button, RadioButton, Text } from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { RULE_COLUMNS, RULE_RELATIONS, type Rule } from "@/lib/collectionRules";

interface RuleBuilderProps {
  appliedDisjunctively: boolean;
  onAppliedDisjunctivelyChange: (value: boolean) => void;
  rules: Rule[];
  onRulesChange: (rules: Rule[]) => void;
}

function emptyRule(): Rule {
  return { column: "TITLE", relation: "EQUALS", condition: "" };
}

export function RuleBuilder({
  appliedDisjunctively,
  onAppliedDisjunctivelyChange,
  rules,
  onRulesChange,
}: RuleBuilderProps) {
  const updateRule = (index: number, patch: Partial<Rule>) => {
    onRulesChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  return (
    <BlockStack gap="300">
      <InlineStack gap="200" blockAlign="center">
        <Text as="span">Match</Text>
        <RadioButton
          label="all conditions"
          checked={!appliedDisjunctively}
          onChange={() => onAppliedDisjunctivelyChange(false)}
        />
        <RadioButton
          label="any condition"
          checked={appliedDisjunctively}
          onChange={() => onAppliedDisjunctivelyChange(true)}
        />
      </InlineStack>

      <BlockStack gap="200">
        {rules.map((rule, index) => (
          <InlineStack key={index} gap="200" blockAlign="start" wrap>
            <div style={{ minWidth: "160px" }}>
              <Select
                label="Column"
                labelHidden
                options={RULE_COLUMNS.map((c) => ({ label: c.label, value: c.value }))}
                value={rule.column}
                onChange={(v) => updateRule(index, { column: v })}
              />
            </div>
            <div style={{ minWidth: "160px" }}>
              <Select
                label="Relation"
                labelHidden
                options={RULE_RELATIONS.map((r) => ({ label: r.label, value: r.value }))}
                value={rule.relation}
                onChange={(v) => updateRule(index, { relation: v })}
              />
            </div>
            <div style={{ minWidth: "180px", flex: 1 }}>
              <TextField
                label="Value"
                labelHidden
                autoComplete="off"
                value={rule.condition}
                onChange={(v) => updateRule(index, { condition: v })}
              />
            </div>
            <Button
              variant="plain"
              tone="critical"
              onClick={() => onRulesChange(rules.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </InlineStack>
        ))}
      </BlockStack>

      <InlineStack>
        <Button onClick={() => onRulesChange([...rules, emptyRule()])}>Add condition</Button>
      </InlineStack>
    </BlockStack>
  );
}
