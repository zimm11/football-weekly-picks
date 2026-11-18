import { useGatedPageTitle } from "../src/lib/gatedTitle";
import { AuthGate } from "../src/screens/AuthScreen";
import { NameScreen } from "../src/screens/NameScreen";
export default function Page() {
  useGatedPageTitle("Name and picture");
  return (
    <AuthGate>
      <NameScreen />
    </AuthGate>
  );
}
