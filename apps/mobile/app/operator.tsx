import { useGatedPageTitle } from "../src/lib/gatedTitle";
import { AuthGate } from "../src/screens/AuthScreen";
import { OperatorScreen } from "../src/screens/OperatorScreen";
export default function Page() {
  useGatedPageTitle();
  return (
    <AuthGate>
      <OperatorScreen />
    </AuthGate>
  );
}
