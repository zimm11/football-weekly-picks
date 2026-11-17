import { AccountScreen } from "../src/screens/AccountScreen";
import { AuthGate } from "../src/screens/AuthScreen";
export default function Page() {
  return (
    <AuthGate>
      <AccountScreen />
    </AuthGate>
  );
}
