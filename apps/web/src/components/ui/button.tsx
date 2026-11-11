import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

// Sized for thumbs: the default is 44px tall. Labels are scoreboard capitals.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-display font-bold tracking-wide whitespace-nowrap uppercase no-underline transition-colors select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/85",
        outline: "border-input bg-transparent text-foreground hover:bg-secondary",
        secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/70",
        ghost: "border-transparent text-foreground hover:bg-secondary",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "border-transparent h-auto! px-0! font-sans font-medium tracking-normal text-primary normal-case underline hover:text-primary/80",
      },
      size: {
        default: "h-11 px-4 text-lg",
        sm: "h-9 px-3 text-base",
        lg: "h-12 px-6 text-xl",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
