import type { ReminderHandler } from "../reminderTargets";

/*
 * Playoff pick'em: games still unpicked on the next game day, and none once the guillotine has put a player out.
 * The 7pm-the-evening-before rule is `dueReminderDay` in packages/shared.
 *
 * Stub: nobody is due yet, and a queued reminder never still applies. Replace with the real queries.
 */
export const playoffReminders: ReminderHandler = {
  async due() {
    return [];
  },
  async stillDue() {
    return null;
  },
};
