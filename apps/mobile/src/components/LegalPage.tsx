import { SUPPORT_EMAIL } from "@picks/shared";
import type { Href } from "expo-router";
import { Linking, Pressable, Text, View } from "react-native";
import { openScreen } from "../lib/navigation";
import { BackLink } from "./BackLink";
import { Icon } from "./Icon";
import { Body, Card, colors, Eyebrow, fonts, Screen, styles, Title } from "./ui";

/** A paragraph, or a bulleted list. */
export type LegalBlock = string | string[];
export type LegalSection = [heading: string, blocks: LegalBlock[]];

/**
 * The Terms of use and the Privacy policy: a dated page of headed sections, then where to write to and a link to
 * the other page. Both work signed out, and the App Store listing links to them.
 */
export function LegalPage({
  title,
  updated,
  sections,
  other,
}: {
  title: string;
  /** The date the text last changed, as shown, e.g. "November 17, 2026". Change it with the text. */
  updated: string;
  sections: LegalSection[];
  other: { label: string; href: Href };
}) {
  return (
    <Screen narrow>
      <BackLink />
      <View style={{ gap: 4 }}>
        <Title>{title}</Title>
        <Eyebrow>Last updated {updated}</Eyebrow>
      </View>
      <Card>
        {sections.map(([heading, blocks], index) => (
          <View
            key={heading}
            style={{
              gap: 8,
              paddingTop: index ? 16 : 0,
              borderTopWidth: index ? 1 : 0,
              borderTopColor: colors.border,
            }}
          >
            <Text
              accessibilityRole="header"
              aria-level={2}
              style={{ fontFamily: fonts.semibold, fontSize: 18, lineHeight: 26, color: colors.foreground }}
            >
              {heading}
            </Text>
            {blocks.map((block) =>
              typeof block === "string" ? (
                <Body key={block} muted>
                  {block}
                </Body>
              ) : (
                <View key={block[0]} role="list" style={{ gap: 6 }}>
                  {block.map((item) => (
                    <View key={item} role="listitem" style={{ flexDirection: "row", gap: 10 }}>
                      <Text aria-hidden style={[styles.body, styles.muted]}>
                        •
                      </Text>
                      <Body muted style={{ flex: 1 }}>
                        {item}
                      </Body>
                    </View>
                  ))}
                </View>
              ),
            )}
          </View>
        ))}
      </Card>
      <Card>
        <Body>Questions, or something we should know about?</Body>
        <LegalLink
          icon="email"
          label={SUPPORT_EMAIL}
          onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
        />
        <LegalLink icon="document" label={other.label} onPress={() => void openScreen(other.href)} />
      </Card>
    </Screen>
  );
}

function LegalLink({
  icon,
  label,
  onPress,
}: {
  icon: "email" | "document";
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={onPress}
      style={{ minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      <Icon name={icon} size={18} color={colors.primary} />
      <Text style={{ fontFamily: fonts.medium, fontSize: 16, color: colors.primary }}>{label}</Text>
    </Pressable>
  );
}
