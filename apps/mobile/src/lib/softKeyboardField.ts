/** What a focused element is, as far as the on-screen keyboard cares. */
export type FocusedField = {
  tagName: string;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  isContentEditable?: boolean;
};

/** Inputs that open a picker, a toggle or nothing, rather than the keyboard. */
const NO_KEYBOARD = new Set([
  "button",
  "checkbox",
  "color",
  "date",
  "datetime-local",
  "file",
  "hidden",
  "image",
  "month",
  "radio",
  "range",
  "reset",
  "submit",
  "time",
  "week",
]);

/** Whether focusing this element brings up a phone's on-screen keyboard. */
export function opensKeyboard(field: FocusedField | null | undefined): boolean {
  if (!field) return false;
  if (field.readOnly || field.disabled) return false;
  const tag = field.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return !NO_KEYBOARD.has((field.type || "text").toLowerCase());
  return !!field.isContentEditable;
}
