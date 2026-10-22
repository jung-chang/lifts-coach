import { DayPicker, getDefaultClassNames } from 'react-day-picker';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import 'react-day-picker/style.css';

/** shadcn Calendar composition, styled for the app's Maia tokens. */
export function Calendar({
  className,
  classNames,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  const defaults = getDefaultClassNames();
  return (
    <DayPicker
      showOutsideDays
      className={cn('calendar', className)}
      classNames={{ ...defaults, ...classNames }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === 'left' ? (
            <ChevronLeft size={18} />
          ) : orientation === 'right' ? (
            <ChevronRight size={18} />
          ) : (
            <ChevronDown size={16} />
          ),
      }}
      {...props}
    />
  );
}
