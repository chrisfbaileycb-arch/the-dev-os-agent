import { Transform } from 'node:stream';

// Server-side token metering for the zero-config tier. The browser reports its own usage for
// BYOK runs, which is fine because a BYOK run spends the visitor's money. A free-tier run
// spends the deployment's, so its cost is measured here, on the bytes that actually crossed
// the wire, and is never taken from a client-supplied number.
//
// The transform is a pass-through: it forwards every chunk unmodified so SSE latency is
// unaffected, and only reads along the way.

/** Characters per token for the fallback estimate when a provider reports no usage block. */
const CHARS_PER_TOKEN = 4;

/**
 * Pull a usage total out of one SSE `data:` payload. Handles the OpenAI-compatible shape
 * (`usage.total_tokens`, sent by Groq and OpenRouter with stream_options.include_usage) and
 * Cohere's native `message-end` shape. Returns 0 when the line carries no usage.
 */
export function usageFrom(json) {
  const total = json?.usage?.total_tokens;
  if (Number.isFinite(total) && total >= 0) return total;
  const cohere = json?.delta?.usage?.tokens;
  if (cohere) return Math.max(0, (Number(cohere.input_tokens) || 0) + (Number(cohere.output_tokens) || 0));
  const parts = json?.usage;
  if (parts && Number.isFinite(parts.prompt_tokens) && Number.isFinite(parts.completion_tokens)) return Math.max(0, parts.prompt_tokens + parts.completion_tokens);
  return 0;
}

/** Text length of the assistant delta in one SSE payload, for the estimate path. */
export function deltaLength(json) {
  const delta = json?.choices?.[0]?.delta;
  const openai = delta?.content;
  const reasoning = typeof delta?.reasoning_content === 'string' ? delta.reasoning_content.length : 0;
  if (typeof openai === 'string' || reasoning) return (openai?.length || 0) + reasoning;
  if (typeof json?.delta?.text === 'string') return json.delta.text.length;
  const cohere = json?.delta?.message?.content?.text;
  return typeof cohere === 'string' ? cohere.length : 0;
}

/**
 * A pass-through Transform that totals the tokens a streamed completion actually used.
 *
 * `promptChars` seeds the fallback estimate so an unreported prompt is not billed at zero.
 * When the provider does report usage, that number wins outright: the estimate is only ever a
 * floor for providers that stay silent.
 */
export function createMeter({ promptChars = 0 } = {}) {
  let buffer = '';
  let reported = 0;
  let outputChars = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let splitReported = false;
  let inputReported = false;
  let outputFinal = false;

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      try {
        buffer += chunk.toString('utf8');
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          reported = Math.max(reported, usageFrom(json));
          const usage = json?.message?.usage ?? json?.usage ?? json?.delta?.usage?.tokens;
          if (usage) {
            const input = usage.prompt_tokens ?? usage.input_tokens;
            const output = usage.completion_tokens ?? usage.output_tokens;
            if (Number.isFinite(input)) { inputTokens = Math.max(inputTokens, input + (Number(usage.cache_creation_input_tokens) || 0) + (Number(usage.cache_read_input_tokens) || 0)); splitReported = true; inputReported = true; }
            if (Number.isFinite(output)) { outputTokens = Math.max(outputTokens, output); splitReported = true; outputFinal ||= json.type !== 'message_start'; }
          }
          outputChars += deltaLength(json);
        }
        // Never let a provider that emits one enormous line grow the scan buffer without bound.
        if (buffer.length > 1_000_000) buffer = buffer.slice(-4096);
      } catch { /* metering must never break the stream the visitor is reading */ }
      callback(null, chunk);
    },
  });

  /** Tokens used by this request: the provider's own number, or a floor estimated from the bytes. */
  meter.usage = () => splitReported ? { input: inputReported ? inputTokens : Math.ceil(promptChars / CHARS_PER_TOKEN), output: outputFinal ? outputTokens : Math.max(outputTokens, Math.ceil(outputChars / CHARS_PER_TOKEN)) }
    : { input: Math.ceil(promptChars / CHARS_PER_TOKEN), output: Math.max(Math.ceil(outputChars / CHARS_PER_TOKEN), reported - Math.ceil(promptChars / CHARS_PER_TOKEN)) };
  meter.total = () => splitReported ? meter.usage().input + meter.usage().output : reported || Math.ceil((promptChars + outputChars) / CHARS_PER_TOKEN);
  meter.reportedByProvider = () => reported > 0;
  return meter;
}
