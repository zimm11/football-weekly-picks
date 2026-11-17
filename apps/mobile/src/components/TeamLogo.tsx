// A team's badge: the app's own drawing in the team's colors, never the team's logo (see lib/teamBadges.ts).
// Each Phosphor glyph is imported from its own file, as in Icon.tsx.
import type { Icon as PhosphorIcon } from "phosphor-react-native";
import { AirplaneTiltIcon } from "phosphor-react-native/src/icons/AirplaneTilt";
import { AnchorIcon } from "phosphor-react-native/src/icons/Anchor";
import { AxeIcon } from "phosphor-react-native/src/icons/Axe";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { BirdIcon } from "phosphor-react-native/src/icons/Bird";
import { BuildingsIcon } from "phosphor-react-native/src/icons/Buildings";
import { CactusIcon } from "phosphor-react-native/src/icons/Cactus";
import { CatIcon } from "phosphor-react-native/src/icons/Cat";
import { CheeseIcon } from "phosphor-react-native/src/icons/Cheese";
import { CowIcon } from "phosphor-react-native/src/icons/Cow";
import { CowboyHatIcon } from "phosphor-react-native/src/icons/CowboyHat";
import { CrownIcon } from "phosphor-react-native/src/icons/Crown";
import { DogIcon } from "phosphor-react-native/src/icons/Dog";
import { FeatherIcon } from "phosphor-react-native/src/icons/Feather";
import { FlagIcon } from "phosphor-react-native/src/icons/Flag";
import { FlameIcon } from "phosphor-react-native/src/icons/Flame";
import { FootballIcon } from "phosphor-react-native/src/icons/Football";
import { HammerIcon } from "phosphor-react-native/src/icons/Hammer";
import { HorseIcon } from "phosphor-react-native/src/icons/Horse";
import { LightningIcon } from "phosphor-react-native/src/icons/Lightning";
import { MedalMilitaryIcon } from "phosphor-react-native/src/icons/MedalMilitary";
import { MountainsIcon } from "phosphor-react-native/src/icons/Mountains";
import { MusicNotesIcon } from "phosphor-react-native/src/icons/MusicNotes";
import { PawPrintIcon } from "phosphor-react-native/src/icons/PawPrint";
import { SkullIcon } from "phosphor-react-native/src/icons/Skull";
import { SnowflakeIcon } from "phosphor-react-native/src/icons/Snowflake";
import { SpiralIcon } from "phosphor-react-native/src/icons/Spiral";
import { SwordIcon } from "phosphor-react-native/src/icons/Sword";
import { TreePalmIcon } from "phosphor-react-native/src/icons/TreePalm";
import type { ReactElement } from "react";
import { View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { type TeamGlyph, teamBadge } from "../lib/teamBadges";
import { colors } from "./theme";

type Glyph = (props: { size: number; color: string }) => ReactElement;

const solid =
  (Icon: PhosphorIcon): Glyph =>
  ({ size, color }) => <Icon size={size} color={color} weight="fill" />;

/** Three claw marks, drawn on Phosphor's 256 grid. */
const Claws: Glyph = ({ size, color }) => (
  <Svg width={size} height={size} viewBox="0 0 256 256">
    {[80, 138, 196].map((x) => (
      <Path
        key={x}
        fill={color}
        d={`M${x + 22} 30Q${x + 36} 142 ${x - 52} 226Q${x - 40} 112 ${x + 22} 30Z`}
      />
    ))}
  </Svg>
);

/** A miner's pickaxe: a curved head and a round-ended handle. */
const Pickaxe: Glyph = ({ size, color }) => (
  <Svg width={size} height={size} viewBox="0 0 256 256">
    <Path fill={color} d="M58.7 36.1Q225.6 30.4 219.9 197.3Q167.6 88.4 58.7 36.1Z" />
    <Path fill="none" stroke={color} strokeWidth={30} strokeLinecap="round" d="M168.3 87.7L59.4 196.6" />
  </Svg>
);

const GLYPHS: Record<TeamGlyph, Glyph> = {
  airplane: solid(AirplaneTiltIcon),
  anchor: solid(AnchorIcon),
  axe: solid(AxeIcon),
  bell: solid(BellIcon),
  bird: solid(BirdIcon),
  buildings: solid(BuildingsIcon),
  bull: solid(CowIcon),
  cactus: solid(CactusIcon),
  cat: solid(CatIcon),
  cheese: solid(CheeseIcon),
  claws: Claws,
  "cowboy-hat": solid(CowboyHatIcon),
  crown: solid(CrownIcon),
  dog: solid(DogIcon),
  feather: solid(FeatherIcon),
  flag: solid(FlagIcon),
  flame: solid(FlameIcon),
  hammer: solid(HammerIcon),
  horse: solid(HorseIcon),
  lightning: solid(LightningIcon),
  medal: solid(MedalMilitaryIcon),
  mountains: solid(MountainsIcon),
  music: solid(MusicNotesIcon),
  palm: solid(TreePalmIcon),
  paw: solid(PawPrintIcon),
  pickaxe: Pickaxe,
  skull: solid(SkullIcon),
  snowflake: solid(SnowflakeIcon),
  spiral: solid(SpiralIcon),
  sword: solid(SwordIcon),
};

/** A side that isn't one of the 32 teams gets a plain football. */
const Unknown = solid(FootballIcon);

/** Decorative: always show the team's name or abbreviation beside it. */
export function TeamLogo({ team, abbr, size = 32 }: { team?: string; abbr?: string; size?: number }) {
  const badge = teamBadge(team ?? abbr ?? "");
  const Mark = badge ? GLYPHS[badge.glyph] : Unknown;
  return (
    <View
      accessible={false}
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: badge?.fill ?? colors.raised,
        borderWidth: badge?.ring ? Math.max(1.5, size * 0.07) : 0,
        borderColor: badge?.ring,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Mark size={size * 0.6} color={badge?.color ?? colors.mutedForeground} />
    </View>
  );
}
