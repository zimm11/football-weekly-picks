import { useAuth } from "./auth";
import { usePageTitle } from "./pageTitle";

/**
 * The browser tab's title for a page behind sign-in (a route wrapped in `AuthGate`), called from the route
 * file: "Sign in" while the sign-in form stands in for the page, `title` once the player is in. Leave `title`
 * out when the screen names itself with `usePageTitle` (a league, a week, a thread): this then only covers the
 * signed-out case. While the session is loading, or the player is choosing a display name, it asks for nothing.
 */
export function useGatedPageTitle(title?: string) {
  const auth = useAuth();
  const settled = !auth.loading && !auth.error;
  usePageTitle(
    !settled ? undefined : !auth.session ? "Sign in" : auth.me?.displayName ? title : "Choose your name",
  );
}
