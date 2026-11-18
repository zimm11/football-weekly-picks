import { useLocalSearchParams } from "expo-router";
import { useGatedPageTitle } from "../../src/lib/gatedTitle";
import { AuthGate } from "../../src/screens/AuthScreen";
import { JoinScreen } from "../../src/screens/LeaguesScreen";
export default function Page() {
  // JoinScreen names the tab once the player is in ("Join Sunday Crew").
  useGatedPageTitle();
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <AuthGate>
      <JoinScreen code={code} />
    </AuthGate>
  );
}
