// biome-ignore-all lint/correctness/noReactNativeRawText: SettingsHeading renders its children inside native Text.
import { NativeDeviceControls } from "./NativeDeviceControls";
import { SettingsHeading } from "./SettingsHeading";
import { Body, Card } from "./ui";

/** Settings → On this device in the iPhone and Android app: Expo push. The browser build has its own (`.web`). */
export function DeviceNotifications() {
  return (
    <Card>
      <SettingsHeading level={3}>On this device</SettingsHeading>
      <Body muted>
        New threads, missing-pick reminders, and results and updates as notifications. They can show league
        names and thread titles on your lock screen.
      </Body>
      <NativeDeviceControls />
    </Card>
  );
}
