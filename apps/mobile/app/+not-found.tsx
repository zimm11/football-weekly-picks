import { useRouter } from "expo-router";
import { Button, Screen, Title } from "../src/components/ui";
export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <Title>Page not found</Title>
      <Button link title="Your leagues" onPress={() => router.replace("/")} />
    </Screen>
  );
}
