import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const PDF_MAGIC = "%PDF-";
const RASTERIZE_TIMEOUT_MS = 10_000;
const RASTERIZE_DPI = 300;

export function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, PDF_MAGIC.length).toString("utf8") === PDF_MAGIC;
}

/**
 * Renders page 1 of a PDF buffer to a PNG buffer at high DPI using poppler's pdftoppm,
 * which must be installed in the runtime environment (see lambda/process/Dockerfile).
 */
export async function rasterizePdfFirstPage(pdfBuffer: Buffer): Promise<Buffer> {
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
      ["-f", "1", "-l", "1", "-r", String(RASTERIZE_DPI), "-png", "-singlefile", inputPath, outputPrefix],
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
