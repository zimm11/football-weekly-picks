import { AuthGate } from "../src/screens/AuthScreen";
import { PasswordScreen } from "../src/screens/PasswordScreen";
export default function Page() {
  return (
    <AuthGate>
      <PasswordScreen />
    </AuthGate>
  );
}
