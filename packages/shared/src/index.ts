import { z } from "zod";

/**
 * Shared API contracts, imported by the API, the web app, and (later) the mobile app.
 *
 * PLACEHOLDER: `Example` exists only to exercise the stack end to end (auth → API → DB → UI).
 * Replace it with real domain types.
 */

export const createExampleSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
});
export type CreateExample = z.infer<typeof createExampleSchema>;

export const exampleSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type Example = z.infer<typeof exampleSchema>;

export const meSchema = z.object({ id: z.uuid(), email: z.string().optional() });
export type Me = z.infer<typeof meSchema>;
