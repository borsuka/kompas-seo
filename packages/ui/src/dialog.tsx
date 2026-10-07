'use client';
import * as React from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from './cn';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  className,
  children,
  closeLabel,
  side,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Accessible label for the close button (pass a translated string). */
  closeLabel: string;
  /** Render as a sheet sliding in from the left (mobile navigation). */
  side?: 'left';
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="animate-in fade-in-0 fixed inset-0 z-50 bg-black/40" />
      <DialogPrimitive.Content
        className={cn(
          'border-border bg-background fixed z-50 border shadow-lg outline-none',
          side === 'left'
            ? 'animate-in slide-in-from-left inset-y-0 left-0 h-full w-72'
            : 'animate-in fade-in-0 zoom-in-95 top-1/2 left-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg p-6',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close
          className="focus-visible:ring-ring absolute top-3 right-3 rounded-sm p-1 opacity-70 hover:opacity-100 focus-visible:ring-2 focus-visible:outline-none"
          aria-label={closeLabel}
        >
          <X className="size-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mb-4 flex flex-col gap-1.5', className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold', className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}
