import { type Href, router } from "expo-router";
import { confirmDiscard, hasUnsavedWork } from "./unsaved";
/** Push preserves the previous screen, so native removal guards alone do not cover it. */
export async function openScreen(path: Href) {
  if (!hasUnsavedWork() || (await confirmDiscard())) router.push(path);
}
