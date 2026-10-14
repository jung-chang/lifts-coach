import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { decideSwipeDelete, SWIPE_REVEAL_DISTANCE } from '../lib/swipeDelete';

type Props = {
  id: string;
  label: string;
  children: ReactNode;
  onRequestDelete: () => void;
};

const ignoredTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(
    target.closest(
      'button,a,input,textarea,select,summary,details,[contenteditable="true"],[data-no-swipe]',
    ),
  );

export default function SwipeToDeleteRow({ id, label, children, onRequestDelete }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [offset, setOffset] = useState(0);
  const gesture = useRef<{
    pointerId: number;
    x: number;
    y: number;
    width: number;
    horizontal: boolean;
  } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (active && active.pointerId !== event.pointerId) {
      gesture.current = null;
      setRevealed(false);
      setOffset(0);
      return;
    }
    if (!event.isPrimary || event.button !== 0 || ignoredTarget(event.target)) return;
    if (active) return;
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      width: event.currentTarget.clientWidth,
      horizontal: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    if (!active.horizontal) {
      if (Math.abs(dy) > Math.abs(dx) || Math.abs(dx) < 8) return;
      active.horizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    const maxOffset = Math.min(320, Math.max(180, active.width * 0.8));
    setOffset(Math.max(-SWIPE_REVEAL_DISTANCE, Math.min(maxOffset, dx)));
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>, canceled: boolean) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (!active.horizontal) return;
    const outcome = decideSwipeDelete({
      startX: active.x,
      startY: active.y,
      endX: event.clientX,
      endY: event.clientY,
      width: active.width,
      canceled,
    });
    if (outcome === 'request-delete') {
      setRevealed(false);
      setOffset(0);
      onRequestDelete();
    } else if (outcome === 'reveal') {
      setRevealed(true);
      setOffset(SWIPE_REVEAL_DISTANCE);
    } else {
      setRevealed(false);
      setOffset(0);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && ignoredTarget(event.target)) return;
    if (event.key === 'Escape' && revealed) {
      event.preventDefault();
      setRevealed(false);
      setOffset(0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setRevealed(true);
      setOffset(SWIPE_REVEAL_DISTANCE);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      setRevealed(false);
      setOffset(0);
      onRequestDelete();
    }
  };

  return (
    <div className="swipe-delete-row" data-prescription-id={id}>
      <div className="swipe-delete-action" aria-hidden={!revealed}>
        <button
          type="button"
          tabIndex={revealed ? 0 : -1}
          aria-label={`Delete ${label}`}
          onClick={onRequestDelete}
        >
          <Trash2 size={18} /> <span>Delete</span>
        </button>
      </div>
      <div
        className="swipe-delete-foreground"
        style={{
          transform: `translateX(${offset}px)`,
          transition: gesture.current?.horizontal ? 'none' : undefined,
          touchAction: 'pan-y',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => finish(event, false)}
        onPointerCancel={(event) => finish(event, true)}
        onLostPointerCapture={(event) => finish(event, true)}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="group"
        aria-label={`${label}, swipe right to reveal remove`}
      >
        {children}
      </div>
    </div>
  );
}
