import { describe, expect, it } from "vitest";
import { FEEDBACK_MAX_LENGTH, feedbackPageSchema, sendFeedbackSchema } from "./operator";

describe("feedback validation", () => {
  it("accepts each category and trims messages", () => {
    for (const kind of ["bug", "feature", "other"]) {
      expect(sendFeedbackSchema.parse({ kind, message: "  Please add reminders  " })).toEqual({
        kind,
        message: "Please add reminders",
      });
    }
  });

  it("bounds message size and rejects blank messages", () => {
    for (const message of ["   ", "x".repeat(FEEDBACK_MAX_LENGTH + 1)]) {
      expect(sendFeedbackSchema.safeParse({ kind: "bug", message }).success).toBe(false);
    }
  });

  it("keeps return paths local and excludes sensitive URL context", () => {
    for (const path of [
      "https://example.com",
      "//example.com",
      "/\\example.com",
      "/\n/example.com",
      "/?token=secret",
      "/#access_token=secret",
      "/join/invite-secret",
      "/feedback",
      "/%2fexample.com",
    ]) {
      expect(feedbackPageSchema.safeParse(path).success).toBe(false);
    }
    expect(feedbackPageSchema.parse("/leagues/abc/standings")).toBe("/leagues/abc/standings");
    expect(feedbackPageSchema.parse("/")).toBe("/");
  });
});
