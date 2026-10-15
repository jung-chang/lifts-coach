// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formatLoadValue, LoadSemantics, loadModeLabel } from '../src/components/LoadSemantics';

afterEach(cleanup);

describe('load semantics', () => {
  it('formats loads with the correct mode meaning', () => {
    expect(formatLoadValue('per-dumbbell', 12.5, 'lb')).toBe('12.5 lb each');
    expect(formatLoadValue('assistance', 30, 'kg')).toBe('30 kg assistance');
    expect(formatLoadValue('external', 45, 'lb')).toBe('45 lb total');
    expect(formatLoadValue('bodyweight', 0, 'lb')).toBe('Bodyweight');
    expect(formatLoadValue('bodyweight', 5, 'lb')).toBe('+5 lb');
  });

  it('uses concise mode labels in the reusable display', () => {
    expect(loadModeLabel('per-dumbbell')).toBe('Each dumbbell');
    expect(loadModeLabel('assistance')).toBe('Assistance');
    expect(loadModeLabel('external')).toBe('Total load');
    expect(loadModeLabel('bodyweight')).toBe('Added load');

    render(<LoadSemantics mode="per-dumbbell" value={20} unit="lb" />);
    expect(screen.getByText('20 lb each')).toBeTruthy();
    expect(screen.getByText('Each dumbbell')).toBeTruthy();
  });
});
