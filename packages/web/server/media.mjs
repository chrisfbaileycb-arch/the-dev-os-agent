import { HttpError } from './proxy.mjs';
import { checkOrigin } from './state.mjs';
import { resolveWorkspace } from './workspace.mjs';

export const IMAGE_MODELS = new Set(['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image']);
const MIME_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const MAX_RESPONSE = 32_000_000;
const cleanText = (value, max, label, required = true) => {
  if (typeof value !== 'string' || (required && !value.trim()) || value.length > max) throw new HttpError(400, `${label} must be ${required ? 'nonempty ' : ''}text of at most ${max} characters.`);
  return value.trim();
};
export function mediaRequest(body) {
  const args = body?.args;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new HttpError(400, 'Media arguments must be an object.');
  const key = cleanText(body.key, 4096, 'Your media API key');
  if (key.length < 8 || /[\r\n]/.test(key)) throw new HttpError(400, 'Invalid media API key.');
  if (!/^[0-9a-f-]{36}$/i.test(body.callId ?? '')) throw new HttpError(400, 'A unique execution call ID is required.');
  if (body.provider === 'nano-banana' && body.tool === 'nano_banana_generate_image') {
    if (!IMAGE_MODELS.has(body.model)) throw new HttpError(400, 'Choose a supported image-generation model.');
    return { url: 'https://generativelanguage.googleapis.com/v1beta/interactions', method: 'POST', headers: { 'x-goog-api-key': key }, body: { model: body.model, input: [{ type: 'text', text: cleanText(args.prompt, 16_000, 'Image prompt') }], store: false }, provider: body.provider };
  }
  if (body.provider === 'heygen' && body.tool === 'heygen_video_status') {
    const id = cleanText(args.video_id, 160, 'Video ID');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new HttpError(400, 'Invalid video ID.');
    return { url: `https://api.heygen.com/v3/videos/${id}`, method: 'GET', headers: { 'x-api-key': key }, provider: body.provider };
  }
  if (body.provider === 'heygen' && body.tool === 'heygen_generate_video') {
    const aspect = args.aspect_ratio ?? '16:9';
    if (!['16:9', '9:16', '1:1'].includes(aspect)) throw new HttpError(400, 'Choose 16:9, 9:16, or 1:1.');
    return { url: 'https://api.heygen.com/v3/videos', method: 'POST', headers: { 'x-api-key': key, 'Idempotency-Key': body.callId }, body: { type: 'avatar', avatar_id: cleanText(args.avatar_id || body.avatarId, 160, 'Avatar ID'), voice_id: cleanText(args.voice_id || body.voiceId, 160, 'Voice ID'), script: cleanText(args.script, 16_000, 'Video script'), aspect_ratio: aspect, output_format: 'mp4', ...(args.title ? { title: cleanText(args.title, 200, 'Video title') } : {}) }, provider: body.provider };
  }
  throw new HttpError(400, 'Unknown optional media tool.');
}
export function mediaResult(provider, payload, callId) {
  if (provider === 'heygen') {
    if (!payload?.data || typeof payload.data !== 'object') throw new HttpError(502, 'HeyGen returned no video manifest.');
    const data = payload.data;
    const id = data.video_id || data.id;
    if (typeof id !== 'string') throw new HttpError(502, 'HeyGen returned no video ID.');
    if (data.status === 'failed') throw new HttpError(502, `HeyGen video failed: ${String(data.failure_message || data.failure_code || 'unknown error')}`);
    const manifest = { provider: 'heygen', videoId: id, status: data.status, ...(typeof data.video_url === 'string' ? { videoUrl: data.video_url } : {}), ...(typeof data.video_page_url === 'string' ? { pageUrl: data.video_page_url } : {}), ...(typeof data.duration === 'number' ? { durationSeconds: data.duration } : {}), ...(typeof data.title === 'string' ? { title: data.title } : {}), retrievedAt: new Date().toISOString() };
    const output = JSON.stringify(manifest, null, 2);
    return { output, summary: `HeyGen video ${id}: ${data.status || 'submitted'}`, artifacts: [{ path: `media/heygen-${callId}.json`, mimeType: 'application/json', encoding: 'utf8', content: output, source: 'HeyGen video manifest' }] };
  }
  const content = (Array.isArray(payload?.steps) ? payload.steps : []).filter(step => step?.type === 'model_output').flatMap(step => Array.isArray(step.content) ? step.content : []);
  const artifacts = []; const text = [];
  for (const part of content) {
    if (part.type === 'text' && typeof part.text === 'string') text.push(part.text);
    if (part.type === 'image') {
      const mime = part.mime_type;
      if (!Object.hasOwn(MIME_EXT, mime) || typeof part.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(part.data) || part.data.length % 4 !== 0) throw new HttpError(502, 'Image provider returned an unsupported or invalid image.');
      artifacts.push({ path: `media/nano-banana-${callId}-${artifacts.length + 1}.${MIME_EXT[mime]}`, mimeType: mime, encoding: 'base64', content: part.data, source: 'Nano Banana generated image' });
    }
  }
  if (!artifacts.length) throw new HttpError(502, text.join('\n') || 'The image provider returned no image. Check model access and prompt restrictions.');
  return { output: `${text.join('\n')}\nGenerated artifacts:\n${artifacts.map(a => a.path).join('\n')}`.trim(), summary: `${artifacts.length} image${artifacts.length === 1 ? '' : 's'} generated`, artifacts };
}
async function boundedJson(response) {
  if (!response.body) throw new HttpError(502, 'Media provider returned an empty response.');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > MAX_RESPONSE) { await reader.cancel(); throw new HttpError(413, 'Media response exceeds 32 MB. Nothing was shortened.'); } chunks.push(Buffer.from(value)); }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(502, 'Media provider returned invalid JSON.'); }
}
export function createMedia({ env = process.env, fetchImpl = fetch } = {}) {
  const windows = new Map();
  return async (req, res) => {
    if (new URL(req.url, 'http://media').pathname !== '/api/media/call') return false;
    const json = (status, value) => { if (res.destroyed) return; res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    let key = '';
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env); const workspace = resolveWorkspace(req, env);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 100_000) throw new HttpError(413, 'Media input exceeds 100 KB.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new HttpError(400, 'Invalid JSON.'); }
      key = typeof body.key === 'string' ? body.key : '';
      const request = mediaRequest(body);
      const statusOnly = body.tool === 'heygen_video_status';
      const bucket = `${req.socket.remoteAddress}|${workspace}|${statusOnly ? 'status' : 'generate'}`; const now = Date.now();
      for (const [id, value] of windows) if (now - value.start >= 3_600_000) windows.delete(id);
      const entry = windows.get(bucket) ?? { start: now, count: 0 }; windows.set(bucket, entry); entry.count++;
      if (entry.count > (statusOnly ? 120 : 12)) throw new HttpError(429, 'Optional media request limit reached. Try again later.');
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 165_000);
      const abort = () => { if (!res.writableEnded) controller.abort(); }; res.once('close', abort);
      try {
        const response = await fetchImpl(request.url, { method: request.method, headers: { ...request.headers, Accept: 'application/json', ...(request.body ? { 'Content-Type': 'application/json' } : {}) }, body: request.body ? JSON.stringify(request.body) : undefined, redirect: 'error', signal: controller.signal });
        const payload = await boundedJson(response);
        if (!response.ok) throw new HttpError(response.status === 429 ? 429 : response.status === 401 || response.status === 403 ? 401 : 502, `Media provider answered HTTP ${response.status}: ${typeof payload?.error?.message === 'string' ? payload.error.message : 'Check your own provider key, permissions, and quota.'}`);
        const result = mediaResult(request.provider, payload, body.callId);
        // Only structured media results leave this endpoint. Credentials never enter storage or logs.
        const clean = JSON.parse(JSON.stringify(result).split(key).join('[REDACTED]'));
        json(200, clean);
      } finally { clearTimeout(timer); res.off('close', abort); }
    } catch (error) {
      const message = error instanceof HttpError ? error.message : 'Media request failed or timed out. No automatic generation retry was attempted.';
      json(error instanceof HttpError ? error.status : 502, { error: { message: key ? message.split(key).join('[REDACTED]') : message } });
    }
    return true;
  };
}
