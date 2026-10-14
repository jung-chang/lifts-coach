import type { ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'ai';
  size?: 'sm' | 'md' | 'lg' | 'icon';
};
export function Button({ className, variant = 'secondary', size = 'md', ...props }: Props) {
  return (
    <button
      className={clsx('button', `button-${variant}`, `button-${size}`, className)}
      {...props}
    />
  );
}
