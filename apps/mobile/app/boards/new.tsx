import { useLocalSearchParams } from "expo-router";
import { NotFound } from "../../src/components/NotFound";
import { useGatedPageTitle } from "../../src/lib/gatedTitle";
import { AuthGate } from "../../src/screens/AuthScreen";
import { NewBoardScreen } from "../../src/screens/squares/NewBoard";

/**
 * `/boards/new?league=<id>`: a screen above the league, as a board is, not a route of the league's tab
 * navigator (`app/leagues/[id]/_layout.tsx`), so Back returns to the Boards tab and the new board takes its place.
 */
export default function Page() {
  const { league } = useLocalSearchParams<{ league?: string }>();
  useGatedPageTitle(league ? undefined : "Page not found");
  return <AuthGate>{league ? <NewBoardScreen leagueId={league} /> : <NotFound />}</AuthGate>;
}
