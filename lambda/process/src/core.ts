import sharp from "sharp";
import { Preset } from "./presets";
import { buildBackgroundSvg, buildDividerSvg } from "./checkerboard";

export interface ComposeOptions {
  /** Draw a thin black seam line between the checker border and the cert. Off by default. */
  divider?: boolean;
  jpegQuality?: number;
}

const MIN_BORDER_FRACTION = 0.03; // below this, fall back to letterboxing instead of near-zero checker strips

/**
 * Composes a rasterized certificate PNG onto a checkered-flag-bordered canvas.
 * Pure function: no filesystem or AWS calls, safe to unit test directly.
 */
export async function compose(certPngBuffer: Buffer, preset: Preset, options: ComposeOptions = {}): Promise<Buffer> {
  const { divider = false, jpegQuality = 92 } = options;
  const canvasW = preset.width;
  const canvasH = preset.height;

  const certMeta = await sharp(certPngBuffer).metadata();
  if (!certMeta.width || !certMeta.height) {
    throw new Error("Could not read rasterized certificate image dimensions");
  }
  const certAspect = certMeta.width / certMeta.height;

  let certW = Math.round(certAspect * canvasH);
  let certH = canvasH;
  let top = 0;

  const minCertWidth = Math.round(canvasW * (1 - 2 * MIN_BORDER_FRACTION));
  if (certW > minCertWidth) {
    // Certificate is unusually wide relative to the canvas: clamp width and letterbox vertically instead.
    certW = minCertWidth;
    certH = Math.round(certW / certAspect);
    top = Math.round((canvasH - certH) / 2);
  }

  const borderEach = Math.round((canvasW - certW) / 2);

  const resizedCert = await sharp(certPngBuffer)
    .resize(certW, certH, { fit: "fill" })
    .toBuffer();

  const backgroundSvg = buildBackgroundSvg(canvasW, canvasH, borderEach);
  let pipeline = sharp(Buffer.from(backgroundSvg)).composite([{ input: resizedCert, left: borderEach, top }]);

  if (divider) {
    const lineWidth = Math.max(2, Math.round(canvasH * 0.0017));
    const dividerSvg = buildDividerSvg(canvasW, canvasH, borderEach, lineWidth);
    pipeline = sharp(await pipeline.png().toBuffer()).composite([{ input: Buffer.from(dividerSvg) }]);
  }

  return pipeline.jpeg({ quality: jpegQuality, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}
