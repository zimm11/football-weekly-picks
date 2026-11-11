import { toast } from "sonner";

/** Announces that something the user just did worked. */
export const notifyDone = (text: string) => toast.success(text);

/** Announces a failure. It stays up longer, and until dismissed counts as unread. */
export const notifyError = (text: string) => toast.error(text, { duration: 10_000, closeButton: true });
