// Plain CommonJS — see `backgroundScanWorker.js`'s own header note for why.
//
// A SEPARATE worker from `backgroundScanWorker.js`, used ONLY by the
// "Scan the flagged items" re-verification pool (`verify-flagged/route.ts`),
// deliberately NOT by the main background scan or the export-time re-check
// (`plainBackground.ts`). Checked against real catalog images this session:
// a single-margin check (like `backgroundScanWorker.js` uses) misses plain
// white backgrounds that have a bold "size in cm" dimension-arrow overlay
// running along an edge — the overlay is too thick for the existing block-
// averaging to absorb. Sampling a SECOND, more inset ring (clear of where
// overlay graphics are typically drawn) and accepting either ring recovers
// those cases.
//
// This two-ring check is measurably less precise than the single-margin one
// in the other direction: tested against 300 real currently-flagged images,
// it introduced ~17% new false negatives among what it "corrected" (mostly
// lifestyle photos with an open, roughly-uniform patch near the frame that
// the inset ring mistook for background). That tradeoff is only acceptable
// here because this pool's whole purpose is producing SUGGESTIONS for a
// human to review (auto-selected thumbnails the user confirms or unchecks
// before "Done") — not a silent, unreviewed classification. Do not point
// the main scan or export path at this worker.

const { parentPort } = require("node:worker_threads");
const { Jimp, intToRGBA } = require("jimp");

const MARGINS = [0.04, 0.10];
const STEPS_PER_EDGE = 8;
const MIN_UNIFORM_FRACTION = 0.5;
const SAMPLE_BLOCK_RADIUS = 3;
const MAX_COLOR_DISTANCE = 28;
const CORNER_CONSISTENCY_THRESHOLD = 22;

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

function ringIsPlain(image, width, height, marginFraction) {
  const marginX = Math.max(1, Math.round(width * marginFraction));
  const marginY = Math.max(1, Math.round(height * marginFraction));

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

async function isPlainBackgroundBuffer(bytes) {
  let image;
  try {
    image = await Jimp.fromBuffer(bytes);
  } catch {
    return false;
  }

  const { width, height } = image.bitmap;
  if (width < 8 || height < 8) return false;

  return MARGINS.some((margin) => ringIsPlain(image, width, height, margin));
}

parentPort.on("message", (msg) => {
  const { id, bytes } = msg;
  isPlainBackgroundBuffer(Buffer.from(bytes))
    .then((isPlain) => parentPort.postMessage({ id, isPlain }))
    .catch(() => parentPort.postMessage({ id, isPlain: true }));
});
