/**
 * friendlyError.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Maps a failed AgentRun's raw `output_url` (often a JSON-encoded exception,
 * e.g. "All local models failed (qwen3:14b, gemma2:9b, ...). Last error:
 * HTTPConnectionPool...") to a plain-language summary — useful in logs, not
 * something to show an end user. Falls back to a generic message rather than
 * ever displaying raw provider/model internals or stack-trace-shaped text.
 */
export function friendlyErrorMessage(outputUrl: string | null): string {
  let raw = '';
  try {
    raw = outputUrl ? (JSON.parse(outputUrl).error ?? '') : '';
  } catch {
    raw = outputUrl ?? '';
  }
  const lower = raw.toLowerCase();
  if (lower.includes('rate limit') || lower.includes('429')) {
    return 'AI provider rate limit reached — please retry in a few minutes.';
  }
  if (lower.includes('all local models failed') || lower.includes('connection refused') || lower.includes('httpconnectionpool')) {
    return 'AI provider temporarily unavailable — please retry.';
  }
  if (lower.includes('validation error') || lower.includes('json')) {
    return 'Generated content did not pass quality checks — please retry.';
  }
  if (lower.includes('empty') && (lower.includes('artifact') || lower.includes('plan') || lower.includes('context'))) {
    return 'Not enough context to generate this step — check prior artifacts and retry.';
  }
  return 'This step failed unexpectedly — please retry.';
}
