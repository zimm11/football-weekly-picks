// The app's icon set (Phosphor), the same glyphs on iPhone and the web. Each icon is imported from its
// own file: Metro bundles everything a module imports, and the package root re-exports ~1,500 icons.
import type { IconWeight, Icon as PhosphorIcon } from "phosphor-react-native";
import { ArrowBendUpLeftIcon } from "phosphor-react-native/src/icons/ArrowBendUpLeft";
import { ArrowCounterClockwiseIcon } from "phosphor-react-native/src/icons/ArrowCounterClockwise";
import { ArrowSquareOutIcon } from "phosphor-react-native/src/icons/ArrowSquareOut";
import { ArrowsClockwiseIcon } from "phosphor-react-native/src/icons/ArrowsClockwise";
import { BellIcon } from "phosphor-react-native/src/icons/Bell";
import { CaretDownIcon } from "phosphor-react-native/src/icons/CaretDown";
import { CaretLeftIcon } from "phosphor-react-native/src/icons/CaretLeft";
import { CaretRightIcon } from "phosphor-react-native/src/icons/CaretRight";
import { ChartBarIcon } from "phosphor-react-native/src/icons/ChartBar";
import { ChatCircleIcon } from "phosphor-react-native/src/icons/ChatCircle";
import { CheckIcon } from "phosphor-react-native/src/icons/Check";
import { CheckCircleIcon } from "phosphor-react-native/src/icons/CheckCircle";
import { CopyIcon } from "phosphor-react-native/src/icons/Copy";
import { DotsThreeIcon } from "phosphor-react-native/src/icons/DotsThree";
import { EnvelopeSimpleIcon } from "phosphor-react-native/src/icons/EnvelopeSimple";
import { EqualsIcon } from "phosphor-react-native/src/icons/Equals";
import { EyeIcon } from "phosphor-react-native/src/icons/Eye";
import { FileTextIcon } from "phosphor-react-native/src/icons/FileText";
import { FlagIcon } from "phosphor-react-native/src/icons/Flag";
import { FootballIcon } from "phosphor-react-native/src/icons/Football";
import { GearIcon } from "phosphor-react-native/src/icons/Gear";
import { InfoIcon } from "phosphor-react-native/src/icons/Info";
import { ListChecksIcon } from "phosphor-react-native/src/icons/ListChecks";
import { LockIcon } from "phosphor-react-native/src/icons/Lock";
import { PaperPlaneRightIcon } from "phosphor-react-native/src/icons/PaperPlaneRight";
import { PawPrintIcon } from "phosphor-react-native/src/icons/PawPrint";
import { PencilSimpleLineIcon } from "phosphor-react-native/src/icons/PencilSimpleLine";
import { PlusIcon } from "phosphor-react-native/src/icons/Plus";
import { ProhibitIcon } from "phosphor-react-native/src/icons/Prohibit";
import { PushPinIcon } from "phosphor-react-native/src/icons/PushPin";
import { QuotesIcon } from "phosphor-react-native/src/icons/Quotes";
import { ShareNetworkIcon } from "phosphor-react-native/src/icons/ShareNetwork";
import { ShieldIcon } from "phosphor-react-native/src/icons/Shield";
import { SignOutIcon } from "phosphor-react-native/src/icons/SignOut";
import { SmileyIcon } from "phosphor-react-native/src/icons/Smiley";
import { SmileyXEyesIcon } from "phosphor-react-native/src/icons/SmileyXEyes";
import { SpeakerSlashIcon } from "phosphor-react-native/src/icons/SpeakerSlash";
import { StarIcon } from "phosphor-react-native/src/icons/Star";
import { TargetIcon } from "phosphor-react-native/src/icons/Target";
import { TrashIcon } from "phosphor-react-native/src/icons/Trash";
import { TrophyIcon } from "phosphor-react-native/src/icons/Trophy";
import { UserMinusIcon } from "phosphor-react-native/src/icons/UserMinus";
import { UsersThreeIcon } from "phosphor-react-native/src/icons/UsersThree";
import { WarningCircleIcon } from "phosphor-react-native/src/icons/WarningCircle";
import { XIcon } from "phosphor-react-native/src/icons/X";
import { colors } from "./theme";

/** Each name maps to one Phosphor icon and the weight it usually takes. */
const ICONS = {
  football: [FootballIcon],
  bell: [BellIcon],
  check: [CheckIcon],
  "check-circle": [CheckCircleIcon, "fill"],
  "chevron-right": [CaretRightIcon],
  "chevron-down": [CaretDownIcon],
  "arrow-left": [CaretLeftIcon, "bold"],
  lock: [LockIcon],
  star: [StarIcon],
  trophy: [TrophyIcon],
  chat: [ChatCircleIcon],
  users: [UsersThreeIcon],
  list: [ListChecksIcon],
  more: [DotsThreeIcon, "bold"],
  close: [XIcon],
  warning: [WarningCircleIcon],
  pencil: [PencilSimpleLineIcon, "fill"],
  refresh: [ArrowsClockwiseIcon],
  plus: [PlusIcon],
  settings: [GearIcon],
  "sign-out": [SignOutIcon],
  chart: [ChartBarIcon],
  equals: [EqualsIcon, "bold"],
  share: [ShareNetworkIcon],
  external: [ArrowSquareOutIcon],
  copy: [CopyIcon],
  pin: [PushPinIcon],
  quote: [QuotesIcon],
  smile: [SmileyIcon],
  send: [PaperPlaneRightIcon],
  trash: [TrashIcon],
  info: [InfoIcon],
  target: [TargetIcon],
  paw: [PawPrintIcon],
  "smiley-x": [SmileyXEyesIcon],
  reply: [ArrowBendUpLeftIcon],
  shield: [ShieldIcon],
  "user-minus": [UserMinusIcon],
  flag: [FlagIcon],
  block: [ProhibitIcon],
  mute: [SpeakerSlashIcon],
  restore: [ArrowCounterClockwiseIcon],
  email: [EnvelopeSimpleIcon],
  eye: [EyeIcon],
  document: [FileTextIcon],
} satisfies Record<string, [PhosphorIcon, IconWeight?]>;

export type IconName = keyof typeof ICONS;

/** Decorative (an unlabeled SVG is skipped by screen readers): always beside text or in a named control. */
export function Icon({
  name,
  size = 20,
  color = colors.foreground,
  filled = false,
  weight,
}: {
  name: IconName;
  size?: number;
  color?: string;
  /** The solid version, as web uses for a selected tab or a winner's trophy. */
  filled?: boolean;
  weight?: IconWeight;
}) {
  const [Glyph, usual = "regular"] = ICONS[name] as [PhosphorIcon, IconWeight?];
  return <Glyph size={size} color={color} weight={weight ?? (filled ? "fill" : usual)} />;
}
