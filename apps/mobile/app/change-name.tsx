import { useGatedPageTitle } from "../src/lib/gatedTitle";
import { AuthGate } from "../src/screens/AuthScreen";
import { NameScreen } from "../src/screens/NameScreen";
export default function Page() {
  useGatedPageTitle("Change your name");
  return (
    <AuthGate>
      <NameScreen />
    </AuthGate>
  );
}
