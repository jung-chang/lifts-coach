import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, Search, X } from 'lucide-react';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import './search-picker.css';

export interface SearchOption {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
}
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .toLowerCase();

export function SearchPicker({
  label,
  value,
  options,
  onChange,
  placeholder = 'Search',
  emptyMessage = 'No matches found.',
  footer,
  description,
  searchLabel,
  open: controlledOpen,
  onOpenChange,
  hideTrigger = false,
  triggerLabel,
  triggerIcon,
  onCreate,
}: {
  label: string;
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  emptyMessage?: string;
  footer?: ReactNode;
  description?: string;
  searchLabel?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
  triggerLabel?: string;
  triggerIcon?: ReactNode;
  onCreate?: (query: string) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const listId = useId();
  const open = controlledOpen ?? localOpen;
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  const changeOpen = (next: boolean) => {
    if (next) setQuery('');
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const selected = options.find((option) => option.value === value);
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  const results = options.filter((option) =>
    terms.every((term) =>
      normalize(`${option.label} ${option.description || ''} ${option.searchText || ''}`).includes(
        term,
      ),
    ),
  );
  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          className="search-picker-trigger"
          aria-label={label}
          aria-description={selected?.label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => changeOpen(true)}
        >
          <span>{triggerLabel || selected?.label || label}</span>
          {triggerIcon ?? <Search size={17} aria-hidden="true" />}
        </button>
      )}
      <Sheet open={open} onOpenChange={changeOpen} title={label} description={description}>
        <div className="search-picker">
          <div className="search-picker-input search-wrap">
            <Search size={17} aria-hidden="true" />
            <input
              autoFocus
              type="search"
              className="input"
              aria-label={searchLabel || `Search ${label.toLowerCase()}`}
              placeholder={placeholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-controls={listId}
            />
            {query && (
              <button
                className="search-picker-clear"
                type="button"
                aria-label="Clear search text"
                onClick={() => setQuery('')}
              >
                <X size={16} />
              </button>
            )}
          </div>
          <p className="search-picker-count muted small" role="status">
            {results.length} {results.length === 1 ? 'result' : 'results'}
          </p>
          <div className="search-picker-results" id={listId}>
            {results.map((option) => (
              <button
                type="button"
                key={option.value}
                className="search-picker-option"
                aria-pressed={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  changeOpen(false);
                }}
              >
                <span>
                  <span>{option.label}</span>
                  {option.description && (
                    <span className="search-picker-description muted small">
                      {option.description}
                    </span>
                  )}
                </span>
                {option.value === value && <Check size={17} aria-hidden="true" />}
              </button>
            ))}
            {!results.length && (
              <div className="search-picker-empty">
                <p className="muted small">{emptyMessage}</p>
                <Button variant="secondary" onClick={() => setQuery('')}>
                  Clear search
                </Button>
              </div>
            )}
          </div>
          {(footer || onCreate) && (
            <div className="search-picker-footer">
              {onCreate && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    changeOpen(false);
                    onCreate(query.trim());
                  }}
                >
                  Create exercise
                </Button>
              )}
              {footer}
            </div>
          )}
        </div>
      </Sheet>
    </>
  );
}
