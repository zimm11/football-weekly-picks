import { AccountScreen } from "../src/screens/AccountScreen";
import { AuthGate } from "../src/screens/AuthScreen";
/** Old links to the notifications screen land on Settings, which holds them now. */
export default function Page() {
  return (
    <AuthGate>
      <AccountScreen />
    </AuthGate>
  );
}
