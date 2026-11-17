import { useLocalSearchParams } from "expo-router";
import { AuthGate } from "../../../../src/screens/AuthScreen";
import { LeagueScreen } from "../../../../src/screens/LeagueScreen";
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <LeagueScreen leagueId={id} tab="results" />
    </AuthGate>
  );
}
