import { AuthGate } from "../src/screens/AuthScreen";
import { NameScreen } from "../src/screens/NameScreen";
export default function Page() {
  return (
    <AuthGate>
      <NameScreen />
    </AuthGate>
  );
}
