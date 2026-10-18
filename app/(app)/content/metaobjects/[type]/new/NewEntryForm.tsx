"use client";

import { useState, useTransition } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Checkbox,
  Button,
  Banner,
  Thumbnail,
  Box,
} from "@shopify/polaris";
import { MediaPicker, type PickedImage } from "@/components/ui/MediaPicker";
import { createEntryAction } from "../actions";
import type { MetaobjectDefinitionDetail } from "@/lib/shopify/metaobjects";

interface ReferenceOption {
  id: string;
  label: string;
}

export function NewEntryForm({
  definition,
  referenceOptions,
}: {
  definition: MetaobjectDefinitionDetail;
  referenceOptions: Record<string, ReferenceOption[]>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [images, setImages] = useState<Record<string, PickedImage | null>>({});
  const [pickerField, setPickerField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const setValue = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const fields = definition.fieldDefinitions.map((f) => {
        if (f.typeName === "file_reference") {
          return { key: f.key, value: images[f.key]?.id ?? "" };
        }
        return { key: f.key, value: values[f.key] ?? "" };
      });
      const result = await createEntryAction(definition.type, fields);
      if (!result.ok) setError(result.error ?? "Couldn't create entry.");
    });
  };

  return (
    <Page fullWidth title={`Add ${definition.name}`} backAction={{ content: definition.name, url: `/content/metaobjects/${encodeURIComponent(definition.type)}` }}>
      <Layout>
        {error && (
          <Layout.Section>
            <Banner tone="critical" title="Couldn't create entry">
              <p>{error}</p>
            </Banner>
          </Layout.Section>
        )}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              {definition.fieldDefinitions.map((field) => (
                <FieldInput
                  key={field.key}
                  typeName={field.typeName}
                  label={field.name}
                  required={field.required}
                  value={values[field.key] ?? ""}
                  onChange={(v) => setValue(field.key, v)}
                  options={referenceOptions[field.key]}
                  image={images[field.key] ?? null}
                  onPickImage={() => setPickerField(field.key)}
                  onRemoveImage={() => setImages((prev) => ({ ...prev, [field.key]: null }))}
                />
              ))}
              <InlineStack align="end">
                <Button variant="primary" loading={pending} onClick={submit}>Save</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      <MediaPicker
        open={pickerField !== null}
        onClose={() => setPickerField(null)}
        allowMultiple={false}
        onSelect={(picked) => {
          if (pickerField && picked[0]) {
            setImages((prev) => ({ ...prev, [pickerField]: picked[0] }));
          }
          setPickerField(null);
        }}
      />
    </Page>
  );
}

function FieldInput({
  typeName,
  label,
  required,
  value,
  onChange,
  options,
  image,
  onPickImage,
  onRemoveImage,
}: {
  typeName: string;
  label: string;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
  options?: ReferenceOption[];
  image: PickedImage | null;
  onPickImage: () => void;
  onRemoveImage: () => void;
}) {
  const requiredLabel = required ? `${label} *` : label;

  if (typeName === "color") {
    return (
      <BlockStack gap="150">
        <Text as="span" variant="bodyMd" fontWeight="medium">{requiredLabel}</Text>
        <InlineStack gap="200" blockAlign="center">
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000"}
            onChange={(e) => onChange(e.target.value)}
            style={{ width: 40, height: 32, border: "none", padding: 0, background: "none", cursor: "pointer" }}
          />
          <Box width="160px">
            <TextField label="Hex" labelHidden autoComplete="off" value={value} onChange={onChange} placeholder="#RRGGBB" />
          </Box>
        </InlineStack>
      </BlockStack>
    );
  }

  if (typeName === "boolean") {
    return <Checkbox label={requiredLabel} checked={value === "true"} onChange={(checked) => onChange(String(checked))} />;
  }

  if (typeName === "multi_line_text_field") {
    return <TextField label={requiredLabel} autoComplete="off" multiline={4} value={value} onChange={onChange} />;
  }

  if (typeName === "number_integer" || typeName === "number_decimal") {
    return <TextField label={requiredLabel} type="number" autoComplete="off" value={value} onChange={onChange} />;
  }

  if (typeName === "file_reference") {
    return (
      <BlockStack gap="150">
        <Text as="span" variant="bodyMd" fontWeight="medium">{requiredLabel}</Text>
        <InlineStack gap="200" blockAlign="center">
          {image && <Thumbnail source={image.url} alt={image.altText ?? ""} size="small" />}
          <Button onClick={onPickImage}>{image ? "Change image" : "Select image"}</Button>
          {image && <Button variant="plain" tone="critical" onClick={onRemoveImage}>Remove</Button>}
        </InlineStack>
      </BlockStack>
    );
  }

  if ((typeName === "metaobject_reference" || typeName === "list.metaobject_reference") && options) {
    return (
      <BlockStack gap="150">
        <Text as="span" variant="bodyMd" fontWeight="medium">{requiredLabel}</Text>
        <select
          value={value}
          onChange={(e) => onChange(typeName.startsWith("list.") ? JSON.stringify([e.target.value]) : e.target.value)}
          style={{ padding: "0.5rem", borderRadius: 8, border: "1px solid var(--p-color-border)", width: "100%" }}
        >
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      </BlockStack>
    );
  }

  return <TextField label={requiredLabel} autoComplete="off" value={value} onChange={onChange} />;
}
