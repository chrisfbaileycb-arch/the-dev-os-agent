// Photo attachments: resized in the browser before anything leaves the device. The full-size
// (still bounded) JPEG goes to the model as an image part; a small thumbnail is kept in the
// session so history stays light.

export interface Photo { name: string; dataUrl: string; thumb: string; width: number; height: number; }
const MAX_INPUT = 15_000_000;

async function render(bitmap: ImageBitmap, max: number, quality: number): Promise<{ url: string; width: number; height: number }> {
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale)); const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('This browser cannot process images.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  return { url: canvas.toDataURL('image/jpeg', quality), width, height };
}

export async function readPhoto(file: File, max = 1280, thumbMax = 160): Promise<Photo> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: not an image.`);
  if (file.size > MAX_INPUT) throw new Error(`${file.name}: photos must be under 15 MB.`);
  if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot attach photos.');
  const bitmap = await createImageBitmap(file);
  try {
    const full = await render(bitmap, max, 0.85); const thumb = await render(bitmap, thumbMax, 0.7);
    return { name: file.name.slice(0, 80), dataUrl: full.url, thumb: thumb.url, width: full.width, height: full.height };
  } finally { bitmap.close(); }
}
export const isImageFile = (file: File) => file.type.startsWith('image/');
/** Rough token cost of an image part for the counters; providers bill by tiles, this is a floor. */
export const photoTokens = (photo: Photo) => Math.ceil((photo.width * photo.height) / 750) + 85;
