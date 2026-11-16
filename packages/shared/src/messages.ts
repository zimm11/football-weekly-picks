import { z } from "zod";
import type { MessageThread } from "./index";

/** Threads per page of the message board, not counting pinned announcements (all of which come first). */
export const THREAD_PAGE_SIZE = 30;

/**
 * Asking for a page (with `limit`, `before` or both) gets a `ThreadPage`. A request with neither gets the
 * whole list as an array, the way tabs opened before pagination still ask for it.
 */
export const threadListQuerySchema = z.object({
  /** The last thread of the previous page. */
  before: z.uuid().optional(),
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
};
