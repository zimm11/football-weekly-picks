import { cn } from "cn";
import type * as React from "react";

/** A placeholder block in the shape of content that is still loading. Still when motion is reduced. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-raised motion-reduce:animate-none", className)}
      {...props}
    />
  );
}

export { Skeleton };
