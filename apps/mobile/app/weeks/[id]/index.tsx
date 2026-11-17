import { useLocalSearchParams } from "expo-router";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { WeekScreen } from "../../../src/screens/WeekScreen";
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <WeekScreen weekId={id} />
    </AuthGate>
  );
}
