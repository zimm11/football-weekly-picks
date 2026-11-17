import type { ReminderHandler } from "../reminderTargets";

/*
 * Squares: members with no square on a board still open, the evening before its kickoff.
 * The 7pm-the-evening-before rule is `dueReminderDay` in packages/shared.
 *
 * Stub: nobody is due yet, and a queued reminder never still applies. Replace with the real queries.
 */
export const squaresReminders: ReminderHandler = {
  async due() {
    return [];
  },
  async stillDue() {
    return null;
  },
};
