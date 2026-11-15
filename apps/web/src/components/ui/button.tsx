import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";
import type * as React from "react";

// Sized for thumbs: the default is 44px tall. Labels are plain Barlow in sentence case; capitals are for titles.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border font-semibold whitespace-nowrap no-underline transition-[color,background-color,border-color,transform] select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-sm shadow-primary/20 hover:bg-primary/90",
        outline: "border-input bg-transparent text-foreground hover:bg-raised",
        secondary: "border-transparent bg-raised text-secondary-foreground hover:bg-raised/70",
        ghost: "border-transparent text-foreground hover:bg-raised",
        destructive: "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "border-transparent h-auto! px-0! font-medium text-primary underline hover:text-primary/80",
      },
      size: {
        default: "h-11 px-4 text-base",
        sm: "h-9 px-3 text-sm",
        lg: "h-12 px-6 text-base",
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
