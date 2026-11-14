/**
 * A clock that starts at `start` and then keeps running in real time, so locks and phases
 * advance during a session the way they would on game day. Local testing only (see `CLOCK_OVERRIDE`).
 */
export function shiftedClock(start: Date, realNow: () => Date = () => new Date()) {
  const offsetMs = start.getTime() - realNow().getTime();
  return { offsetMs, now: () => new Date(realNow().getTime() + offsetMs) };
}
