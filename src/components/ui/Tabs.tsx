import type { ComponentProps } from 'react';
import * as Primitive from '@radix-ui/react-tabs';
import { cn } from '../../lib/utils';

/** shadcn Tabs composition using the shared Maia styles. */
export const Tabs = Primitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
  return <Primitive.List className={cn('exercise-tabs', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
  return <Primitive.Trigger className={cn('exercise-tab', className)} {...props} />;
}
export const TabsContent = Primitive.Content;
