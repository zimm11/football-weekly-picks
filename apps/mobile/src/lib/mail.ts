import { Linking, Platform } from "react-native";
import { notifyError } from "./notify";

/**
 * Props that make a Pressable open an email to `address`. On the web it is a real `mailto:` link the browser
 * hands to the mail app (no new tab). On iPhone it asks the system, and says where to write when no mail app
 * can take it (none set up, or Mail removed).
 */
export function mailtoProps(address: string): { onPress?: () => void } {
  const url = `mailto:${address}`;
  if (Platform.OS === "web") return { href: url } as { onPress?: () => void };
  return {
    onPress: () => {
      Linking.openURL(url).catch(() => notifyError(`Couldn't open an email app. Write to ${address}.`));
    },
  };
}
