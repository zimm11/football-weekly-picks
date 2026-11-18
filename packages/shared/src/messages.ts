import { z } from "zod";
import type { MessageThread } from "./index";

/**
 * Most threads one player can start in one league in 24 hours. Every new thread emails and notifies the whole
 * league, so this keeps one busy poster from using up the day's email budget. Replies aren't limited.
 */
export const THREAD_DAILY_LIMIT = 5;

/** Threads per page of the message board, not counting pinned announcements (all of which come first). */
export const THREAD_PAGE_SIZE = 30;

/**
 * Asking for a page (with `limit`, `before` or both) gets a `ThreadPage`. A request with neither gets the
 * whole list as an array, the way tabs opened before pagination still ask for it.
 */
/**
 * Where a page of the board ended: the last thread's `updated_at` in microseconds, then its id. A position
 * rather than a thread, so the next page starts in the same place even if that thread has since been bumped
 * by a reply or deleted.
 */
const threadCursorSchema = z
  .string()
  .regex(/^\d{1,19}\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  .transform((cursor) => {
    const [updatedAtMicros = "", id = ""] = cursor.split(".");
    return { updatedAtMicros, id };
  });

export const threadCursor = (updatedAtMicros: string, id: string) => `${updatedAtMicros}.${id}`;

export const threadListQuerySchema = z.object({
  /** The `nextCursor` of the previous page. */
  before: threadCursorSchema.optional(),
  limit: z
    .string()
    .regex(/^\d{1,3}$/)
    .transform(Number)
    .pipe(z.int().min(1).max(100))
    .optional(),
});

export type ThreadPage = {
  /** Pinned announcements first (all of them, on the first page only), then the newest threads. */
  threads: MessageThread[];
  /** Pass as `before` for the next page; null on the last page. */
  nextCursor: string | null;
  /** Unread threads across the whole board, not just this page. */
  unreadCount: number;
  /**
   * Why the signed-in player can't post here right now (a mute, a suspension), or null: the same text a thread
   * carries, so the board can say so before they write a new thread. Absent from servers older than the field.
   */
  postingBlocked?: string | null;
};
