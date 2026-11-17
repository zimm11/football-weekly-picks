import { AuthGate } from "../src/screens/AuthScreen";
import { LeaguesScreen } from "../src/screens/LeaguesScreen";
export default function Page() {
  return (
    <AuthGate>
      <LeaguesScreen />
    </AuthGate>
  );
}
