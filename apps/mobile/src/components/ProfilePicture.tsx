// biome-ignore-all lint/correctness/noReactNativeRawText: Body and SettingsHeading render native Text.
import { type ComponentRef, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { messageOf } from "../lib/api";
import { notifyDone } from "../lib/notify";
import { logoById, logoCollections } from "../lib/profileLogos";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { hoverFill, pressFade } from "./pressState";
import { SettingsHeading } from "./SettingsHeading";
import { radius, space, type } from "./theme";
import { Body, Button, Card, colors, ErrorMessage, fonts, Sheet } from "./ui";

/** The bottom sheet's side padding (BottomSheet's content), which the collections row runs through to the edges. */
const SHEET_PAD = space["2xl"];

export function ProfilePicture({
  avatarId,
  onSave,
}: {
  avatarId: number | null;
  onSave: (id: number | null) => Promise<void>;
}) {
  const current = avatarId === null ? undefined : logoById.get(avatarId);
  const [open, setOpen] = useState(false);
  const [collection, setCollection] = useState("Gridiron");
  const visibleLogos = logoCollections.find((group) => group.name === collection)?.logos;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const { width } = useWindowDimensions();
  // Four across on a phone, five on a wider bottom sheet, six in the centered dialog (from 768px).
  const columns = width < 520 ? 4 : width < 768 ? 5 : 6;
  const chips = useRef<ComponentRef<typeof ScrollView>>(null);
  const [chipAt, setChipAt] = useState<Record<string, number>>({});
  const chosenAt = chipAt[collection];
  // The chosen collection's chip in view when the sheet opens on it (Wildcards sits past a phone's edge).
  useEffect(() => {
    if (open && chosenAt !== undefined)
      chips.current?.scrollTo({ x: Math.max(0, chosenAt - SHEET_PAD), animated: false });
  }, [open, chosenAt]);

  async function choose(id: number | null) {
    if (busy) return;
    if (id === avatarId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSave(id);
      setOpen(false);
      notifyDone("Profile picture updated.");
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {/* The button drops under the title where both don't fit on one line (a 320px phone). */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.lg }}>
        <View style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160, gap: space.xxs }}>
          <SettingsHeading>Profile picture</SettingsHeading>
          <Body muted style={type.small}>
            {current?.name ?? "Your initials"}
          </Body>
        </View>
        <Button
          title="Change picture"
          variant="outline"
          fit
          onPress={() => {
            setCollection(current?.collection ?? "Gridiron");
            setError(undefined);
            setOpen(true);
          }}
        />
      </View>
      <Sheet
        visible={open}
        title="Choose a profile picture"
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        {busy && <Body muted>Saving picture…</Body>}
        <ErrorMessage message={error} />
        {/* One row of collections, scrolling sideways when it doesn't fit, edge to edge of the sheet. */}
        <ScrollView
          ref={chips}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginHorizontal: -SHEET_PAD }}
          contentContainerStyle={{ paddingHorizontal: SHEET_PAD, gap: space.sm }}
        >
          {logoCollections.map(({ name: group }) => {
            const active = collection === group;
            return (
              <Pressable
                key={group}
                accessibilityRole="button"
                aria-pressed={active}
                accessibilityState={{ selected: active }}
                onPress={() => setCollection(group)}
                onLayout={(event) => {
                  const x = event.nativeEvent.layout.x;
                  setChipAt((old) => (old[group] === x ? old : { ...old, [group]: x }));
                }}
                style={(state) => ({
                  height: 40,
                  justifyContent: "center",
                  paddingHorizontal: space.lg + space.xxs,
                  borderRadius: radius.full,
                  backgroundColor: active
                    ? colors.primary
                    : hoverFill(state, colors.raised, colors.raisedHover),
                })}
              >
                <Text
                  style={[
                    type.small,
                    {
                      fontFamily: fonts.semibold,
                      color: active ? colors.primaryForeground : colors.foreground,
                    },
                  ]}
                >
                  {group}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: space.lg }}>
          {visibleLogos?.map((logo) => {
            const selected = avatarId === logo.id;
            return (
              <Pressable
                key={logo.id}
                accessibilityRole="button"
                accessibilityLabel={logo.name}
                aria-pressed={selected}
                accessibilityState={{ selected, disabled: busy }}
                disabled={busy}
                onPress={() => void choose(logo.id)}
                style={(state) => ({
                  width: `${100 / columns}%`,
                  alignItems: "center",
                  gap: space.xs,
                  paddingHorizontal: space.xxs,
                  ...pressFade(state),
                })}
              >
                <View
                  style={{
                    borderRadius: 40,
                    padding: 2,
                    borderWidth: 2,
                    borderColor: selected ? colors.primary : "transparent",
                  }}
                >
                  <Avatar name={logo.name} avatarId={logo.id} size={width < 520 ? 54 : 64} />
                  {selected && (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 0,
                        right: 0,
                        borderRadius: 9,
                        backgroundColor: colors.primary,
                        padding: 2,
                      }}
                    >
                      <Icon name="check" size={14} color={colors.primaryForeground} />
                    </View>
                  )}
                </View>
                {/* Two lines are kept for every name, so the grid's rows line up. */}
                <Text
                  numberOfLines={2}
                  style={[
                    type.caption,
                    {
                      minHeight: type.caption.lineHeight * 2,
                      fontFamily: fonts.medium,
                      textAlign: "center",
                      color: colors.foreground,
                    },
                  ]}
                >
                  {logo.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Button title="Use my initials" variant="outline" disabled={busy} onPress={() => void choose(null)} />
      </Sheet>
    </Card>
  );
}
