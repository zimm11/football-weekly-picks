import { type Href, Redirect, useLocalSearchParams } from "expo-router";
import { nextPath } from "../src/lib/links";
import { usePageTitle } from "../src/lib/pageTitle";
import { AuthGate } from "../src/screens/AuthScreen";

/** The sign-in form. `?next=` (an allowlisted in-app path, `nextPath`) is where signing in returns to. */
export default function Login() {
  usePageTitle("Sign in");
  const { next } = useLocalSearchParams<{ next?: string }>();
  return (
    <AuthGate>
      <Redirect href={(nextPath(next) ?? "/") as Href} />
    </AuthGate>
  );
}
