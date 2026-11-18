import { useGatedPageTitle } from "../src/lib/gatedTitle";
import { AccountScreen } from "../src/screens/AccountScreen";
import { AuthGate } from "../src/screens/AuthScreen";
/** Old links to the notifications screen land on Settings, which holds them now. */
export default function Page() {
  useGatedPageTitle("Settings");
  return (
    <AuthGate>
      <AccountScreen />
    </AuthGate>
  );
}
