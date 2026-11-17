import { AuthGate } from "../src/screens/AuthScreen";
import { FeedbackScreen } from "../src/screens/FeedbackScreen";
export default function Page() {
  return (
    <AuthGate>
      <FeedbackScreen />
    </AuthGate>
  );
}
