export type SwipeGesture = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  width: number;
  pointerCount?: number;
  canceled?: boolean;
};

export type SwipeOutcome = 'request-delete' | 'reveal' | 'close' | 'none';

export const SWIPE_REVEAL_DISTANCE = 72;
export const SWIPE_DELETE_DISTANCE = 180;

/** Classifies a completed rightward swipe without coupling policy to React or the DOM. */
export function decideSwipeDelete({
  startX,
  startY,
  endX,
  endY,
  width,
  pointerCount = 1,
  canceled = false,
}: SwipeGesture): SwipeOutcome {
  if (canceled || pointerCount !== 1) return 'none';
  const dx = endX - startX;
  const dy = endY - startY;
  if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return 'none';
  if (dx < 0) return 'close';
  const deleteThreshold = Math.min(SWIPE_DELETE_DISTANCE, Math.max(120, width * 0.55));
  if (dx >= deleteThreshold) return 'request-delete';
  if (dx >= SWIPE_REVEAL_DISTANCE) return 'reveal';
  return 'none';
}
