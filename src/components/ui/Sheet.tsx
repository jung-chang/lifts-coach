import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export type SheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
};

export function Sheet({ open, onOpenChange, title, description, children }: SheetProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="context-sheet-overlay" />
        <DialogPrimitive.Content className="context-sheet-content">
          <div className="context-sheet-handle" aria-hidden="true">
            <span />
          </div>
          <header className="context-sheet-header">
            <div className="context-sheet-heading">
              <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
              {description && (
                <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close asChild>
              <button type="button" className="context-sheet-close" aria-label="Close">
                <X size={18} />
              </button>
            </DialogPrimitive.Close>
          </header>
          <div className="context-sheet-body">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default Sheet;
