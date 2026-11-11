import { cn } from "cn";
import type { ReactNode } from "react";

/** A headline number with its label above and a line of context below. Goes inside a `StatGrid`. */
export function StatTile({
  label,
  value,
  detail,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid content-start gap-1 rounded-md border bg-card p-3", className)}>
      <dt className="font-display text-xs font-bold tracking-wider text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="m-0 font-display text-3xl leading-none font-bold tabular-nums">{value}</dd>
      {detail && <dd className="m-0 text-sm text-muted-foreground">{detail}</dd>}
    </div>
  );
}

/** A list of stat tiles: two a row on a phone, more as the screen widens. */
export function StatGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <section aria-label={label}>
      <dl className="m-0 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{children}</dl>
    </section>
  );
}
