import { useLocalSearchParams } from "expo-router";
import { useGatedPageTitle } from "../../../src/lib/gatedTitle";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { ManageWeekScreen } from "../../../src/screens/ManageWeekScreen";
export default function Page() {
  useGatedPageTitle();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <ManageWeekScreen weekId={id} />
    </AuthGate>
  );
}
