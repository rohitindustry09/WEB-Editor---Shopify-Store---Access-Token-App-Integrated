"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  Badge,
  Banner,
  BlockStack,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  DropZone,
  InlineGrid,
  InlineStack,
  Page,
  ProgressBar,
  Tabs,
  Tag,
  Text,
  TextField,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { ArrowRightIcon, ImportIcon, MagicIcon, OrderIcon, SettingsIcon, StoreIcon, ImageIcon, SearchIcon } from "@shopify/polaris-icons";
import { AnimatedIcon, type IconMotion } from "@/components/motion/AnimatedIcon";
import { AnimatedNumber } from "@/components/motion/AnimatedNumber";
import { AnimatedWords } from "@/components/motion/AnimatedWords";

const SAMPLE_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="240"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6b25a"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="640" height="240" fill="url(#g)"/><text x="320" y="132" text-anchor="middle" font-family="sans-serif" font-size="28" fill="white">Sample image</text></svg>',
  );

const MOTIONS: { motion: IconMotion; label: string }[] = [
  { motion: "pop", label: "pop" },
  { motion: "wiggle", label: "wiggle" },
  { motion: "spin", label: "spin" },
  { motion: "nudge", label: "nudge" },
];

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="reveal">
      <Card>
        <BlockStack gap="400">
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">{title}</Text>
            <Text as="p" tone="subdued">{hint}</Text>
          </BlockStack>
          {children}
        </BlockStack>
      </Card>
    </div>
  );
}

const SWATCHES: { name: string; value: string }[] = [
  { name: "Accent", value: "var(--ui-accent)" },
  { name: "Accent 2", value: "var(--ui-accent-2)" },
  { name: "Surface", value: "var(--p-color-bg-surface)" },
  { name: "Surface 2", value: "var(--p-color-bg-surface-secondary)" },
  { name: "Glass", value: "var(--ui-glass)" },
  { name: "Border", value: "var(--p-color-border)" },
  { name: "Success", value: "var(--p-color-bg-fill-success)" },
  { name: "Critical", value: "var(--p-color-bg-fill-critical)" },
];

export function DesignView() {
  const [count, setCount] = useState(1280);
  const [replay, setReplay] = useState(0);
  const [text, setText] = useState("Brass Nandi Statue");
  const [url, setUrl] = useState("https://example.com/products/nandi");
  const [notes, setNotes] = useState("A multi-line field.\nIt grows as you type.");
  const [select, setSelect] = useState("draft");
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState(["all"]);
  const [tab, setTab] = useState(0);
  const [progress, setProgress] = useState(64);

  return (
    <Page fullWidth title="Design system" subtitle="Every element in the app's UI language — type, controls, motion and plain HTML tags.">
      <BlockStack gap="400">
        <Section title="Motion" hint="GSAP drives the page entrance, scroll reveals, counters, the tilting tiles and the magnetic button. Everything stills for visitors who prefer reduced motion.">
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Counter</Text>
              <Text as="p" variant="heading3xl"><AnimatedNumber value={count} /></Text>
              <InlineStack gap="200">
                <Button onClick={() => setCount((c) => c + Math.round(Math.random() * 900 + 100))}>Count up</Button>
                <Button onClick={() => setCount(0)} variant="tertiary">Reset</Button>
              </InlineStack>
            </BlockStack>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Word reveal</Text>
              <h3 key={replay} className="bento-title-gradient" style={{ margin: 0, fontSize: "1.75rem", fontWeight: 750, letterSpacing: "-0.03em" }}>
                <AnimatedWords text="Smooth, calm and quick." />
              </h3>
              <InlineStack><Button onClick={() => setReplay((r) => r + 1)}>Replay</Button></InlineStack>
            </BlockStack>
          </InlineGrid>

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">Animated icons — hover a tile</Text>
            <InlineStack gap="300">
              {MOTIONS.map(({ motion, label }) => (
                <span key={motion} className="bento-tile has-icon-motion" style={{ width: "8rem", alignItems: "center", textAlign: "center" } as CSSProperties}>
                  <span className="bento-icon"><AnimatedIcon source={MagicIcon} motion={motion} size={22} /></span>
                  <span className="bento-text">{label}</span>
                </span>
              ))}
              <span className="bento-tile" style={{ width: "8rem", alignItems: "center", textAlign: "center" }}>
                <span className="bento-icon"><AnimatedIcon source={OrderIcon} motion="pulse" trigger="always" size={22} /></span>
                <span className="bento-text">pulse (live)</span>
              </span>
              <span className="bento-tile" style={{ width: "8rem", alignItems: "center", textAlign: "center" }}>
                <span className="bento-icon"><AnimatedIcon source={StoreIcon} motion="float" trigger="always" size={22} /></span>
                <span className="bento-text">float</span>
              </span>
            </InlineStack>
          </BlockStack>

          <BlockStack gap="200">
            <Text as="h3" variant="headingSm">Tilting tile and magnetic button — move the mouse over them</Text>
            <InlineStack gap="400" blockAlign="center">
              <Link
                href="/design"
                className="bento-tile has-icon-motion"
                style={{ width: "16rem", "--tile-tint": "rgba(124,58,237,0.13)", "--tile-ink": "#6d28d9", "--tile-glow": "rgba(124,58,237,0.26)" } as CSSProperties}
              >
                <span className="bento-icon"><AnimatedIcon source={ImageIcon} motion="wiggle" size={20} /></span>
                <span className="bento-title">Bento tile</span>
                <span className="bento-text">Tilts toward the cursor, with a glow that follows it.</span>
                <span className="bento-go"><AnimatedIcon source={ArrowRightIcon} motion="nudge" size={16} /></span>
              </Link>
              <Button variant="primary" icon={ImportIcon} size="large">Magnetic button</Button>
            </InlineStack>
          </BlockStack>
        </Section>

        <Section title="Colour" hint="Tokens, not hard-coded values — each follows the light / dark theme.">
          <InlineGrid columns={{ xs: 2, sm: 4, lg: 8 }} gap="300">
            {SWATCHES.map((swatch) => (
              <BlockStack key={swatch.name} gap="100">
                <div style={{ height: "3.5rem", borderRadius: "0.75rem", background: swatch.value, boxShadow: "inset 0 0 0 1px var(--ui-glass-border)" }} />
                <Text as="span" variant="bodySm" tone="subdued">{swatch.name}</Text>
              </BlockStack>
            ))}
          </InlineGrid>
        </Section>

        <Section title="Buttons, badges and tags" hint="Press, hover and focus all respond.">
          <InlineStack gap="300" blockAlign="center">
            <Button variant="primary" icon={SearchIcon}>Primary</Button>
            <Button>Secondary</Button>
            <Button variant="tertiary">Tertiary</Button>
            <Button variant="plain">Plain link</Button>
            <Button tone="critical">Critical</Button>
            <Button loading>Loading</Button>
            <Button disabled>Disabled</Button>
          </InlineStack>
          <InlineStack gap="200">
            <Badge tone="success">Success</Badge>
            <Badge tone="info">Info</Badge>
            <Badge tone="attention">Attention</Badge>
            <Badge tone="critical">Critical</Badge>
            <Badge>Neutral</Badge>
            <Tag>brass</Tag>
            <Tag onRemove={() => {}}>removable</Tag>
          </InlineStack>
        </Section>

        <Section title="Form controls" hint="Text, URL, multi-line, select, checkbox, radios, a drop zone and tabs — focus any field for the brass halo.">
          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
            <TextField label="Text field" value={text} onChange={setText} autoComplete="off" clearButton onClearButtonClick={() => setText("")} />
            <TextField label="URL field" type="url" value={url} onChange={setUrl} autoComplete="off" prefix={<SettingsIcon />} />
            <TextField label="Multi-line text area" value={notes} onChange={setNotes} multiline={4} autoComplete="off" />
            <BlockStack gap="300">
              <Select label="Select" options={[{ label: "Draft", value: "draft" }, { label: "Active", value: "active" }, { label: "Archived", value: "archived" }]} value={select} onChange={setSelect} />
              <Checkbox label="A checkbox" checked={checked} onChange={setChecked} />
              <ChoiceList title="Radio choices" selected={radio} onChange={setRadio} choices={[{ label: "All products", value: "all" }, { label: "Only new", value: "new" }, { label: "Only updated", value: "updated" }]} />
            </BlockStack>
          </InlineGrid>
          <DropZone onDrop={() => {}} accept="image/*">
            <DropZone.FileUpload actionTitle="Add file" actionHint="or drop it here" />
          </DropZone>
          <Tabs tabs={[{ id: "a", content: "Overview" }, { id: "b", content: "Details" }, { id: "c", content: "History" }]} selected={tab} onSelect={setTab} />
          <BlockStack gap="200">
            <ProgressBar progress={progress} size="small" tone="primary" />
            <InlineStack gap="200">
              <Button onClick={() => setProgress((p) => Math.min(100, p + 12))}>Advance</Button>
              <Button variant="tertiary" onClick={() => setProgress(8)}>Reset</Button>
            </InlineStack>
          </BlockStack>
          <Banner tone="info" title="A banner"><p>Banners rise in when they appear.</p></Banner>
        </Section>

        <Section title="Every HTML tag" hint="Plain tags with no classes — what a description, a note or imported HTML looks like.">
          <div className="html-content">
            <h1>Heading 1</h1>
            <h2>Heading 2</h2>
            <h3>Heading 3</h3>
            <h4>Heading 4</h4>
            <h5>Heading 5</h5>
            <h6>Heading 6</h6>
            <p>
              A paragraph with <strong>strong</strong>, <em>emphasis</em>, <u>underline</u>, <mark>highlight</mark>, <del>deleted</del>, <ins>inserted</ins>,{" "}
              <small>small print</small>, H<sub>2</sub>O, x<sup>2</sup>, an <abbr title="HyperText Markup Language">HTML</abbr> abbreviation, a{" "}
              <a href="#links">link</a>, <code>inline code</code>, <kbd>Ctrl</kbd> + <kbd>K</kbd>, <samp>sample output</samp>, <var>x</var> and{" "}
              <q>a short quotation</q> posted on <time dateTime="2026-10-08">8 October 2026</time> by <cite>the team</cite>.
            </p>
            <blockquote>
              <p>A blockquote sits in a soft panel with a brass edge.</p>
            </blockquote>
            <pre><code>{`const price = Number(row.price);\nawait updateProduct({ id, price });`}</code></pre>
            <ul>
              <li>Unordered list item</li>
              <li>Another item<ul><li>A nested item</li></ul></li>
            </ul>
            <ol>
              <li>Ordered list item</li>
              <li>Another item</li>
            </ol>
            <dl>
              <dt>Definition term</dt>
              <dd>Its definition.</dd>
            </dl>
            <hr />
            <table>
              <caption>A table</caption>
              <thead><tr><th>SKU</th><th>Product</th><th>Stock</th></tr></thead>
              <tbody>
                <tr><td>BHU2003A</td><td>Brass Nandi Statue</td><td>12</td></tr>
                <tr><td>BHU2236A</td><td>Brass Swan Bowl</td><td>0</td></tr>
              </tbody>
            </table>
            <figure>
              {/* eslint-disable-next-line @next/next/no-img-element -- an inline data-URL sample; next/image doesn't apply */}
              <img src={SAMPLE_IMAGE} alt="A gradient sample image" width={640} height={240} />
              <figcaption>A figure and its caption</figcaption>
            </figure>
            <details>
              <summary>A details / summary disclosure</summary>
              <p>Hidden until opened.</p>
            </details>
            <address>Brasstown Studio<br />12 Foundry Lane</address>
            <fieldset>
              <legend>A fieldset</legend>
              <p>
                <label htmlFor="raw-text">Plain text input</label>
                <input id="raw-text" type="text" placeholder="Type here" />
              </p>
              <p>
                <label htmlFor="raw-area">Plain text area</label>
                <textarea id="raw-area" placeholder="Longer text" />
              </p>
              <p>
                <label htmlFor="raw-select">Plain select</label>
                <select id="raw-select"><option>One</option><option>Two</option></select>
              </p>
              <p>
                <label><input type="checkbox" defaultChecked /> Plain checkbox</label>{" "}
                <label><input type="radio" name="raw-radio" defaultChecked /> Radio</label>
              </p>
              <p>
                <input type="range" defaultValue={40} aria-label="Plain range" />
              </p>
              <p>
                <input type="color" defaultValue="#b8862b" aria-label="Plain colour" />{" "}
                <input type="file" aria-label="Plain file" />
              </p>
              <p>
                <progress value={64} max={100}>64%</progress>
              </p>
              <p>
                <meter value={0.7} min={0} max={1}>70%</meter>
              </p>
              <p>
                <button type="button">Plain button</button>
              </p>
            </fieldset>
          </div>
        </Section>
      </BlockStack>
    </Page>
  );
}
