/** NFL kickoff slots (Sunday night, Monday night, …) are defined in Eastern time, whatever a league's own time zone. */
export const NFL_TIME_ZONE = "America/New_York";

export type ZonedParts = {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  /** 0–23 */
  hour: number;
  minute: number;
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock date and time of an instant in a time zone. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(parts.weekday ?? ""),
  };
}

/** The instant at which a time zone's wall clock reads the given date and hour. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour);
  const offsetAt = (t: number) => {
    const p = zonedParts(new Date(t), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - t;
  };
  // Two passes, so the answer is right even when the first guess lands on the other side of a DST change.
  const first = wall - offsetAt(wall);
  return new Date(wall - offsetAt(first));
}

/** Longest time zone name accepted. The longest real one, America/Argentina/ComodRivadavia, is 30. */
export const MAX_TIME_ZONE_LENGTH = 64;

/** A geographic IANA name (Area/Location, as in America/New_York or America/Indiana/Indianapolis), or UTC. */
const AREA_LOCATION =
  /^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)(\/[A-Za-z0-9_+-]+){1,2}$/;

/**
 * The canonical spelling of a time zone, or null when it isn't one a league can use. Accepts any spelling the
 * runtime knows ("america/new_york", "US/Eastern") and returns the name it resolves to, but only geographic
 * Area/Location names and UTC: offsets ("+05:30") and POSIX-style names ("EST5EDT") are refused, since older
 * browsers can't display times in them.
 */
export function canonicalTimeZone(timeZone: string): string | null {
  if (timeZone.length > MAX_TIME_ZONE_LENGTH) return null;
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
  return resolved === "UTC" || AREA_LOCATION.test(resolved) ? resolved : null;
}

export function isValidTimeZone(timeZone: string): boolean {
  return canonicalTimeZone(timeZone) !== null;
}
