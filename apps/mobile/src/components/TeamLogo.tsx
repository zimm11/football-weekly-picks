import { teamLogoUrl } from "@picks/shared";
import { useState } from "react";
import { Image, View } from "react-native";
export function TeamLogo({ team, abbr, size = 32 }: { team?: string; abbr?: string; size?: number }) {
  const value = team ?? abbr ?? "";
  const uri = teamLogoUrl(value, size);
  const [failed, setFailed] = useState<string>();
  return failed === uri ? (
    <View style={{ width: size, height: size }} />
  ) : (
    <Image
      accessible={false}
      aria-hidden
      source={{ uri }}
      style={{ width: size, height: size, resizeMode: "contain" }}
      onError={() => setFailed(uri)}
    />
  );
}
