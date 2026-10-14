import { describe, expect, it } from 'vitest';
import { decideSwipeDelete } from '../src/lib/swipeDelete';

const swipe = (
  dx: number,
  dy = 0,
  extras: { width?: number; canceled?: boolean; pointerCount?: number } = {},
) =>
  decideSwipeDelete({
    startX: 0,
    startY: 0,
    endX: dx,
    endY: dy,
    width: extras.width ?? 360,
    canceled: extras.canceled,
    pointerCount: extras.pointerCount,
  });

describe('decideSwipeDelete', () => {
  it('reveals at the short-swipe threshold and requests confirmation at the full threshold', () => {
    expect(swipe(72)).toBe('reveal');
    expect(swipe(180)).toBe('request-delete');
  });
  it('uses 55 percent of narrower rows for the full gesture', () => {
    expect(swipe(176, 0, { width: 320 })).toBe('request-delete');
    expect(swipe(170, 0, { width: 320 })).toBe('reveal');
  });
  it('closes on left swipes and leaves vertical or canceled gestures alone', () => {
    expect(swipe(-80)).toBe('close');
    expect(swipe(110, 120)).toBe('none');
    expect(swipe(210, 0, { canceled: true })).toBe('none');
  });
  it('ignores gestures involving multiple pointers', () => {
    expect(swipe(220, 0, { pointerCount: 2 })).toBe('none');
  });
});
