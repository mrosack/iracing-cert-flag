import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFObject, PDFRef } from "pdf-lib";

// Only flatten shadings whose every color component is at least this bright. Certificate
// templates draw a soft near-white radial highlight behind the title, defined as a gradient
// from white (1,1,1) to a barely-different gray (~0.90) - a span of only ~25 of the 256
// available 8-bit levels, stretched across hundreds of pixels. No rasterizer can render that
// smoothly: the 8-bit quantization steps land far enough apart to read as concentric rings at
// full flag size. Flattening it to a solid color removes the artifact at the source, and
// because the whole span is near-white to begin with, the visual difference is negligible.
// The threshold keeps this away from saturated gradients (e.g. the red/blue corner banners),
// which are real design elements and don't band.
const NEAR_WHITE_THRESHOLD = 0.85;

// Shading functions can nest (a type 3 "stitching" function wraps type 2 sub-functions).
// Bounds the walk in case a malformed file contains a reference cycle.
const MAX_FUNCTION_DEPTH = 8;

function collectExponentialFunctions(
  obj: PDFObject | undefined,
  doc: PDFDocument,
  acc: PDFDict[],
  depth = 0
): void {
  if (!obj || depth > MAX_FUNCTION_DEPTH) return;
  const resolved = obj instanceof PDFRef ? doc.context.lookup(obj) : obj;

  if (resolved instanceof PDFArray) {
    for (let i = 0; i < resolved.size(); i++) {
      collectExponentialFunctions(resolved.get(i), doc, acc, depth + 1);
    }
    return;
  }
  if (!(resolved instanceof PDFDict)) return;

  const functionType = resolved.get(PDFName.of("FunctionType"));
  if (!(functionType instanceof PDFNumber)) return;

  if (functionType.asNumber() === 2) {
    acc.push(resolved);
  } else if (functionType.asNumber() === 3) {
    collectExponentialFunctions(resolved.get(PDFName.of("Functions")), doc, acc, depth + 1);
  }
  // Type 0 (sampled) and type 4 (PostScript calculator) functions carry their colors as
  // stream data rather than as C0/C1 pairs, so they're left alone.
}

function readColor(fn: PDFDict, key: string): number[] | null {
  const arr = fn.get(PDFName.of(key));
  if (!(arr instanceof PDFArray)) return null;
  const out: number[] = [];
  for (let i = 0; i < arr.size(); i++) {
    const n = arr.get(i);
    if (!(n instanceof PDFNumber)) return null;
    out.push(n.asNumber());
  }
  return out.length ? out : null;
}

function writeColor(fn: PDFDict, key: string, color: number[]): void {
  const arr = fn.get(PDFName.of(key));
  if (!(arr instanceof PDFArray) || arr.size() !== color.length) return;
  color.forEach((v, i) => arr.set(i, PDFNumber.of(v)));
}

/**
 * Rewrites near-white radial shadings in a PDF into solid fills, returning the modified
 * bytes. Radial (ShadingType 3) only - linear shadings are left untouched.
 *
 * Never throws: uploads are arbitrary user-supplied PDFs, and rendering the original
 * unmodified is always preferable to failing the request, so any parse or write error
 * falls back to the input buffer.
 */
export async function flattenNearWhiteRadialShadings(pdfBuffer: Buffer): Promise<Buffer> {
  try {
    const doc = await PDFDocument.load(pdfBuffer);
    let flattened = 0;

    for (const [, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;

      const shadingType = obj.get(PDFName.of("ShadingType"));
      if (!(shadingType instanceof PDFNumber) || shadingType.asNumber() !== 3) continue;

      const functions: PDFDict[] = [];
      collectExponentialFunctions(obj.get(PDFName.of("Function")), doc, functions);
      if (!functions.length) continue;

      const colors: number[][] = [];
      for (const fn of functions) {
        const c0 = readColor(fn, "C0");
        const c1 = readColor(fn, "C1");
        if (!c0 || !c1 || c0.length !== c1.length) {
          colors.length = 0;
          break;
        }
        colors.push(c0, c1);
      }
      if (!colors.length) continue;
      if (!colors.every((c) => c.every((v) => v >= NEAR_WHITE_THRESHOLD))) continue;

      // Collapse to the lightest stop so the gradient resolves toward the page's white
      // background rather than darkening the area it used to cover.
      const lightest = colors.reduce((a, b) =>
        b.reduce((s, v) => s + v, 0) / b.length > a.reduce((s, v) => s + v, 0) / a.length ? b : a
      );
      for (const fn of functions) {
        writeColor(fn, "C0", lightest);
        writeColor(fn, "C1", lightest);
      }
      flattened++;
    }

    if (!flattened) return pdfBuffer;
    return Buffer.from(await doc.save());
  } catch {
    return pdfBuffer;
  }
}
