/** Shown only while the local API runs with `CLOCK_OVERRIDE`, so a shifted clock is never mistaken for the real one. */
export function SimulatedClockBanner({ now, offsetMs }: { now: Date; offsetMs: number }) {
  if (offsetMs === 0) return null;
  const label = now.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return (
    <p role="status" className="m-0 bg-secondary px-4 py-1 text-center font-display text-sm uppercase">
      Simulated time: {label}
    </p>
  );
}
