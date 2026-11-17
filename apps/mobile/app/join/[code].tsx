import { useLocalSearchParams } from "expo-router";
import { AuthGate } from "../../src/screens/AuthScreen";
import { JoinScreen } from "../../src/screens/LeaguesScreen";
export default function Page() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return (
    <AuthGate>
      <JoinScreen code={code} />
    </AuthGate>
  );
}
