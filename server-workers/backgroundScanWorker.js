// Plain CommonJS, deliberately OUTSIDE the app/lib TypeScript source tree —
// `worker_threads.Worker` loads its target file directly through Node's own
// module loader at runtime, not through Next's TypeScript/bundler pipeline,
// so this has to already be plain, directly-runnable JS. This is what makes
// `lib/storeScraper/backgroundScanPool.ts`'s background-scan step run its
// (CPU-bound, single-thread-blocking) image decode + brightness check
// spread across real OS threads instead of serialized on one.
//
// Mirrors `lib/storeScraper/plainBackground.ts`'s `isPlainBackgroundImage`
// — duplicated here rather than imported, for the reason above. Keep the
// two in sync if the heuristic ever changes.

const { parentPort } = require("node:worker_threads");
const { Jimp, intToRGBA } = require("jimp");

const SAMPLE_MARGIN_FRACTION = 0.04;
const STEPS_PER_EDGE = 8;
const MIN_UNIFORM_FRACTION = 0.5;
const SAMPLE_BLOCK_RADIUS = 3;
const MAX_COLOR_DISTANCE = 28;
const CORNER_CONSISTENCY_THRESHOLD = 22;

// Block-averaged color, not one exact pixel — a thin dimension-arrow/label
// overlay running along an edge (common on size-chart product shots) can
// span most of that edge's length, and single-pixel sampling read that as
// most of the edge being a different color, wrongly flagging a genuinely
// plain background. See `plainBackground.ts`'s own note (source of truth).
function sampleBlockColor(image, cx, cy, width, height) {
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;
  for (let dy = -SAMPLE_BLOCK_RADIUS; dy <= SAMPLE_BLOCK_RADIUS; dy++) {
    for (let dx = -SAMPLE_BLOCK_RADIUS; dx <= SAMPLE_BLOCK_RADIUS; dx++) {
      const x = Math.min(width - 1, Math.max(0, cx + dx));
      const y = Math.min(height - 1, Math.max(0, cy + dy));
      const { r, g, b } = intToRGBA(image.getPixelColor(x, y));
      rSum += r;
      gSum += g;
      bSum += b;
      count++;
    }
  }
  return [rSum / count, gSum / count, bSum / count];
}

function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// Corners are the PRIMARY signal, not the full border — a product,
// however wide/tall/round, essentially never reaches into the literal
// corners of its own photo, so corners stay reliable background
// regardless of crop tightness, unlike mid-edge points a wide object can
// legitimately occupy even on a plain backdrop. A real gradient/vignette/
// lifestyle photo visibly differs corner to corner. Not restricted to
// white — this app's background-customiser can replace ANY flat source
// color. See `plainBackground.ts`'s own note for the full reasoning.
async function isPlainBackgroundBuffer(bytes) {
  let image;
  try {
    image = await Jimp.fromBuffer(bytes);
  } catch {
    return false;
  }

  const { width, height } = image.bitmap;
  if (width < 8 || height < 8) return false;

  const marginX = Math.max(1, Math.round(width * SAMPLE_MARGIN_FRACTION));
  const marginY = Math.max(1, Math.round(height * SAMPLE_MARGIN_FRACTION));

  const corners = [
    [marginX, marginY],
    [width - 1 - marginX, marginY],
    [marginX, height - 1 - marginY],
    [width - 1 - marginX, height - 1 - marginY],
  ];
  const cornerColors = corners.map(([x, y]) => sampleBlockColor(image, x, y, width, height));

  for (let i = 0; i < cornerColors.length; i++) {
    for (let j = i + 1; j < cornerColors.length; j++) {
      if (colorDistance(cornerColors[i], cornerColors[j]) > CORNER_CONSISTENCY_THRESHOLD) return false;
    }
  }

  const reference = [
    cornerColors.reduce((sum, c) => sum + c[0], 0) / cornerColors.length,
    cornerColors.reduce((sum, c) => sum + c[1], 0) / cornerColors.length,
    cornerColors.reduce((sum, c) => sum + c[2], 0) / cornerColors.length,
  ];

  const samplePoints = [];
  for (let i = 0; i <= STEPS_PER_EDGE; i++) {
    const fx = Math.round((width - 1) * (i / STEPS_PER_EDGE));
    const fy = Math.round((height - 1) * (i / STEPS_PER_EDGE));
    samplePoints.push([fx, marginY], [fx, height - 1 - marginY]);
    samplePoints.push([marginX, fy], [width - 1 - marginX, fy]);
  }

  const colors = samplePoints.map(([x, y]) => sampleBlockColor(image, x, y, width, height));
  const conforming = colors.filter((c) => colorDistance(c, reference) <= MAX_COLOR_DISTANCE);
  return conforming.length / colors.length >= MIN_UNIFORM_FRACTION;
}

parentPort.on("message", (msg) => {
  const { id, bytes } = msg;
  isPlainBackgroundBuffer(Buffer.from(bytes))
    .then((isPlain) => parentPort.postMessage({ id, isPlain }))
    // Conservative on a genuine crash mid-decode too, matching the TS
    // version's own "keep it on anything ambiguous" reasoning.
    .catch(() => parentPort.postMessage({ id, isPlain: true }));
});
