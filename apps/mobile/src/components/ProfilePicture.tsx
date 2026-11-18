// biome-ignore-all lint/correctness/noReactNativeRawText: Body and SettingsHeading render native Text.
import { useState } from "react";
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { messageOf } from "../lib/api";
import { notifyDone } from "../lib/notify";
import { logoById, logoCollections } from "../lib/profileLogos";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";
import { hoverFill, pressFade } from "./pressState";
import { SettingsHeading } from "./SettingsHeading";
import { Body, Button, Card, colors, ErrorMessage, fonts, Sheet } from "./ui";

export function ProfilePicture({
  name,
  avatarId,
  onSave,
}: {
  name: string;
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
      <SettingsHeading>Profile picture</SettingsHeading>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <Avatar name={name} avatarId={avatarId} size={60} />
        <View style={{ flex: 1 }}>
          <Body style={{ fontFamily: fonts.semibold }}>{name}</Body>
          <Body muted>{current?.name ?? "Your initials"}</Body>
        </View>
      </View>
      <Button
        title="Change picture"
        variant="outline"
        onPress={() => {
          setCollection(current?.collection ?? "Gridiron");
          setError(undefined);
          setOpen(true);
        }}
      />
      <Sheet
        visible={open}
        title="Choose a profile picture"
        onClose={() => {
          if (!busy) setOpen(false);
        }}
      >
        {busy && <Body muted>Saving picture…</Body>}
        <ErrorMessage message={error} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {logoCollections.map(({ name: group }) => {
            const active = collection === group;
            return (
              <Pressable
                key={group}
                accessibilityRole="button"
                aria-pressed={active}
                accessibilityState={{ selected: active }}
                onPress={() => setCollection(group)}
                style={(state) => ({
                  minHeight: 44,
                  justifyContent: "center",
                  paddingHorizontal: 14,
                  borderRadius: 22,
                  backgroundColor: active
                    ? colors.primary
                    : hoverFill(state, colors.raised, colors.raisedHover),
                })}
              >
                <Text
                  style={{
                    fontFamily: fonts.semibold,
                    color: active ? colors.primaryForeground : colors.foreground,
                  }}
                >
                  {group}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 8 }}>
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
                  width: width < 520 ? "25%" : "20%",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 2,
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
                <Text
                  style={{
                    fontFamily: fonts.medium,
                    fontSize: 13,
                    textAlign: "center",
                    color: colors.foreground,
                  }}
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
