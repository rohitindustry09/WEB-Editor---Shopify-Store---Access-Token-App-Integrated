"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Card,
  BlockStack,
  InlineStack,
  Text,
  Thumbnail,
  Button,
  Popover,
  TextField,
  Banner,
  ActionList,
  Box,
} from "@shopify/polaris";
import {
  addProductToCollectionAction,
  removeProductFromCollectionAction,
  updateRuleSetAction,
} from "@/app/(app)/products/collections/[id]/actions";
import { RuleBuilder } from "@/components/collections/RuleBuilder";
import { describeRule, type Rule } from "@/lib/collectionRules";
import type { CollectionDetail as CollectionDetailType, ProductListItem } from "@/lib/shopify/types";

interface SearchResult {
  id: string;
  title: string;
  images: { nodes: { url: string; altText: string | null }[] };
  variants: { nodes: { sku: string }[] };
}

export function CollectionDetail({ collection }: { collection: CollectionDetailType }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "critical"; text: string } | null>(null);
  const [popoverActive, setPopoverActive] = useState(false);
  const [editingRules, setEditingRules] = useState(false);
  const [appliedDisjunctively, setAppliedDisjunctively] = useState(
    collection.ruleSet?.appliedDisjunctively ?? false,
  );
  const [rules, setRules] = useState<Rule[]>(collection.ruleSet?.rules ?? []);
  const [ruleSaving, startRuleTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) return;
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/products/search?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      if (data.ok) setResults(data.products);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  const visibleResults = query.trim() ? results : [];

  const addProduct = (product: SearchResult) => {
    setPopoverActive(false);
    setQuery("");
    startTransition(async () => {
      const result = await addProductToCollectionAction(collection.id, product.id);
      setNotice(
        result.ok
          ? { tone: "success", text: `Added ${product.title}. It may take a few seconds to appear.` }
          : { tone: "critical", text: result.error ?? "Couldn't add product." },
      );
      router.refresh();
    });
  };

  const saveRules = () => {
    startRuleTransition(async () => {
      const result = await updateRuleSetAction(collection.id, appliedDisjunctively, rules);
      setNotice(
        result.ok
          ? { tone: "success", text: "Conditions updated." }
          : { tone: "critical", text: result.error ?? "Couldn't update conditions." },
      );
      if (result.ok) setEditingRules(false);
      router.refresh();
    });
  };

  const removeProduct = (product: ProductListItem) => {
    startTransition(async () => {
      const result = await removeProductFromCollectionAction(collection.id, product.id);
      setNotice(
        result.ok
          ? { tone: "success", text: `Removed ${product.title}.` }
          : { tone: "critical", text: result.error ?? "Couldn't remove product." },
      );
      router.refresh();
    });
  };

  return (
    <BlockStack gap="400">
      {notice && (
        <Banner tone={notice.tone} onDismiss={() => setNotice(null)}>
          <p>{notice.text}</p>
        </Banner>
      )}

      {collection.ruleSet && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Conditions</Text>
              {!editingRules && (
                <Button variant="plain" onClick={() => setEditingRules(true)}>
                  Edit conditions
                </Button>
              )}
            </InlineStack>

            {editingRules ? (
              <BlockStack gap="300">
                <RuleBuilder
                  appliedDisjunctively={appliedDisjunctively}
                  onAppliedDisjunctivelyChange={setAppliedDisjunctively}
                  rules={rules}
                  onRulesChange={setRules}
                />
                <InlineStack gap="200">
                  <Button
                    onClick={() => {
                      setEditingRules(false);
                      setRules(collection.ruleSet?.rules ?? []);
                      setAppliedDisjunctively(collection.ruleSet?.appliedDisjunctively ?? false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button variant="primary" loading={ruleSaving} onClick={saveRules}>
                    Save conditions
                  </Button>
                </InlineStack>
              </BlockStack>
            ) : (
              <BlockStack gap="150">
                <Text as="p" tone="subdued">
                  Product is added automatically when {collection.ruleSet.appliedDisjunctively ? "any" : "all"} of these match:
                </Text>
                {collection.ruleSet.rules.map((rule, i) => (
                  <Text as="p" key={i}>• {describeRule(rule)}</Text>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      )}

      <Card padding="0">
        <Box padding="300" borderBlockEndWidth="025" borderColor="border">
          <InlineStack align="space-between" blockAlign="center">
            <Text as="span" tone="subdued">{collection.products.nodes.length} products</Text>
            {!collection.ruleSet && (
              <Popover
                active={popoverActive}
                onClose={() => setPopoverActive(false)}
                activator={
                  <Button onClick={() => setPopoverActive((a) => !a)} disabled={pending}>
                    Add products
                  </Button>
                }
              >
                <Box padding="200" minWidth="280px">
                  <TextField
                    label="Search products"
                    labelHidden
                    autoComplete="off"
                    placeholder="Search products…"
                    value={query}
                    onChange={setQuery}
                    autoFocus
                  />
                </Box>
                {visibleResults.length > 0 && (
                  <ActionList
                    items={visibleResults.map((r) => ({
                      content: r.title,
                      prefix: (
                        <Thumbnail source={r.images.nodes[0]?.url ?? ""} alt="" size="small" />
                      ),
                      onAction: () => addProduct(r),
                    }))}
                  />
                )}
              </Popover>
            )}
          </InlineStack>
        </Box>

        <BlockStack gap="0">
          {collection.products.nodes.map((product) => (
            <Box key={product.id} padding="300" borderBlockEndWidth="025" borderColor="border">
              <InlineStack align="space-between" blockAlign="center">
                <InlineStack gap="300" blockAlign="center">
                  <Thumbnail
                    source={product.images.nodes[0]?.url ?? ""}
                    alt={product.images.nodes[0]?.altText ?? product.title}
                    size="small"
                  />
                  <Link href={`/products/${product.id.split("/").pop()}`}>
                    <Text as="span">{product.title}</Text>
                  </Link>
                </InlineStack>
                <InlineStack gap="300" blockAlign="center">
                  <Text as="span" numeric>${product.variants.nodes[0]?.price ?? "—"}</Text>
                  {!collection.ruleSet && (
                    <Button
                      tone="critical"
                      variant="plain"
                      disabled={pending}
                      onClick={() => removeProduct(product)}
                    >
                      Remove
                    </Button>
                  )}
                </InlineStack>
              </InlineStack>
            </Box>
          ))}
        </BlockStack>
      </Card>
    </BlockStack>
  );
}
