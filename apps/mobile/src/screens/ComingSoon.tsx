// biome-ignore-all lint/correctness/noReactNativeRawText: Heading and Label render native Text.
import { Card, Heading, Label } from "./leagueUi";

/** A placeholder for a league type's screen that isn't built yet. Only operators can create those leagues. */
export function ComingSoon({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <Heading>{title}</Heading>
      <Label>{detail ?? "This part of the league is still being built."}</Label>
    </Card>
  );
}
