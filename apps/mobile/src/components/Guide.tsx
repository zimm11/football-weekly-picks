import { type ReactNode, useState } from "react";
import { Pressable, type StyleProp, Text, type TextStyle, View } from "react-native";
import { duration, webTransition } from "../lib/motion";
import { FadeIn } from "./FadeIn";
import { Icon, type IconName } from "./Icon";
import { hoverFill } from "./pressState";
import { colors, corner, layout, radius, space, tabular, type } from "./theme";
import { Body, Card, Title } from "./ui";

/*
 * The pieces of How to play (app/how-to-play.tsx and each game's HowToPlay<Type>.tsx), so the four tabs read
 * alike: a section heading, titled items in a card, numbered steps, and a small footnote.
 */

/** A section of the guide: its icon and a level-2 title on the page background. */
export function GuideHeading({ title, icon }: { title: string; icon: IconName }) {
  return (
    <View style={{ flexDirection: "row", gap: space.md, alignItems: "center" }}>
      <Icon name={icon} size={24} color={colors.primary} />
      <Title level={2} size="heading">
        {title}
      </Title>
    </View>
  );
}

/** A titled part of a section: a level-3 heading in the card-title style, then its text. */
export function GuideItem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <GuideTitle>{title}</GuideTitle>
      {typeof children === "string" ? <Body muted>{children}</Body> : children}
    </View>
  );
}

/** A level-3 heading in the card-title style (the title of a card or of an item in one). */
export function GuideTitle({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <Text
      accessibilityRole="header"
      aria-level={3}
      style={[type.cardTitle, { color: colors.foreground }, style]}
    >
      {children}
    </Text>
  );
}

/** A footnote under a rule: small muted text. */
export function GuideNote({ children }: { children: ReactNode }) {
  return <Body style={[type.small, { color: colors.mutedForeground }]}>{children}</Body>;
}

/** Items in one card, a hairline between each. */
export function GuideList({ items }: { items: [title: string, detail: string][] }) {
  return (
    <Card>
      {items.map(([title, detail], index) => (
        <View key={title} style={index ? divided : undefined}>
          <GuideItem title={title}>{detail}</GuideItem>
        </View>
      ))}
    </Card>
  );
}

const divided = {
  paddingTop: layout.cardGap,
  borderTopWidth: 1,
  borderTopColor: colors.border,
};

/**
 * Numbered steps in one card. `collapsible` keeps each step's number and title in view and folds its detail
 * away: each title is a level-3 heading holding one button (named for the step, with its expanded state) that
 * spans the row and toggles the detail under it. Steps open independently.
 */
export function GuideSteps({ items, collapsible = false }: { items: string[][]; collapsible?: boolean }) {
  return (
    <Card style={collapsible && { gap: 0, paddingVertical: space.md }}>
      {items.map(([title = "", detail = ""], index) => (
        <Step
          key={title}
          number={index + 1}
          title={title}
          detail={detail}
          first={index === 0}
          collapsible={collapsible}
        />
      ))}
    </Card>
  );
}

function Step({
  number,
  title,
  detail,
  first,
  collapsible,
}: {
  number: number;
  title: string;
  detail: string;
  first: boolean;
  collapsible: boolean;
}) {
  const [open, setOpen] = useState(!collapsible);
  const disc = (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: radius.full,
        backgroundColor: colors.primaryTint,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={[type.statSmall, tabular, { color: colors.primaryText }]}>{number}</Text>
    </View>
  );
  if (!collapsible)
    return (
      <View style={[{ flexDirection: "row", gap: space.lg }, !first && { ...divided, paddingTop: space.xl }]}>
        {disc}
        <View style={{ flex: 1, gap: space.xs, paddingTop: space.xs }}>
          <GuideTitle>{title}</GuideTitle>
          <Body muted>{detail}</Body>
        </View>
      </View>
    );
  return (
    <View style={!first && { borderTopWidth: 1, borderTopColor: colors.border }}>
      {/*
       * An accordion: the heading holds one button spanning the row (a heading's children keep their roles, a
       * button's don't), so the title is a level-3 heading open or closed and the whole row toggles.
       */}
      <View role="heading" aria-level={3}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
          // react-native-web reads only the aria-* form.
          aria-expanded={open}
          onPress={() => setOpen(!open)}
          style={(state) => [
            webTransition(["background-color"]),
            {
              minHeight: 48,
              flexDirection: "row",
              alignItems: "center",
              gap: space.lg,
              marginHorizontal: -space.md,
              paddingHorizontal: space.md,
              paddingVertical: space.md,
              ...corner(radius.md),
              backgroundColor: hoverFill(state),
            },
          ]}
        >
          <View aria-hidden>{disc}</View>
          <Text style={[type.cardTitle, { flex: 1, color: colors.foreground }]}>{title}</Text>
          <View
            style={[
              webTransition(["transform"], duration.base),
              { transform: [{ rotate: open ? "180deg" : "0deg" }] },
            ]}
          >
            <Icon name="chevron-down" size={16} color={colors.mutedForeground} />
          </View>
        </Pressable>
      </View>
      {open && (
        // Under the title, from its left edge (past the number).
        <FadeIn from={-4} style={{ paddingLeft: 32 + space.lg, paddingBottom: space.lg }}>
          <Body muted>{detail}</Body>
        </FadeIn>
      )}
    </View>
  );
}
