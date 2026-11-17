/** Same day-sensitive timestamp wording as the browser's format.relativeTime. */
export function messageTime(iso: string, now: Date): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const time = then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((dayStart(now) - dayStart(then)) / 86_400_000);
  if (days === 0) return time;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${then.toLocaleDateString("en-US", { weekday: "short" })}, ${time}`;
  return then.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: then.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
