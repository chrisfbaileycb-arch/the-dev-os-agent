// Attachments for the composer. Text files become run context; photos are resized in the
// browser before anything leaves the device and are sent as image parts to a vision model.

export interface TextAttachment { name: string; content: string; }
export interface PhotoAttachment { name: string; dataUrl: string; thumb: string; width: number; height: number; }

const isImage = (file: File) => file.type.startsWith("image/");

async function readText(file: File): Promise<TextAttachment> {
  if (!/\.(txt|md|csv|json|html)$/i.test(file.name) || file.size > 200_000) throw new Error(`${file.name}: attach text, Markdown, CSV, JSON, or HTML files under 200 KB.`);
  return { name: file.name.slice(0, 80), content: (await file.text()).slice(0, 60_000) };
}

async function render(bitmap: ImageBitmap, max: number, quality: number): Promise<{ url: string; width: number; height: number }> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process images.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { url: canvas.toDataURL("image/jpeg", quality), width, height };
}

async function readPhoto(file: File): Promise<PhotoAttachment> {
  if (!isImage(file)) throw new Error(`${file.name}: not an image.`);
  if (file.size > 15_000_000) throw new Error(`${file.name}: photos must be under 15 MB.`);
  if (typeof createImageBitmap !== "function") throw new Error("This browser cannot attach photos.");
  const bitmap = await createImageBitmap(file);
  try {
    const full = await render(bitmap, 1280, 0.85);
    const thumb = await render(bitmap, 160, 0.7);
    return { name: file.name.slice(0, 80), dataUrl: full.url, thumb: thumb.url, width: full.width, height: full.height };
  } finally { bitmap.close(); }
}

export const attachments = { isImage, readText, readPhoto };
