import { Redirect } from "expo-router";
import { Splash } from "../../src/components/Splash";
import { useAuth } from "../../src/lib/auth";

/**
 * Where a sign-up confirmation link lands. The auth layer verifies the link and moves on to where it was going
 * (lib/auth.tsx); until then this is the splash, so the home page doesn't flash first. A visit with nothing to
 * verify goes home.
 */
export default function Callback() {
  const auth = useAuth();
  if (auth.loading) return <Splash />;
  return <Redirect href="/" />;
}
