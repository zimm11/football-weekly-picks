import { View, type ViewProps } from "react-native";

/**
 * See GestureRoot.tsx. In a browser it is a plain view: nothing on the web uses gesture-handler, whose own web
 * root renders the same View. Add gesture-handler back here before using one of its gestures on the web.
 */
export function GestureRoot(props: ViewProps) {
  return <View {...props} />;
}
