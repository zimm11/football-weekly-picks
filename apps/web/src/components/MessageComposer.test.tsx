import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { MessageComposer } from "../pages/MessagesPage";

const original = { id: "original", authorName: "Pat", body: "The Eagles will cover." };

function Draft() {
  const [quote, setQuote] = useState<typeof original | undefined>(original);
  return <MessageComposer reply quote={quote} onCancelQuote={() => setQuote(undefined)} onSubmit={vi.fn()} />;
}

describe("quoted reply composer", () => {
  it("removes a quote without losing the reply draft", async () => {
    const screen = await render(<Draft />);
    await expect.element(screen.getByText("Pat wrote:", { exact: true })).toBeVisible();
    await expect.element(screen.getByText(original.body, { exact: true })).toBeVisible();
    const reply = screen.getByRole("textbox", { name: "Reply", exact: true });
    await expect.element(reply).toHaveFocus();
    await reply.fill("Agreed!");
    await screen.getByRole("button", { name: "Remove quote", exact: true }).click();
    await expect.element(screen.getByRole("region", { name: "Reply quote preview" })).not.toBeInTheDocument();
    await expect.element(reply).toHaveValue("Agreed!");
  });

  it("keeps the quote and reply after a failed submission", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("Please try again."));
    const screen = await render(
      <MessageComposer reply quote={original} onCancelQuote={() => {}} onSubmit={onSubmit} />,
    );
    const reply = screen.getByRole("textbox", { name: "Reply", exact: true });
    await reply.fill("Agreed!");
    await screen.getByRole("button", { name: "Post reply", exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Please try again.");
    await expect.element(reply).toHaveValue("Agreed!");
    await expect.element(screen.getByRole("region", { name: "Reply quote preview" })).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Post reply", exact: true })).toBeEnabled();
  });
});
