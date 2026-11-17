import { useLocalSearchParams } from "expo-router";
import { AuthGate } from "../../../../src/screens/AuthScreen";
import { MessagesScreen } from "../../../../src/screens/MessagesScreen";
export default function Page() {
  const { id, threadId } = useLocalSearchParams<{ id: string; threadId: string }>();
  return (
    <AuthGate>
      <MessagesScreen leagueId={id} threadId={threadId} />
    </AuthGate>
  );
}
