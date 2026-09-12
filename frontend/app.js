const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const form = document.getElementById("flag-form");
const fileInput = document.getElementById("pdf-input");
const presetInput = document.getElementById("preset-input");
const generateBtn = document.getElementById("generate-btn");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const previewImg = document.getElementById("preview");
const downloadLink = document.getElementById("download-link");

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function validateFile(file) {
  if (!file) return "Choose a PDF file first.";
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    return "That doesn't look like a PDF file.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `File is too large (max ${(MAX_UPLOAD_BYTES / 1024 / 1024).toFixed(0)}MB).`;
  }
  return null;
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  const error = validateFile(file);
  generateBtn.disabled = Boolean(error);
  setStatus(error ?? "");
});

async function postJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request to ${path} failed (${res.status})`);
  }
  return data;
}

async function uploadToS3(uploadUrl, uploadFields, file) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(uploadFields)) {
    formData.append(key, value);
  }
  formData.append("file", file);

  const res = await fetch(uploadUrl, { method: "POST", body: formData });
  if (!res.ok) {
    throw new Error("Upload to storage failed. Please try again.");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = fileInput.files[0];
  const error = validateFile(file);
  if (error) {
    setStatus(error, true);
    return;
  }

  generateBtn.disabled = true;
  resultEl.hidden = true;

  try {
    setStatus("Requesting upload slot...");
    const { jobId, uploadUrl, uploadFields } = await postJson("/api/presign", { fileSizeBytes: file.size });

    setStatus("Uploading certificate...");
    await uploadToS3(uploadUrl, uploadFields, file);

    setStatus("Rendering your flag (this can take a few seconds)...");
    const { downloadUrl } = await postJson("/api/process", { jobId, preset: presetInput.value });

    previewImg.src = downloadUrl;
    downloadLink.href = downloadUrl;
    resultEl.hidden = false;
    setStatus("Done!");
  } catch (err) {
    setStatus(err.message || "Something went wrong.", true);
  } finally {
    generateBtn.disabled = false;
  }
});
