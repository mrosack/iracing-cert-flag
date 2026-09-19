import sharp from "sharp";
import { Preset } from "./presets";
import { buildBackgroundSvg, buildBorderSvg } from "./checkerboard";

export interface ComposeOptions {
  jpegQuality?: number;
}

// The canvas (always 3:2) is treated as a GRID_COLS x GRID_ROWS checkerboard - 12:8 is also
// exactly 3:2, so every square comes out perfectly square, a real checkered-flag pattern
// rather than independently-sized border strips. The certificate covers a smaller
// CERT_COLS x CERT_ROWS block of that same grid, centered, leaving a uniform 2-square
// margin left/right and 1-square margin top/bottom - so no matter which edge a print shop's
// hardware (e.g. a flag's sewn grommet header) lands on, only checker squares are
// sacrificed, never certificate content.
const GRID_COLS = 12;
const GRID_ROWS = 8;
const CERT_COLS = 8;
const CERT_ROWS = 6;

/**
 * Composes a rasterized certificate PNG onto a checkered-flag-bordered canvas.
 * Pure function: no filesystem or AWS calls, safe to unit test directly.
 */
export async function compose(certPngBuffer: Buffer, preset: Preset, options: ComposeOptions = {}): Promise<Buffer> {
  const { jpegQuality = 92 } = options;
  const canvasW = preset.width;
  const canvasH = preset.height;

  const certMeta = await sharp(certPngBuffer).metadata();
  if (!certMeta.width || !certMeta.height) {
    throw new Error("Could not read rasterized certificate image dimensions");
  }

  const cellSize = canvasW / GRID_COLS;
  const certW = CERT_COLS * cellSize;
  const certH = CERT_ROWS * cellSize;
  const left = ((GRID_COLS - CERT_COLS) / 2) * cellSize;
  const top = ((GRID_ROWS - CERT_ROWS) / 2) * cellSize;

  const resizedCert = await sharp(certPngBuffer)
    .resize(Math.round(certW), Math.round(certH), { fit: "fill" })
    .toBuffer();

  const backgroundSvg = buildBackgroundSvg(canvasW, canvasH, GRID_COLS, GRID_ROWS);
  const lineWidth = Math.max(3, Math.round(canvasH * 0.0022));
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
