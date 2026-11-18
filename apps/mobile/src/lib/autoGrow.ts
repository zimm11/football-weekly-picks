/**
 * How tall a growing text box should be, and whether it now scrolls inside. `content` is the height of its
 * text (a textarea's `scrollHeight`, padding included) and `frame` what its borders add; the box stays between
 * `min` and `max`.
 */
export function grownHeight(content: number, frame: number, min: number, max: number) {
  const wanted = Math.ceil(content + frame);
  return { height: Math.max(min, Math.min(max, wanted)), scrolls: wanted > max };
}
