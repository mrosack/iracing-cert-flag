import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { rasterizePdfFirstPage } from "./rasterize";
import { compose, getCertPixelSize } from "./core";
import { flattenNearWhiteRadialShadings } from "./flattenShadings";
import { resolvePreset } from "./presets";

const BUCKET = process.env.ASSETS_BUCKET!;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024);
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

const s3 = new S3Client({});

interface ProcessRequestBody {
  jobId: string;
  preset?: string;
  filename?: string;
}

function deriveDownloadFilename(sourceName: string | undefined): string {
  const base = (sourceName ?? "").replace(/\.pdf$/i, "").trim();
  const sanitized = base.replace(/["\r\n\\]/g, "").slice(0, 200);
  return `${sanitized || "iracing-flag"}.jpg`;
}

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: { body?: string }) => {
  let request: ProcessRequestBody;
  try {
    request = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  if (!request.jobId || typeof request.jobId !== "string") {
    return jsonResponse(400, { error: "Missing jobId" });
  }

  let preset;
  try {
    preset = resolvePreset(request.preset);
  } catch (err) {
    return jsonResponse(400, { error: (err as Error).message });
  }

  const uploadKey = `uploads/${request.jobId}/input.pdf`;
  const resultKey = `results/${request.jobId}/output.jpg`;

  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: uploadKey })).catch(() => null);
    if (!head) {
      return jsonResponse(400, { error: "Upload not found or expired. Please upload the file again." });
    }
    if ((head.ContentLength ?? 0) > MAX_UPLOAD_BYTES) {
      return jsonResponse(400, { error: "Uploaded file is too large" });
    }

    const getResult = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: uploadKey }));
    const pdfBuffer = Buffer.from(await getResult.Body!.transformToByteArray());

    const flattenedPdf = await flattenNearWhiteRadialShadings(pdfBuffer);
    const certPng = await rasterizePdfFirstPage(flattenedPdf, getCertPixelSize(preset).height);
    const jpgBuffer = await compose(certPng, preset);

    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: resultKey, Body: jpgBuffer, ContentType: "image/jpeg" })
    );

    // Two presigned URLs to the same object: previewUrl renders inline for the <img> preview,
    // downloadUrl carries Content-Disposition: attachment so clicking it actually saves the
    // file instead of opening it in the browser tab. The `download` attribute on an <a> tag
    // only works for same-origin URLs, and this presigned URL points at S3 directly (a
    // different origin from the CloudFront site), so it's ignored without this.
    const previewUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: resultKey }), {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });
    const downloadFilename = deriveDownloadFilename(request.filename);
    const downloadUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: resultKey,
        ResponseContentDisposition: `attachment; filename="${downloadFilename}"`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS }
    );

    return jsonResponse(200, { previewUrl, downloadUrl });
  } catch (err) {
    console.error("process failed", err);
    return jsonResponse(400, { error: (err as Error).message || "Failed to process certificate" });
  }
};
