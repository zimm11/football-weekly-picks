import type { Example } from "@picks/shared";
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ExampleList } from "./ExampleList";

const item = (title: string): Example => ({
  id: crypto.randomUUID(),
  title,
  createdAt: "2026-11-09T00:00:00Z",
});

describe("ExampleList", () => {
  it("shows an empty state", async () => {
    const screen = await render(<ExampleList items={[]} onAdd={vi.fn()} />);
    await expect.element(screen.getByText("No items yet.")).toBeVisible();
  });

  it("renders items", async () => {
    const screen = await render(<ExampleList items={[item("one"), item("two")]} onAdd={vi.fn()} />);
    await expect.element(screen.getByRole("listitem").nth(1)).toHaveTextContent("two");
  });

  it("submits a new item and clears the input", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const screen = await render(<ExampleList items={[]} onAdd={onAdd} />);
    const input = screen.getByLabelText("New item");

    await input.fill("hello");
    await screen.getByRole("button", { name: "Add" }).click();

    expect(onAdd).toHaveBeenCalledWith("hello");
    await expect.element(input).toHaveValue("");
  });

  it("keeps the input and shows the error when adding fails", async () => {
    const screen = await render(<ExampleList items={[]} onAdd={vi.fn().mockResolvedValue("Nope")} />);
    await screen.getByLabelText("New item").fill("hello");
    await screen.getByRole("button", { name: "Add" }).click();

    await expect.element(screen.getByRole("alert")).toHaveTextContent("Nope");
    await expect.element(screen.getByLabelText("New item")).toHaveValue("hello");
  });
});
