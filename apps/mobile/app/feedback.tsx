import { useGatedPageTitle } from "../src/lib/gatedTitle";
import { AuthGate } from "../src/screens/AuthScreen";
import { FeedbackScreen } from "../src/screens/FeedbackScreen";
export default function Page() {
  useGatedPageTitle("Feedback");
  return (
    <AuthGate>
      <FeedbackScreen />
    </AuthGate>
  );
}
