import { useLocalSearchParams } from "expo-router";
import { AuthGate } from "../../../src/screens/AuthScreen";
import { BoardScreen } from "../../../src/screens/squares/BoardScreen";
export default function Page() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <AuthGate>
      <BoardScreen boardId={id} />
    </AuthGate>
  );
}
