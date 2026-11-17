import type { ReminderHandler } from "../reminderTargets";

/*
 * Survivor: alive players with no pick yet for the week, the evening before a game day.
 * The 7pm-the-evening-before rule is `dueReminderDay` in packages/shared.
 *
 * Stub: nobody is due yet, and a queued reminder never still applies. Replace with the real queries.
 */
export const survivorReminders: ReminderHandler = {
  async due() {
    return [];
  },
  async stillDue() {
    return null;
  },
};
