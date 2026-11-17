import { z } from "zod";

/*
 * Deleting an account (App Store guideline 5.1.1(v)). Personal data goes; results from weeks already played stay
 * under this name, so nobody else's standings change.
 */

/** The name a deleted account's profile keeps, for results and standings. */
export const DELETED_PLAYER_NAME = "Deleted player";
/** What stands in for a deleted player's messages and the titles of threads they started. */
export const DELETED_MESSAGE_TEXT = "Deleted player's message";
export const DELETED_THREAD_TITLE = "Thread from a deleted player";

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password").max(200),
});

/** What deleting would do, for the confirmation sheet. */
export type AccountDeletionPreview = {
  /** Leagues the player will leave. */
  leaving: { id: string; name: string }[];
  /** Leagues where they are the only admin and others remain: deletion waits until someone else is an admin. */
  soleAdmin: { id: string; name: string }[];
  /** Leagues where they are the only member, deleted along with the account. */
  deletedLeagues: { id: string; name: string }[];
  /** Account deletion is switched on (the API has its Auth admin key). */
  available: boolean;
};
