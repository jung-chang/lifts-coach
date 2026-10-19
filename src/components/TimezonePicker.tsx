import { useMemo } from 'react';
import { SearchPicker } from './SearchPicker';

export function TimezonePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const options = useMemo(() => {
    const deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const zones = new Set([
      'UTC',
      value,
      deviceZone,
      ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []),
    ]);
    const priority = (zone: string) =>
      zone === value ? 0 : zone === deviceZone ? 1 : zone === 'UTC' ? 2 : 3;
    return [...zones]
      .sort((a, b) => priority(a) - priority(b) || a.localeCompare(b))
      .map((zone) => {
        const offset =
          new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
            .formatToParts()
            .find((part) => part.type === 'timeZoneName')?.value || 'UTC';
        return {
          value: zone,
          label: zone.replaceAll('_', ' ').replaceAll('/', ' / '),
          description: offset.replace('GMT', 'UTC'),
          searchText: `${zone} ${offset.replace('GMT', 'UTC').replace(/([+-])0(\d):00/, '$1$2')}`,
        };
      });
  }, [value]);
  return (
    <SearchPicker
      label="Training timezone"
      searchLabel="Search timezones"
      value={value}
      options={options}
      onChange={onChange}
      placeholder="City, region, or UTC offset"
      emptyMessage="No matching timezones."
    />
  );
}
