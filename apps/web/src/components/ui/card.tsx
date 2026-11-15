import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { cn } from "cn";
import type * as React from "react";

/** A surface, told apart from the page by its fill rather than an outline. */
function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("grid gap-4 rounded-xl bg-card p-4", className)} {...props} />;
}

/** A small label above a group of rows or fields. */
function Eyebrow({ className, ...props }: React.ComponentProps<"h4">) {
  return <h4 className={cn("text-sm font-semibold text-muted-foreground", className)} {...props} />;
}

/** The outcome of something the user just did. `alert` is for failures, `status` for confirmations. */
function Notice({
  kind,
  className,
  children,
  ...props
}: { kind: "alert" | "status" } & React.ComponentProps<"p">) {
  const Icon = kind === "alert" ? WarningCircleIcon : CheckCircleIcon;
  return (
    <p
      role={kind}
      className={cn(
        "m-0 flex items-start gap-1.5 text-sm font-medium",
        kind === "alert" ? "text-destructive" : "text-win",
        className,
      )}
      {...props}
    >
      <Icon aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export { Card, Eyebrow, Notice };
