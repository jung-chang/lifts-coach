import { useId, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Calendar } from './ui/Calendar';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';

const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const dateValue = (value: string) => (value ? new Date(`${value}T12:00:00`) : undefined);
const label = (value: string) =>
  dateValue(value)?.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from, to });
  const [month, setMonth] = useState(dateValue(from) ?? dateValue(to) ?? new Date());
  const invalid = Boolean(draft.from && draft.to && draft.from > draft.to);
  const summary =
    from && to
      ? `${label(from)} – ${label(to)}`
      : from
        ? `From ${label(from)}`
        : to
          ? `Through ${label(to)}`
          : 'All dates';
  return (
    <div className="history-date-filters">
      <Button
        className="date-range-trigger"
        aria-label={`Date range: ${summary}`}
        aria-haspopup="dialog"
        onClick={() => {
          setDraft({ from, to });
          setMonth(dateValue(from) ?? dateValue(to) ?? new Date());
          setOpen(true);
        }}
      >
        <CalendarDays size={18} aria-hidden="true" />
        <span>{summary}</span>
      </Button>
      {(from || to) && (
        <Button variant="ghost" onClick={() => onChange('', '')}>
          Clear dates
        </Button>
      )}
      <Sheet open={open} onOpenChange={setOpen} title="Date range">
        <div className="date-range-editor">
          <div className="date-range-fields">
            {(['from', 'to'] as const).map((key) => (
              <div className="form-field" key={key}>
                <label htmlFor={`${id}-${key}`}>{key === 'from' ? 'From' : 'To'}</label>
                <Input
                  id={`${id}-${key}`}
                  type="date"
                  value={draft[key]}
                  min={key === 'to' ? draft.from || undefined : undefined}
                  max={key === 'from' ? draft.to || undefined : undefined}
                  aria-invalid={invalid}
                  aria-describedby={invalid ? `${id}-error` : undefined}
                  onChange={(event) => {
                    const value = event.target.value;
                    setDraft((current) => ({ ...current, [key]: value }));
                    if (value) setMonth(dateValue(value)!);
                  }}
                />
              </div>
            ))}
          </div>
          {invalid && (
            <p id={`${id}-error`} className="small" role="alert">
              Choose an end date on or after the start date.
            </p>
          )}
          <Calendar
            mode="range"
            month={month}
            onMonthChange={setMonth}
            selected={{ from: dateValue(draft.from), to: dateValue(draft.to) }}
            onSelect={(range) =>
              setDraft({
                from: range?.from ? dayKey(range.from) : '',
                to: range?.to ? dayKey(range.to) : '',
              })
            }
            captionLayout="dropdown"
            startMonth={new Date(1900, 0)}
            endMonth={new Date(2100, 11)}
          />
          <div className="sheet-actions date-range-actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={invalid}
              onClick={() => {
                onChange(draft.from, draft.to);
                setOpen(false);
              }}
            >
              Apply dates
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
