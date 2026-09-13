import { S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { rasterizePdfFirstPage } from "./rasterize";
import { compose } from "./core";
import { resolvePreset } from "./presets";

const BUCKET = process.env.ASSETS_BUCKET!;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024);
const DOWNLOAD_URL_TTL_SECONDS = 15 * 60;

const s3 = new S3Client({});

interface ProcessRequestBody {
  jobId: string;
  preset?: string;
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

    const certPng = await rasterizePdfFirstPage(pdfBuffer, preset.height);
    const jpgBuffer = await compose(certPng, preset);

    await s3.send(
      new PutObjectCommand({ Bucket: BUCKET, Key: resultKey, Body: jpgBuffer, ContentType: "image/jpeg" })
    );

    const downloadUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: resultKey }), {
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    });

    return jsonResponse(200, { downloadUrl });
  } catch (err) {
    console.error("process failed", err);
    return jsonResponse(400, { error: (err as Error).message || "Failed to process certificate" });
  }
};
