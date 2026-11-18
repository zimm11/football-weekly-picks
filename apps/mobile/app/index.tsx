import { useAuth } from "../src/lib/auth";
import { usePageTitle } from "../src/lib/pageTitle";
import { AuthGate } from "../src/screens/AuthScreen";
import { LeaguesScreen } from "../src/screens/LeaguesScreen";
export default function Page() {
  const auth = useAuth();
  // Signed out this is the front page, which keeps the app's own name.
  usePageTitle(!auth.loading && auth.session && auth.me?.displayName ? "Your leagues" : undefined);
  return (
    <AuthGate>
      <LeaguesScreen />
    </AuthGate>
  );
}
