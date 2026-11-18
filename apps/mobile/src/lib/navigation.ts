import { type Href, router, useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";
import { confirmDiscard, hasUnsavedWork } from "./unsaved";
/** Push preserves the previous screen, so native removal guards alone do not cover it. */
export async function openScreen(path: Href) {
  if (!hasUnsavedWork() || (await confirmDiscard())) router.push(path);
}

/**
 * Set on a league tab's route when the iPhone tab bar opened it (`LeagueTabBar`): the stack swaps to it without
 * a slide (`app/_layout.tsx`), and `useTabSwapDone` takes it off again once the tab is showing so going back
 * from that tab animates as usual. Never set on the web, where tabs are plain links.
 */
export const TAB_SWAP_PARAM = "tabSwap";

/** Whether a route was opened by a tab press and should appear without the stack's slide. */
export function isTabSwap(params: unknown) {
  return !!params && typeof params === "object" && !!(params as Record<string, unknown>)[TAB_SWAP_PARAM];
}

/**
 * For a screen the iPhone tab bar can swap to (the league's tabs): once it is showing, drops the tab-swap mark
 * so leaving it (All leagues, the back gesture) slides as any screen does.
 */
export function useTabSwapDone() {
  const navigation = useNavigation();
  const swapped = isTabSwap(useLocalSearchParams());
  useEffect(() => {
    if (Platform.OS === "web" || !swapped) return;
    // The native stack reports the end of every transition, an unanimated one included.
    return navigation.addListener("transitionEnd" as never, (event: { data?: { closing?: boolean } }) => {
      if (!event.data?.closing) navigation.setParams({ [TAB_SWAP_PARAM]: undefined } as never);
    });
  }, [navigation, swapped]);
}
