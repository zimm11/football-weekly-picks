import { useLocalSearchParams } from "expo-router";
import { useLeagueShell } from "../../../../src/screens/leagueContext";
import { MessagesScreen } from "../../../../src/screens/MessagesScreen";
export default function Page() {
  const { leagueId } = useLeagueShell();
  const { threadId } = useLocalSearchParams<{ threadId: string }>();
  return <MessagesScreen leagueId={leagueId} threadId={threadId} />;
}
