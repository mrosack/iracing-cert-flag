import { rasterizePdfFirstPage } from "./rasterize";
import { compose, getCertPixelSize } from "./core";
import { flattenNearWhiteRadialShadings } from "./flattenShadings";
import { resolvePreset } from "./presets";

/**
 * Alternate Lambda entrypoint for local testing via the Docker Runtime Interface Emulator.
 * Bypasses S3 entirely: pass { pdfBase64, preset } and get back { jpgBase64 }.
 * Not wired to any AWS resource; used only for local smoke tests (see the repo README).
 */
export const handler = async (event: { pdfBase64: string; preset?: string }) => {
  const preset = resolvePreset(event.preset);
  const pdfBuffer = Buffer.from(event.pdfBase64, "base64");
  const flattenedPdf = await flattenNearWhiteRadialShadings(pdfBuffer);
  const certPng = await rasterizePdfFirstPage(flattenedPdf, getCertPixelSize(preset).height);
  const jpgBuffer = await compose(certPng, preset);
  return { jpgBase64: jpgBuffer.toString("base64") };
};
