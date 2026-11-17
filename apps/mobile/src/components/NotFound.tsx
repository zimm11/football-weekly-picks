import { router } from "expo-router";
import { Button, Screen, Title } from "./ui";

/** The not-found screen: for an unknown path, and for a league tab its type doesn't have. */
export function NotFound() {
  return (
    <Screen>
      <Title>Page not found</Title>
      <Button link title="Your leagues" onPress={() => router.replace("/")} />
    </Screen>
  );
}
