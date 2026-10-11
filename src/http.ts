/** Bound response bytes and lifetime, including reading the body. */
export async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Response exceeded size limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
export async function mapLimit<T, R>(values: T[], limit: number, fn: (value: T, i: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(values.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (cursor < values.length) { const i = cursor++; results[i] = await fn(values[i], i); }
  }));
  return results;
}
export function canonicalArticleUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) u.searchParams.delete(key);
    }
    u.searchParams.sort();
    return u.toString();
  } catch { return null; }
}
