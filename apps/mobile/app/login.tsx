import { Redirect } from "expo-router";
import { AuthGate } from "../src/screens/AuthScreen";
export default function Login() {
  return (
    <AuthGate>
      <Redirect href="/" />
    </AuthGate>
  );
}
