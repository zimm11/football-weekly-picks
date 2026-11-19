import { useLocalSearchParams } from "expo-router";
import { useGatedPageTitle } from "../../../src/lib/gatedTitle";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { WeekProgressScreen } from "../../../src/screens/WeekProgressScreen";
export default function Page() {
  useGatedPageTitle();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <WeekProgressScreen weekId={id} />
    </AuthGate>
  );
}
