import { useLocalSearchParams } from "expo-router";
import { useGatedPageTitle } from "../../../../src/lib/gatedTitle";
import { AuthGate } from "../../../../src/screens/AuthScreen";
import { NewBoardScreen } from "../../../../src/screens/squares/NewBoard";
export default function Page() {
  useGatedPageTitle();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <NewBoardScreen leagueId={id} />
    </AuthGate>
  );
}
