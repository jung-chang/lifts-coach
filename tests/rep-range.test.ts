import { describe, expect, it } from 'vitest';
import { parseRepRange } from '../src/lib/repRange';

describe('parseRepRange', () => {
  it.each([
    ['8', [8, 8]],
    ['8–12', [8, 12]],
    ['8-12', [8, 12]],
    [' 8 - 12 ', [8, 12]],
    ['1–100', [1, 100]],
  ])('parses %s', (value, expected) => expect(parseRepRange(value)).toEqual(expected));

  it.each(['', '0', '101', '12-8', '8-', '-8', '1.5', '1–101'])('rejects %s', (value) =>
    expect(parseRepRange(value)).toBeNull(),
  );
});
