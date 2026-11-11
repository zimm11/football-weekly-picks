import { cn } from "cn";
import type * as React from "react";

function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("grid gap-4 rounded-md border bg-card p-4", className)} {...props} />;
}

/** A small capital label above a group of rows or fields. */
function Eyebrow({ className, ...props }: React.ComponentProps<"h4">) {
  return <h4 className={cn("text-base tracking-widest text-muted-foreground", className)} {...props} />;
}

/** The outcome of something the user just did. `alert` is for failures, `status` for confirmations. */
function Notice({ kind, className, ...props }: { kind: "alert" | "status" } & React.ComponentProps<"p">) {
  return (
    <p
      role={kind}
      className={cn(
        "m-0 border-l-4 py-1 pl-3 text-sm font-medium",
        kind === "alert" ? "border-destructive text-destructive" : "border-win text-win",
        className,
      )}
      {...props}
    />
  );
}

export { Card, Eyebrow, Notice };
