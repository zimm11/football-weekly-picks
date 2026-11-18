import type { ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { colors } from "../components/ui";
import { usePullRefresh } from "../lib/pullRefresh";
import { useScrollRestore } from "../lib/scrollRestore";
import { s } from "./leagueUi";

/**
 * A league tab's scrolling page: the header, then the tab's content, with pull to refresh. The spinner stays
 * from the player's pull until `reload` settles when it returns a promise (`refresh` from `useLeagueLoad`).
 * In a browser, Back and Forward return to where the page was scrolled.
 */
export function LeagueTabScroll({
  header,
  reload,
  children,
}: {
  header: ReactNode;
  reload: () => unknown;
  children: ReactNode;
}) {
  const pull = usePullRefresh(reload);
  const scrollRef = useScrollRestore();
  return (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      // A focused field stays above the iPhone keyboard, and dragging the page puts the keyboard away.
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
      refreshControl={<RefreshControl {...pull} tintColor={colors.foreground} />}
      contentContainerStyle={[s.content, { gap: 20 }]}
    >
      {header}
      {children}
    </ScrollView>
  );
}
