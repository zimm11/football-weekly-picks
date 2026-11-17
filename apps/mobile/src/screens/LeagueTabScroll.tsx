import type { ReactNode } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { colors } from "../components/ui";
import { s } from "./leagueUi";

/** A league tab's scrolling page: the header, then the tab's content, with pull to refresh. */
export function LeagueTabScroll({
  header,
  reload,
  children,
}: {
  header: ReactNode;
  reload: () => void;
  children: ReactNode;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.foreground} />}
      contentContainerStyle={[s.content, { gap: 20 }]}
    >
      {header}
      {children}
    </ScrollView>
  );
}
