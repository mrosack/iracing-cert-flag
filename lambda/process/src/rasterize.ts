import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const PDF_MAGIC = "%PDF-";
const RASTERIZE_TIMEOUT_MS = 20_000;

export function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_MAGIC.length).toString("utf8") === PDF_MAGIC;
}

/**
 * Renders page 1 of a PDF buffer to a PNG buffer, natively at targetHeightPx tall
 * (width computed to preserve aspect ratio), using poppler's pdftoppm - which must be
 * installed in the runtime environment (see lambda/process/Dockerfile). Rendering at the
 * exact output height (rather than a fixed DPI) keeps the certificate crisp across every
 * output preset instead of rasterizing small and upscaling into a blurry large flag.
 *
 * Note: `-scale-to-x -1` must be passed explicitly alongside `-scale-to-y` - if omitted,
 * pdftoppm does NOT preserve aspect ratio, it silently falls back to the default 150 DPI
 * on the unset axis.
 */
export async function rasterizePdfFirstPage(pdfBuffer: Buffer, targetHeightPx: number): Promise<Buffer> {
  if (!isPdf(pdfBuffer)) {
    throw new Error("Uploaded file is not a valid PDF");
  }

  const id = randomUUID();
  const inputPath = `/tmp/${id}.pdf`;
  const outputPrefix = `/tmp/${id}`;
  const outputPath = `${outputPrefix}.png`;

  try {
    await writeFile(inputPath, pdfBuffer);
    await execFileAsync(
      "pdftoppm",
      [
        "-f",
        "1",
        "-l",
        "1",
        "-scale-to-x",
        "-1",
        "-scale-to-y",
        String(targetHeightPx),
        "-png",
        "-singlefile",
        inputPath,
        outputPrefix,
      ],
      { timeout: RASTERIZE_TIMEOUT_MS }
    );
    return await readFile(outputPath);
  } catch (err) {
    throw new Error(`Failed to rasterize PDF: ${(err as Error).message}`);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}
