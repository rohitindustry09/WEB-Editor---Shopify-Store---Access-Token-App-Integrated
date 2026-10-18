import "server-only";
import { Jimp, intToRGBA } from "jimp";

/** How far inside the true edge to sample — right at pixel 0 risks JPEG edge artifacts/anti-aliasing; a few percent in is still "background," not product. */
const SAMPLE_MARGIN_FRACTION = 0.04;
/** Points sampled per edge (each edge gets this many + 1, at the inset margin), used for the SECONDARY border check below — the corners are checked separately and first. */
const STEPS_PER_EDGE = 8;
/**
 * Once the corners have already established a trustworthy reference color
 * (see `CORNER_CONSISTENCY_THRESHOLD` below), the rest of the border is
 * allowed to be wrong about HALF the time — a wide/round product (a big
 * vase, say) can legitimately occupy most of the mid-edge points even on
 * a plain background, since those points sit directly left/right/above/
 * below center, exactly where a wide object reaches, unlike the corners.
 */
const MIN_UNIFORM_FRACTION = 0.5;
/** Half-width of the block averaged around each sample point — see the block-average note below. 3 → a 7×7 block. */
const SAMPLE_BLOCK_RADIUS = 3;
/** Max Euclidean RGB distance a sampled point's color may be from the image's own reference backdrop color and still count as "the same flat backdrop." */
const MAX_COLOR_DISTANCE = 28;
/**
 * Max Euclidean RGB distance allowed between any two of the four corners
 * for them to count as "the same backdrop color" and become the trusted
 * reference. This is the PRIMARY signal, not the full border outline: a
 * product — however wide, tall, or round — essentially never reaches into
 * the literal corners of its own photo, so corners stay reliable
 * background regardless of how tightly the shot is cropped, unlike
 * mid-edge points. A real gradient/vignette/lifestyle background, by
 * contrast, visibly differs corner to corner (that's what a gradient or a
 * blurred real scene actually looks like) — catching that difference
 * here is what a full-border scan, fooled by a locally-smooth blur,
 * could miss.
 */
const CORNER_CONSISTENCY_THRESHOLD = 22;

/**
 * A size-chart-style overlay (a dimension arrow, "9 cm" text) drawn right
 * along an edge is thin — a couple of pixels wide — but can run almost
 * the FULL LENGTH of one edge, which single-pixel sampling reads as most
 * of that entire edge being a different color, enough on its own to tip a
 * genuinely plain background past the tolerance above and get it wrongly
 * flagged (confirmed against a real flagged image: a plain background
 * product shot with dimension arrows drawn along its border). Averaging a
 * small block centered on each sample point instead of reading one exact
 * pixel fixes this without weakening real gradient/lifestyle detection: a
 * thin 1-3px line crossing a 7×7 block only shifts that block's average
 * a little, while an actual gradient/lifestyle background has no such
 * thin-line structure — the whole block there genuinely is a different
 * color, average included.
 */
function sampleBlockColor(image: Awaited<ReturnType<typeof Jimp.fromBuffer>>, cx: number, cy: number, width: number, height: number): [number, number, number] {
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

function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/**
 * Heuristically classifies whether an image looks like a plain, single-
 * flat-color studio backdrop — white, cream, green, gray, wood-tone,
 * whatever — using the CORNERS as the primary signal, not the full border.
 * A product, however wide/tall/round, essentially never reaches into the
 * literal corners of its own photo — so the corners stay reliable
 * background regardless of how tightly cropped the shot is, unlike
 * mid-edge points a wide object can legitimately occupy even on a plain
 * backdrop. A real gradient/vignette/lifestyle photo, by contrast,
 * visibly differs corner to corner. If the four corners agree with each
 * other, that becomes the trusted reference color and the rest of the
 * border only needs to loosely agree with it; if the corners themselves
 * already disagree, this is a designed/uneven background and nothing
 * else needs checking.
 *
 * NOT restricted to white: this app's own background-customiser tool can
 * already replace ANY flat source color the user points it at (see
 * `replace-color` mode in `backgroundComposite.ts`), so a plain colored
 * backdrop is just as "already handleable" as a plain white one. Cheap
 * and dependent on real pixel data, not a filename/position guess —
 * deliberately conservative (returns `false`, i.e. "keep it," on anything
 * ambiguous or undecodable) since keeping an extra product photo is a
 * much smaller mistake than dropping one that mattered.
 */
export async function isPlainBackgroundImage(bytes: Buffer): Promise<boolean> {
  let image: Awaited<ReturnType<typeof Jimp.fromBuffer>>;
  try {
    image = await Jimp.fromBuffer(bytes);
  } catch {
    return false;
  }

  const { width, height } = image.bitmap;
  if (width < 8 || height < 8) return false;

  const marginX = Math.max(1, Math.round(width * SAMPLE_MARGIN_FRACTION));
  const marginY = Math.max(1, Math.round(height * SAMPLE_MARGIN_FRACTION));

  const corners: [number, number][] = [
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

  // The corners agree — average them into the trusted reference color,
  // then check the rest of the border loosely against it (see
  // `MIN_UNIFORM_FRACTION`'s own note on why that check stays lenient).
  const reference: [number, number, number] = [
    cornerColors.reduce((sum, c) => sum + c[0], 0) / cornerColors.length,
    cornerColors.reduce((sum, c) => sum + c[1], 0) / cornerColors.length,
    cornerColors.reduce((sum, c) => sum + c[2], 0) / cornerColors.length,
  ];

  const samplePoints: [number, number][] = [];
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
