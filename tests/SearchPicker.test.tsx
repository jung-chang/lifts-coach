// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SearchPicker } from '../src/components/SearchPicker';
import { TimezonePicker } from '../src/components/TimezonePicker';

afterEach(cleanup);

it('searches the complete library by multiple metadata terms and commits only the selected result', () => {
  const onChange = vi.fn();
  const options = Array.from({ length: 80 }, (_, i) => ({
    value: `exercise-${i}`,
    label: `Exercise ${i}`,
    description: i === 79 ? 'Épaules · Dumbbells' : 'Back · Cable',
  }));
  render(
    <SearchPicker
      label="Choose exercise"
      value="exercise-0"
      options={options}
      onChange={onChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose exercise' }));
  const search = screen.getByRole('searchbox', { name: 'Search choose exercise' });
  fireEvent.change(search, { target: { value: 'epaules dumbbells' } });
  expect(screen.queryByRole('button', { name: /Exercise 0 Back/ })).toBeNull();
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Exercise 79 Épaules · Dumbbells' }));
  expect(onChange).toHaveBeenCalledWith('exercise-79');
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('searches timezones using city names with spaces and keeps the current value until selection', () => {
  const onChange = vi.fn();
  render(<TimezonePicker value="UTC" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Training timezone' }));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search timezones' }), {
    target: { value: 'new york' },
  });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /America \/ New York/ }));
  expect(onChange).toHaveBeenCalledWith('America/New_York');
});

it('recovers from no matches and resets the query on reopening', () => {
  render(
    <SearchPicker
      label="Choose exercise"
      value="one"
      options={[{ value: 'one', label: 'Row' }]}
      onChange={vi.fn()}
      emptyMessage="No exercise matches."
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose exercise' }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'none' } });
  expect(screen.getByText('No exercise matches.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('button', { name: 'Row' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'row' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Choose exercise' }));
  expect(screen.getByRole('searchbox')).toHaveProperty('value', '');
});
