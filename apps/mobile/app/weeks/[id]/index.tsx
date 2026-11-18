import { useLocalSearchParams } from "expo-router";
import { useGatedPageTitle } from "../../../src/lib/gatedTitle";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { WeekScreen } from "../../../src/screens/WeekScreen";
export default function Page() {
  useGatedPageTitle();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <WeekScreen weekId={id} />
    </AuthGate>
  );
}
