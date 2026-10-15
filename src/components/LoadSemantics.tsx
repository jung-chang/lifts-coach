import type { LoadMode, Unit } from '../../shared/types';

export function loadModeLabel(mode: LoadMode): string {
  switch (mode) {
    case 'per-dumbbell':
      return 'Each dumbbell';
    case 'assistance':
      return 'Assistance';
    case 'bodyweight':
      return 'Added load';
    case 'external':
      return 'Total load';
  }
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

export function formatLoadValue(mode: LoadMode, value: number, unit: Unit): string {
  if (mode === 'bodyweight' && value === 0) return 'Bodyweight';
  const amount = `${displayNumber(value)} ${unit}`;
  switch (mode) {
    case 'per-dumbbell':
      return `${amount} each`;
    case 'assistance':
      return `${amount} assistance`;
    case 'bodyweight':
      return `+${amount}`;
    case 'external':
      return `${amount} total`;
  }
}

type LoadSemanticsProps = { mode: LoadMode; value: number; unit: Unit };

/** Displays a load with its mode-specific meaning and a concise mode label. */
export function LoadSemantics({ mode, value, unit }: LoadSemanticsProps) {
  return (
    <span className="load-semantics">
      <span>{formatLoadValue(mode, value, unit)}</span>
      <span className="muted small">{loadModeLabel(mode)}</span>
    </span>
  );
}
