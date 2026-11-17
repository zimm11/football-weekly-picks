import { useLocalSearchParams } from "expo-router";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { ManageBoardScreen } from "../../../src/screens/squares/BoardScreen";
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <ManageBoardScreen boardId={id} />
    </AuthGate>
  );
}
