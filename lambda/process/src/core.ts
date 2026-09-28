import sharp from "sharp";
import { Preset } from "./presets";
import { buildBackgroundSvg, buildBorderSvg } from "./checkerboard";

export interface ComposeOptions {
  jpegQuality?: number;
}

// The finished flag area (always 3:2) is treated as a GRID_COLS x GRID_ROWS checkerboard -
// 12:8 is also exactly 3:2, so every square comes out perfectly square, a real checkered-flag
// pattern rather than independently-sized border strips. The certificate covers a smaller
// CERT_COLS x CERT_ROWS block of that same grid, centered, leaving a uniform 2-square
// margin left/right and 1-square margin top/bottom - so no matter which edge a print shop's
// hardware (e.g. a flag's sewn grommet header) lands on, only checker squares are
// sacrificed, never certificate content.
const GRID_COLS = 12;
const GRID_ROWS = 8;
const CERT_COLS = 8;
const CERT_ROWS = 6;

// Anley's artwork template, measured off the guides they supplied: a 1077 x 747 artboard with
// two rows of hem stitching inset 21.5 and 42.5 from every edge. The finished flag's visible
// face runs out to the OUTER stitch row - photos of a printed flag show the fabric edge only a
// sliver beyond it - so that, not the inner row, is what the checkerboard should fill. (The
// inner row is the conservative "safe area" mark; sizing the grid to it left the outer ring of
// squares reading ~26% deeper than the rest once the hem landed further out.)
const TEMPLATE_WIDTH = 1077;
const TEMPLATE_HEIGHT = 747;
const OUTER_STITCH_INSET = 21.5;

// The region inside the outer stitch row is 1034 x 704 (1.469), not 3:2, so a square-celled
// 12x8 grid can't fill it exactly. Take the largest 3:2 box that fits, which is width-limited:
// the grid meets the stitch row exactly on the left and right, and stops a little short of it
// top and bottom. That errs toward a slightly deep outer ring rather than a clipped one, which
// is the forgiving direction - a chopped-off outer row is what started all this.
const VISIBLE_WIDTH = TEMPLATE_WIDTH - 2 * OUTER_STITCH_INSET;
const VISIBLE_HEIGHT = (VISIBLE_WIDTH * GRID_ROWS) / GRID_COLS;

// Sacrificial margin outside the grid, as a fraction of the grid's own width/height. A
// preset's dimensions are the VISIBLE flag face; the rendered canvas is that plus these
// margins, which keeps the canvas at the artboard's exact ratio so the printer's fit-to-
// template scaling doesn't crop it.
const BLEED_X_RATIO = OUTER_STITCH_INSET / VISIBLE_WIDTH;
const BLEED_Y_RATIO = (TEMPLATE_HEIGHT - VISIBLE_HEIGHT) / 2 / VISIBLE_HEIGHT;

/**
 * Pixel size of the certificate's slot within the canvas for a given preset. Callers that
 * rasterize the source PDF (e.g. the handler) should target this size directly rather than
 * the full canvas size - rasterizing larger and then downscaling in compose() would apply a
 * lossy resize on top of an already-rendered image, which visibly amplifies subtle gradient
 * banding in certificate backgrounds into ringing artifacts.
 */
export function getCertPixelSize(preset: Preset): { width: number; height: number } {
  const cellSize = preset.width / GRID_COLS;
  return { width: Math.round(CERT_COLS * cellSize), height: Math.round(CERT_ROWS * cellSize) };
}

/**
 * Composes a rasterized certificate PNG onto a checkered-flag-bordered canvas.
 * Pure function: no filesystem or AWS calls, safe to unit test directly.
 */
export async function compose(certPngBuffer: Buffer, preset: Preset, options: ComposeOptions = {}): Promise<Buffer> {
  const { jpegQuality = 100 } = options;
  const visibleW = preset.width;
  const visibleH = preset.height;
  const bleedX = Math.round(BLEED_X_RATIO * visibleW);
  const bleedY = Math.round(BLEED_Y_RATIO * visibleH);
  const canvasW = visibleW + 2 * bleedX;
  const canvasH = visibleH + 2 * bleedY;

  const certMeta = await sharp(certPngBuffer).metadata();
  if (!certMeta.width || !certMeta.height) {
    throw new Error("Could not read rasterized certificate image dimensions");
  }

  // The grid is sized against the visible face, not the bled canvas, so the printed result
  // keeps the intended 12x8 layout once the hem removes the margin.
  const cellSize = visibleW / GRID_COLS;
  const certW = CERT_COLS * cellSize;
  const certH = CERT_ROWS * cellSize;
  const left = bleedX + ((GRID_COLS - CERT_COLS) / 2) * cellSize;
  const top = bleedY + ((GRID_ROWS - CERT_ROWS) / 2) * cellSize;

  const resizedCert = await sharp(certPngBuffer)
    .resize(Math.round(certW), Math.round(certH), { fit: "fill" })
    .toBuffer();

  const backgroundSvg = buildBackgroundSvg(canvasW, canvasH, GRID_COLS, GRID_ROWS, cellSize, bleedX, bleedY);
  const lineWidth = Math.max(3, Math.round(visibleH * 0.0022));
  const borderSvg = buildBorderSvg(canvasW, canvasH, left, top, certW, certH, lineWidth);

  const composed = await sharp(Buffer.from(backgroundSvg))
    .composite([{ input: resizedCert, left: Math.round(left), top: Math.round(top) }])
    .png()
    .toBuffer();

  return sharp(composed)
    .composite([{ input: Buffer.from(borderSvg) }])
    .jpeg({ quality: jpegQuality, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
}
