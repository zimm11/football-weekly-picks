import { useLocalSearchParams } from "expo-router";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { ManageWeekScreen } from "../../../src/screens/ManageWeekScreen";
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <ManageWeekScreen weekId={id} />
    </AuthGate>
  );
}
