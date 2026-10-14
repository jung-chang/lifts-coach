export function parseRepRange(value: string): [number, number] | null {
  const match = value.trim().match(/^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$/);
  if (!match) return null;
  const low = Number(match[1]);
  const high = Number(match[2] ?? match[1]);
  return low >= 1 && high <= 100 && high >= low ? [low, high] : null;
}
