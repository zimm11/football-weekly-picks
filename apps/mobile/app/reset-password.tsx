import { useGatedPageTitle } from "../src/lib/gatedTitle";
import { AuthGate } from "../src/screens/AuthScreen";
import { PasswordScreen } from "../src/screens/PasswordScreen";
export default function Page() {
  useGatedPageTitle("Change password");
  return (
    <AuthGate>
      <PasswordScreen />
    </AuthGate>
  );
}
