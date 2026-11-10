import { describe, expect, it } from "vitest";
import { createExampleSchema } from "./index";

describe("createExampleSchema", () => {
  it("trims the title", () => {
    expect(createExampleSchema.parse({ title: "  hello  " })).toEqual({ title: "hello" });
  });

  it.each([{ title: "" }, { title: "   " }, { title: "x".repeat(201) }, {}])("rejects %o", (input) => {
    expect(createExampleSchema.safeParse(input).success).toBe(false);
  });
});
