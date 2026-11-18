import { useGatedPageTitle } from "../src/lib/gatedTitle";
import { AccountScreen } from "../src/screens/AccountScreen";
import { AuthGate } from "../src/screens/AuthScreen";
export default function Page() {
  useGatedPageTitle("Settings");
  return (
    <AuthGate>
      <AccountScreen />
    </AuthGate>
  );
}
