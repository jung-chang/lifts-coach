import type { ComponentProps } from 'react';
import * as Primitive from '@radix-ui/react-accordion';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

/** shadcn Accordion composition using the shared Maia styles. */
export const Accordion = Primitive.Root;
export const AccordionItem = Primitive.Item;
export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof Primitive.Trigger>) {
  return (
    <Primitive.Header className="note-accordion-heading">
      <Primitive.Trigger className={cn('note-accordion-trigger', className)} {...props}>
        {children}
        <ChevronDown size={16} aria-hidden="true" />
      </Primitive.Trigger>
    </Primitive.Header>
  );
}
export function AccordionContent({
  className,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Content className={cn('note-accordion-content', className)} {...props} />;
}
