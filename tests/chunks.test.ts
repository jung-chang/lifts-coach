import { describe, expect, it } from 'vitest';
import { splitState } from '../worker/chunks';
describe('D1 state chunking', () => {
  it('keeps rows below the D1 string limit and round-trips boundary Unicode', () => {
    const value = 'a'.repeat(249_999) + '🏋️' + 'é'.repeat(1_100_000);
    const chunks = splitState(value);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.join('')).toBe(value);
    expect(chunks.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 1_000_000)).toBe(
      true,
    );
    expect(
      chunks.map((chunk) => new TextDecoder().decode(new TextEncoder().encode(chunk))).join(''),
    ).toBe(value);
  });
  it('keeps a maximum-size ASCII document within the D1 query budget', () => {
    const chunks = splitState('x'.repeat(20_000_000));
    expect(chunks).toHaveLength(20);
  });
});
