/**
 * The app's root view for gestures. On a phone it is react-native-gesture-handler's root, which native screens
 * need for their gestures. The web build uses GestureRoot.web.tsx instead, so the browser bundle leaves out
 * gesture-handler and the Reanimated runtime it brings with it (about 0.9 MB of script the web never uses).
 */
export { GestureHandlerRootView as GestureRoot } from "react-native-gesture-handler";
