import type { ComponentProps } from 'react';
import { cn } from '../../lib/utils';

/** shadcn Input with the app's existing control tokens. */
export function Input({ className, type, ...props }: ComponentProps<'input'>) {
  return <input type={type} data-slot="input" className={cn('input', className)} {...props} />;
}
