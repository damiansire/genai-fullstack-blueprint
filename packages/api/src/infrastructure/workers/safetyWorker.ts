import { isMainThread, parentPort } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';

/**
 * Safety classification worker (off the main thread).
 *
 * WHY A WORKER, NOT A REAL SLM (decision, documented):
 *   A genuine small language model (e.g. Phi-3.5 / Llama-Guard) for prompt-injection
 *   and DLP classification is the right long-term answer, but bundling a multi-GB
 *   model + an ONNX/llama.cpp runtime into this scaffold is disproportionate — it
 *   would dwarf the rest of the project and contradict "built-in over dependencies".
 *   We do NOT ship a fake model pretending to be an SLM.
 *
 *   What we DO ship is the correct *architecture* for one: the (still heuristic,
 *   but materially stronger than a 5-keyword substring) classifier runs in a Worker
 *   Thread via the existing WorkerPool, so a large/adversarial payload can never
 *   block the Event Loop. The `classify()` boundary below is exactly the shape an
 *   SLM call would take — swap the heuristic body for `await slm.score(text)` and
 *   the middleware, pool wiring, and tests do not change.
 *
 * INPUT  message: { id, text: string }
 * OUTPUT message: { id, success, result: SafetyVerdict }
 */

export interface SafetyVerdict {
  /** True when the content should be blocked. */
  flagged: boolean;
  /** 0..1 risk score (an SLM would produce a calibrated probability here). */
  score: number;
  /** Which category tripped, for logging/observability. */
  category: 'none' | 'prompt_injection' | 'toxicity' | 'dlp';
  /** Human-readable reason (mirrors the eval/assert convention). */
  reason: string;
  /** Wall time spent classifying, for latency tracking. */
  elapsedMs: number;
}

// Stronger-than-substring heuristics. Still not an SLM, but covers common
// injection phrasings, simple obfuscation, and a few DLP signals. This is the
// part a real model would replace.
const INJECTION_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules)/i, weight: 0.9 },
  { re: /disregard\s+(the\s+)?(system|previous)\s+(prompt|instructions?)/i, weight: 0.9 },
  { re: /(reveal|show|print|repeat)\s+(your|the)\s+(system\s+prompt|instructions|rules)/i, weight: 0.85 },
  { re: /\b(you\s+are\s+now|act\s+as|pretend\s+to\s+be)\b.*\b(dan|developer\s+mode|jailbreak)\b/i, weight: 0.85 },
  { re: /\bbypass\b.*\b(filter|safety|guard|restriction)/i, weight: 0.8 },
  { re: /\b(jailbreak|prompt\s*injection)\b/i, weight: 0.75 },
];

const TOXICITY_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /\b(kill|harm|attack)\s+(yourself|people|them)\b/i, weight: 0.8 },
];

// DLP: credentials / secrets leaving the perimeter inside the prompt.
const DLP_PATTERNS: Array<{ re: RegExp; weight: number }> = [
  { re: /\b(sk-[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16})\b/, weight: 0.95 }, // OpenAI/AWS-style keys
  { re: /-----BEGIN\s+(RSA\s+|EC\s+)?PRIVATE\s+KEY-----/, weight: 0.95 },
];

/**
 * Decode common trivial obfuscations so substrings don't slip through.
 * Strips zero-width chars and collapses whitespace. Case is preserved here so
 * case-sensitive DLP signals (sk-…, AKIA…, PEM markers) still match; the
 * injection/toxicity patterns are already case-insensitive via the `i` flag.
 */
function normalize(text: string): string {
  // Quita caracteres de ancho cero (ZWSP/ZWNJ/ZWJ) y el BOM, escapados
  // explícitamente para no dejar whitespace irregular literal en el fuente.
  let t = text.replace(/[\u200B-\u200D\uFEFF]/g, '');
  t = t.replace(/\s+/g, ' ');
  return t;
}

/**
 * Classify a text payload. This is the SLM-ready boundary: today it's weighted
 * heuristics; tomorrow it can `await slm.score(text)` with no caller changes.
 */
export function classify(rawText: string): SafetyVerdict {
  const start = performance.now();
  const text = normalize(rawText);

  let best = { score: 0, category: 'none' as SafetyVerdict['category'], reason: 'no safety signal' };

  const scan = (patterns: typeof INJECTION_PATTERNS, category: SafetyVerdict['category']) => {
    for (const { re, weight } of patterns) {
      if (re.test(text) && weight > best.score) {
        best = { score: weight, category, reason: `matched ${category} pattern: ${re.source.slice(0, 48)}` };
      }
    }
  };

  scan(INJECTION_PATTERNS, 'prompt_injection');
  scan(TOXICITY_PATTERNS, 'toxicity');
  scan(DLP_PATTERNS, 'dlp');

  const elapsedMs = Math.round((performance.now() - start) * 100) / 100;
  // Threshold tuned for the heuristics; an SLM would expose its own calibrated cutoff.
  const flagged = best.score >= 0.7;

  return { flagged, score: best.score, category: best.category, reason: best.reason, elapsedMs };
}

/**
 * Narrow guard for the inbound worker message. The worker boundary is exactly
 * the kind of external input that must be validated at runtime rather than
 * cast: a malformed `{ id, text }` produced by a bug elsewhere would otherwise
 * propagate as a silently-wrong classification.
 */
interface SafetyRequest {
  id: number;
  text: string;
}
function isSafetyRequest(value: unknown): value is SafetyRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['id'] === 'number' &&
    typeof (value as Record<string, unknown>)['text'] === 'string'
  );
}

if (!isMainThread && parentPort) {
  parentPort.on('message', (message: unknown) => {
    if (!isSafetyRequest(message)) {
      const id =
        typeof (message as Record<string, unknown> | null)?.['id'] === 'number'
          ? (message as { id: number }).id
          : -1;
      parentPort!.postMessage({
        id,
        success: false,
        error: 'Malformed safety worker message: expected { id: number, text: string }',
      });
      return;
    }
    const { id, text } = message;
    try {
      const result = classify(text);
      parentPort!.postMessage({ id, success: true, result });
    } catch (error) {
      parentPort!.postMessage({
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
