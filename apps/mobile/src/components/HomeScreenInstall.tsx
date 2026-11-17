// biome-ignore-all lint/correctness/noReactNativeRawText: Step renders its children inside native Text.
import { type ReactNode, useEffect, useId, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  claimHomeScreenOffer,
  detectPlatform,
  type HomeScreenPlatform,
  homeScreenHelpAvailable,
  onHomeScreenOffer,
} from "../lib/homeScreen";
import { Icon } from "./Icon";
import { Button, colors, fonts } from "./ui";

const text = { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.mutedForeground };
const note = { ...text, fontSize: 14, lineHeight: 20 };

function Steps({ title, steps }: { title: string; steps: string[] }) {
  return (
    <View style={{ backgroundColor: colors.raised, borderRadius: 16, padding: 16, gap: 12 }}>
      <Text
        role="heading"
        aria-level={4}
        style={{ fontFamily: fonts.medium, fontSize: 18, lineHeight: 24, color: colors.foreground }}
      >
        {title}
      </Text>
      <View role="list" style={{ gap: 12 }}>
        {steps.map((step, index) => (
          <View key={step} role="listitem" style={{ flexDirection: "row", gap: 8 }}>
            <Text style={[text, { minWidth: 16 }]} aria-hidden>
              {index + 1}.
            </Text>
            <Text style={[text, { flex: 1 }]}>{step}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * The install steps. The sheet passes the player's own platform so a phone sees only its steps; elsewhere
 * both show.
 */
export function HomeScreenInstructions({ platform = "other" }: { platform?: HomeScreenPlatform }) {
  const ios = (
    <Steps
      title="iPhone or iPad · Safari"
      steps={[
        "Open www.pow-pickem.com in Safari.",
        "Tap Share (the square with an arrow pointing up), then Add to Home Screen. You may need to scroll down to find it.",
        "Keep Open as Web App on if shown, then tap Add.",
      ]}
    />
  );
  const android = (
    <Steps
      title="Android · Chrome"
      steps={[
        "Open www.pow-pickem.com in Chrome.",
        "Tap the three-dot menu (⋮), then Add to Home screen or Install app.",
        "Follow the prompts to install the app or add the shortcut.",
      ]}
    />
  );
  return (
    <View style={{ gap: 16 }}>
      {platform === "ios" ? (
        ios
      ) : platform === "android" ? (
        android
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
          <View style={{ flexGrow: 1, flexBasis: 240 }}>{ios}</View>
          <View style={{ flexGrow: 1, flexBasis: 240 }}>{android}</View>
        </View>
      )}
      <Text style={note}>
        Open the new POW Pick'em icon to get back to your leagues. You may need to sign in again the first
        time. An internet connection is required.
      </Text>
      <Text style={note}>
        Want pick reminders on your phone? In the app, open Settings from the account menu and tap Enable
        notifications.
      </Text>
      <Text style={note}>
        Can't find the option? If you opened a link inside another app, open this site in Safari or Chrome
        first.
        {platform === "other" && " On a computer, bookmark the site or use your browser's install option."}
      </Text>
    </View>
  );
}

function SheetFrame({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const id = useId();
  // On the web, Modal's own element is the dialog; these name and describe it.
  const dialog = { "aria-label": title, "aria-describedby": `${id}-description` } as object;
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose} {...dialog}>
      <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay }}>
        {/* Tapping outside closes, as the web sheet does; the Close button is the accessible way. */}
        <Pressable
          accessible={false}
          importantForAccessibility="no"
          tabIndex={-1}
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityViewIsModal
          style={{
            maxHeight: "90%",
            width: "100%",
            maxWidth: 672,
            alignSelf: "center",
            backgroundColor: colors.card,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            paddingBottom: Math.max(insets.bottom, 24),
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "flex-start", paddingLeft: 16, paddingTop: 16 }}>
            <View style={{ flex: 1, gap: 6, paddingTop: 6 }}>
              <Text
                role="heading"
                aria-level={2}
                style={{
                  fontFamily: fonts.displayBold,
                  fontSize: 24,
                  lineHeight: 28,
                  color: colors.foreground,
                  textTransform: "uppercase",
                }}
              >
                {title}
              </Text>
              <Text id={`${id}-description`} style={note}>
                {description}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                marginRight: 4,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 10,
                backgroundColor: pressed ? colors.raised : "transparent",
              })}
            >
              <Icon name="close" size={20} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>{children}</ScrollView>
          {footer && <View style={{ paddingHorizontal: 16 }}>{footer}</View>}
        </View>
      </View>
    </Modal>
  );
}

/** The install help as a bottom sheet over the current screen, so unsaved picks underneath stay put. */
export function HomeScreenSheet({
  open,
  onClose,
  platform,
  offer = false,
}: {
  open: boolean;
  onClose: () => void;
  platform: HomeScreenPlatform;
  /** Opened by the app (after saving picks) rather than asked for: says why and offers "Not now". */
  offer?: boolean;
}) {
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title="Add it to your home screen"
      description={
        offer
          ? "Picks saved. Put POW Pick'em on your home screen so next week is one tap away."
          : "Keep POW Pick'em a tap away, with its own icon on your phone."
      }
      footer={offer ? <Button title="Not now" variant="outline" onPress={onClose} /> : undefined}
    >
      <HomeScreenInstructions platform={platform} />
    </SheetFrame>
  );
}

/**
 * The Settings card's sheet: `open` shows the steps for this browser's platform. Not `available` in the native
 * app, the installed web app, or an iPhone browser tab (whose device card already shows the steps).
 */
export function useHomeScreenHelp() {
  const [platform] = useState(() => detectPlatform());
  const [shown, setShown] = useState(false);
  return {
    available: homeScreenHelpAvailable() && platform !== "ios",
    open: () => setShown(true),
    sheet: <HomeScreenSheet open={shown} platform={platform} onClose={() => setShown(false)} />,
  };
}

/**
 * On a phone browser, the first save of picks opens the steps once on its own (`offerHomeScreen`). Mounted
 * once for the whole app; renders nothing in the native app, on a computer, or in the installed web app.
 */
export function HomeScreenOffer() {
  const [platform] = useState(() => detectPlatform());
  const [shown, setShown] = useState(false);
  useEffect(
    () =>
      onHomeScreenOffer(() => {
        if (!homeScreenHelpAvailable() || platform === "other" || !claimHomeScreenOffer()) return;
        setShown(true);
      }),
    [platform],
  );
  if (!shown) return null;
  return <HomeScreenSheet open offer platform={platform} onClose={() => setShown(false)} />;
}
