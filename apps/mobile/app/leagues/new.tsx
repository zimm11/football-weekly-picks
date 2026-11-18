import { useGatedPageTitle } from "../../src/lib/gatedTitle";
import { AuthGate } from "../../src/screens/AuthScreen";
import { NewLeagueScreen } from "../../src/screens/NewLeagueScreen";
export default function Page() {
  useGatedPageTitle("New league");
  return (
    <AuthGate>
      <NewLeagueScreen />
    </AuthGate>
  );
}
