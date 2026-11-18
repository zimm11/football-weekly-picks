/**
 * Which item of a menu or radio group a key moves the keyboard focus to: the arrow keys step and wrap around,
 * Home and End jump to the ends. `enabled[i]` says whether item `i` can take focus; disabled ones are skipped.
 * Returns undefined for any other key, or when there is nowhere to go.
 */
export function rovingTarget(key: string, current: number, enabled: boolean[]): number | undefined {
  const count = enabled.length;
  if (!enabled.some(Boolean)) return undefined;
  const step =
    key === "ArrowDown" || key === "ArrowRight" ? 1 : key === "ArrowUp" || key === "ArrowLeft" ? -1 : 0;
  if (step) {
    // From outside the list (-1), Down lands on the first item and Up on the last.
    let index = current < 0 && step < 0 ? count : current;
    for (let tries = 0; tries < count; tries++) {
      index = (index + step + count) % count;
      if (enabled[index]) return index === current ? undefined : index;
    }
    return undefined;
  }
  if (key === "Home") return enabled.indexOf(true);
  if (key === "End") return enabled.lastIndexOf(true);
  return undefined;
}
