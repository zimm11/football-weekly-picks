import { useLocalSearchParams } from "expo-router";
import { useGatedPageTitle } from "../../../../src/lib/gatedTitle";
import { AuthGate } from "../../../../src/screens/AuthScreen";
import { LeagueScreen } from "../../../../src/screens/LeagueScreen";
export default function Page() {
  useGatedPageTitle();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <LeagueScreen leagueId={id} path="standings" />
    </AuthGate>
  );
}
