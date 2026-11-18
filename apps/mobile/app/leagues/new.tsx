import { AuthGate } from "../../src/screens/AuthScreen";
import { NewLeagueScreen } from "../../src/screens/NewLeagueScreen";
export default function Page() {
  return (
    <AuthGate>
      <NewLeagueScreen />
    </AuthGate>
  );
}
