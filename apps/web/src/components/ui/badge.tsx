import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import type * as React from "react";

const badgeVariants = cva(
  "inline-flex h-6 w-fit shrink-0 items-center gap-1 rounded-md border border-transparent px-2 font-display text-sm font-bold tracking-wider whitespace-nowrap uppercase",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        outline: "border-border text-muted-foreground",
        pow: "bg-pow text-pow-foreground",
        win: "bg-win/15 text-win",
        loss: "border-border text-muted-foreground line-through",
        warn: "bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Badge({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
