import type { ReactNode } from "react";
import { Skeleton } from "./ui/skeleton";

/**
 * Loading placeholders shaped like the screens they stand in for, so nothing jumps when the data arrives.
 * Each is one `status` region named for what is loading; the shapes inside are hidden from screen readers.
 */
function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" aria-label={label} aria-busy className="grid gap-4">
      <span className="sr-only">{label}…</span>
      {children}
    </div>
  );
}

function ListShapes({ rows }: { rows: number }) {
  return (
    <div className="grid gap-2">
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <div key={i} className="flex items-center gap-3 rounded-xl bg-card p-4">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rows with an avatar and two lines of text: leagues, threads, messages. */
export function ListSkeleton({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <Loading label={label}>
      <ListShapes rows={rows} />
    </Loading>
  );
}

/** Checkbox rows with a label and a description, inside a card that is already on screen: settings. */
export function SettingsSkeleton({ label, rows = 2 }: { label: string; rows?: number }) {
  return (
    <Loading label={label}>
      {Array.from({ length: rows }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <div key={i} className="flex min-h-11 items-start gap-3 py-1">
          <Skeleton className="size-5 shrink-0 rounded-sm" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </Loading>
  );
}

function GameCardSkeleton() {
  return (
    <div className="grid gap-3 rounded-xl bg-card p-3">
      <div className="flex justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      <div className="grid grid-cols-[1fr_1fr_3.5rem] gap-2">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
    </div>
  );
}

function WeekShapes() {
  return (
    <>
      <div className="grid gap-2">
        <Skeleton className="h-6 w-28 rounded-full" />
        <Skeleton className="h-11 w-48" />
      </div>
      <Skeleton className="h-[4.5rem] rounded-xl" />
      <GameCardSkeleton />
      <GameCardSkeleton />
      <GameCardSkeleton />
    </>
  );
}

/** A week: its heading, the status line and a few game cards. */
export function WeekSkeleton() {
  return (
    <Loading label="Loading week">
      <WeekShapes />
    </Loading>
  );
}

/** The body of a league tab, by tab: the pick sheet, a table, or a list. */
export type SkeletonShape = "week" | "standings" | "list";

/** A league screen before the league has loaded: its header and tabs, then the tab being opened. */
export function LeagueSkeleton({ shape = "week" }: { shape?: SkeletonShape }) {
  return (
    <Loading label="Loading league">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-56" />
      </div>
      <Skeleton className="h-11 w-full rounded-full max-md:hidden" />
      {shape === "week" && <WeekShapes />}
      {shape === "standings" && <StandingsShapes />}
      {shape === "list" && <ListShapes rows={4} />}
    </Loading>
  );
}

function StandingsShapes() {
  return (
    <>
      <Skeleton className="h-9 w-48" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl bg-card">
        {Array.from({ length: 5 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
          <div key={i} className="flex items-center gap-3 px-3 py-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-10" />
          </div>
        ))}
      </div>
    </>
  );
}

/** Stat tiles over a table. */
export function StandingsSkeleton() {
  return (
    <Loading label="Loading standings">
      <StandingsShapes />
    </Loading>
  );
}
