import { cn } from "cn";
import type * as React from "react";

// 16px text keeps iOS from zooming the page when a field takes focus.
export const fieldClass =
  "h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base text-foreground transition-colors placeholder:text-muted-foreground focus-visible:border-ring disabled:cursor-not-allowed disabled:opacity-50 read-only:text-muted-foreground";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input type={type} data-slot="input" className={cn(fieldClass, className)} {...props} />;
}

/** The platform's own picker, which is the best select there is on a phone. */
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return <select data-slot="select" className={cn(fieldClass, "pr-2", className)} {...props} />;
}

/** A control under its label. Wrapping the control in the label ties the two together without ids. */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is passed in as children.
    <label className={cn("grid gap-1.5 text-sm font-medium text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}

export { Field, Input, NativeSelect };
