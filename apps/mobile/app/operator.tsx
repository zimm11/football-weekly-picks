import { AuthGate } from "../src/screens/AuthScreen";
import { OperatorScreen } from "../src/screens/OperatorScreen";
export default function Page() {
  return (
    <AuthGate>
      <OperatorScreen />
    </AuthGate>
  );
}
