// One UTF-8 MB per row, below D1's 2 MB limit. At the API's 20 MB document
// limit this also stays below the free tier's queries-per-invocation limit.
export function splitState(text: string): string[] {
  const bytes = new TextEncoder().encode(text);
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  for (let start = 0; start < bytes.length; ) {
    let end = Math.min(start + 1_000_000, bytes.length);
    // The first byte of the next chunk must start a code point.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
  return chunks;
}
