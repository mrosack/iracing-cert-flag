import { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { randomUUID } from "node:crypto";

const BUCKET = process.env.ASSETS_BUCKET!;
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 8 * 1024 * 1024);
const UPLOAD_URL_TTL_SECONDS = 60;

const s3 = new S3Client({});

interface PresignRequestBody {
  fileSizeBytes?: number;
}

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: { body?: string }) => {
  let request: PresignRequestBody;
  try {
    request = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const fileSizeBytes = request.fileSizeBytes;
  if (typeof fileSizeBytes !== "number" || fileSizeBytes <= 0) {
    return jsonResponse(400, { error: "Missing or invalid fileSizeBytes" });
  }
  if (fileSizeBytes > MAX_UPLOAD_BYTES) {
    return jsonResponse(400, { error: `File exceeds the ${MAX_UPLOAD_BYTES} byte limit` });
  }

  const jobId = randomUUID();
  const key = `uploads/${jobId}/input.pdf`;

  const presignedPost = await createPresignedPost(s3, {
    Bucket: BUCKET,
    Key: key,
    Conditions: [
      ["content-length-range", 1, MAX_UPLOAD_BYTES],
      ["eq", "$Content-Type", "application/pdf"],
    ],
    Fields: { "Content-Type": "application/pdf" },
    Expires: UPLOAD_URL_TTL_SECONDS,
  });

  return jsonResponse(200, {
    jobId,
    uploadUrl: presignedPost.url,
    uploadFields: presignedPost.fields,
  });
};
