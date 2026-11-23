import type { AuditCategory, Finding, SeoAuditReport, Severity } from "./types";

const CATEGORY_LABEL: Record<AuditCategory, string> = {
  "on-page": "On-page SEO",
  technical: "Technical SEO",
  "broken-links": "Broken links & images",
  "structured-data": "Structured data",
  performance: "Page speed & Core Web Vitals",
  social: "Social media",
};

const SEVERITY_ORDER: Severity[] = ["critical", "warning", "info"];

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Only http(s) links become clickable, so a hostile URL can never become a javascript: link in the exported file. */
function link(url: string): string {
  return /^https?:\/\//i.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(url)}</a>` : esc(url);
}

const tone = (score: number): string => (score >= 90 ? "good" : score >= 50 ? "warn" : "bad");

const STYLE = `
:root{--bg:#f4f1ea;--card:#fff;--ink:#1d1b16;--mute:#6b665b;--line:#e4dfd3;--good:#1f7a4d;--warn:#b7791f;--bad:#c0392b}
@media (prefers-color-scheme:dark){:root{--bg:#161512;--card:#201e1a;--ink:#f2efe7;--mute:#a09a8b;--line:#34312b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 Georgia,'Times New Roman',serif}
main{max-width:1000px;margin:0 auto;padding:40px 20px 80px}
h1{font-size:34px;margin:0 0 4px;letter-spacing:-.02em}h2{font-size:22px;margin:40px 0 14px;padding-bottom:8px;border-bottom:2px solid var(--ink)}
.sub{color:var(--mute);font-family:system-ui,sans-serif;font-size:13px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.stat b{display:block;font-size:30px;line-height:1.1}.stat span{font:12px system-ui,sans-serif;color:var(--mute);text-transform:uppercase;letter-spacing:.06em}
.good{color:var(--good)}.warn{color:var(--warn)}.bad{color:var(--bad)}.info{color:var(--mute)}
.bar{height:8px;border-radius:99px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;background:currentColor}
.cat{margin:10px 0;font-family:system-ui,sans-serif;font-size:13px}.cat div:first-child{display:flex;justify-content:space-between;margin-bottom:4px}
.finding{background:var(--card);border:1px solid var(--line);border-left:5px solid currentColor;border-radius:10px;padding:12px 16px;margin:10px 0}
.finding p{margin:4px 0;color:var(--ink)}.finding .rec{color:var(--mute);font-size:14px}.finding .page{font:12px system-ui,sans-serif;word-break:break-all}
.tag{display:inline-block;font:11px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.08em;border:1px solid currentColor;border-radius:99px;padding:1px 9px;margin-right:6px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);font-size:14px}
th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);word-break:break-word}th{font:12px system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;color:var(--mute)}
a{color:inherit}
@media print{body{background:#fff}.finding{break-inside:avoid}}
`;

function findingBlock(f: Finding): string {
  const cls = f.severity === "critical" ? "bad" : f.severity === "warning" ? "warn" : "info";
  return `<div class="finding ${cls}"><span class="tag">${esc(f.severity)}</span><span class="tag" style="color:var(--mute)">${esc(CATEGORY_LABEL[f.category])}</span>
<p>${esc(f.message)}</p><p class="rec">${esc(f.recommendation)}</p><p class="page">${link(f.page)}</p></div>`;
}

function statBox(label: string, value: string, cls = ""): string {
  return `<div class="stat"><b class="${cls}">${value}</b><span>${esc(label)}</span></div>`;
}

/** A self-contained, styled HTML copy of the audit — one file, no external requests, readable offline and printable to PDF. */
export function buildAuditHtml(report: SeoAuditReport): string {
  const live = report.liveStore;
  const stats = [
    statBox("SEO score", String(report.overallScore), tone(report.overallScore)),
    statBox("Pages crawled", report.pagesCrawled.length.toLocaleString("en-US")),
    live ? statBox("Pages in live store", live.total.toLocaleString("en-US")) : "",
    statBox("Critical", String(report.severityCounts.critical), "bad"),
    statBox("Warnings", String(report.severityCounts.warning), "warn"),
    statBox("Info", String(report.severityCounts.info)),
  ].join("");

  const liveBlock = live
    ? `<h2>Live store pages</h2><p class="sub">Read directly from ${esc(live.shop)} (primary domain ${esc(live.primaryDomain)}).</p>
<table><tr><th>Type</th><th>Count</th></tr><tr><td>Home</td><td>${live.counts.home}</td></tr><tr><td>Products</td><td>${live.counts.products}</td></tr><tr><td>Collections</td><td>${live.counts.collections}</td></tr><tr><td>Pages</td><td>${live.counts.pages}</td></tr><tr><td>Blog articles</td><td>${live.counts.articles}</td></tr><tr><td><b>Total</b></td><td><b>${live.total}</b></td></tr></table>
${live.errors.length ? `<p class="sub bad">Some types could not be read, so the total may be low: ${esc(live.errors.join("; "))}</p>` : ""}`
    : "";

  const cats = report.categoryScores
    .map(
      (c) =>
        `<div class="cat ${tone(c.score)}"><div><span style="color:var(--ink)">${esc(CATEGORY_LABEL[c.category])}</span><span>${c.score}%</span></div><div class="bar"><i style="width:${c.score}%"></i></div></div>`,
    )
    .join("");

  const p = report.performance;
  const perfValues: [string, number | null][] = p
    ? [
        ["Performance", p.performanceScore],
        ["LCP (s)", p.lcpSeconds],
        ["CLS", p.cls],
        ["INP (ms)", p.inpMs],
        ["FCP (s)", p.fcpSeconds],
        ["TBT (ms)", p.tbtMs],
      ]
    : [];
  const perf = p
    ? `<h2>Core Web Vitals (${esc(p.strategy)})</h2>${
        p.error
          ? `<p class="sub bad">${esc(p.error)}</p>`
          : `<div class="grid">${perfValues.map(([l, v]) => statBox(l, v === null ? "—" : esc(v))).join("")}</div>`
      }`
    : "";

  const findings = SEVERITY_ORDER.map((sev) => {
    const list = report.findings.filter((f) => f.severity === sev);
    return list.length ? `<h2>${sev[0].toUpperCase() + sev.slice(1)} (${list.length})</h2>${list.map(findingBlock).join("")}` : "";
  }).join("");

  const pages = `<h2>Pages crawled (${report.pagesCrawled.length})</h2><table><tr><th>Page</th><th>Title</th></tr>${report.pagesCrawled
    .map((u) => `<tr><td>${link(u)}</td><td>${esc(report.pageTitles[u] ?? "")}</td></tr>`)
    .join("")}</table>`;

  const social = report.social.length
    ? `<h2>Social presence</h2><table><tr><th>Platform</th><th>Link</th></tr>${report.social
        .map((s) => `<tr><td>${esc(s.platform)}</td><td>${s.url ? link(s.url) : "Not found"}</td></tr>`)
        .join("")}</table>`
    : "";

  const keywords = report.keywordDensity.length
    ? `<h2>Homepage keywords (${report.homepageWordCount} words)</h2><table><tr><th>Keyword</th><th>Count</th><th>Density</th></tr>${report.keywordDensity
        .map((k) => `<tr><td>${esc(k.keyword)}</td><td>${k.instances}</td><td>${k.density.toFixed(2)}%</td></tr>`)
        .join("")}</table>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEO audit — ${esc(report.domain)}</title><style>${STYLE}</style></head><body><main>
<h1>SEO audit</h1><div class="sub">${link(report.domain)} · ${esc(new Date(report.generatedAt).toLocaleString("en-US"))}</div>
<div class="grid">${stats}</div>${liveBlock}<h2>Score by category</h2>${cats}${perf}${findings}${social}${keywords}${pages}
<p class="sub" style="margin-top:40px">Score computed by this tool from the findings above; not comparable to third-party scores.</p></main></body></html>`;
}
