import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { Notice } from "./ui/card";

/** A screen (or part of one) that couldn't load: why, and a way to try again without reloading the app. */
export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-destructive/10 p-3">
      <Notice kind="alert" className="min-w-0 flex-1">
        {message}
      </Notice>
      <Button type="button" variant="secondary" onClick={onRetry}>
        <ArrowsClockwiseIcon aria-hidden />
        Try again
      </Button>
    </div>
  );
}
