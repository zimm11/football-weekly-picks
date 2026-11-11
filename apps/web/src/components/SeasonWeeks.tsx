import { MAX_WEEK, nextWeekNumber, WEEK_PHASE_LABEL, type WeekSummary, weekLabel } from "@picks/shared";
import { type FormEvent, useState } from "react";
import { Link } from "../router";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Card } from "./ui/card";
import { Field, NativeSelect } from "./ui/input";

/** One season's bounded week choices. Selecting an existing week opens management instead of creating it. */
export function SeasonWeeks({
  year,
  weeks,
  busy,
  onCreate,
}: {
  year: number;
  weeks: WeekSummary[];
  busy: boolean;
  onCreate: (number: number, importGames: boolean) => Promise<void>;
}) {
  const next = nextWeekNumber(weeks, MAX_WEEK);
  const [number, setNumber] = useState(
    next ?? weeks.find((week) => week.status !== "final")?.number ?? MAX_WEEK,
  );
  const existing = weeks.find((week) => week.number === number);
  const finalCount = weeks.filter((week) => week.status === "final").length;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!existing) await onCreate(number, new FormData(event.currentTarget).get("importGames") === "on");
  }

  return (
    <Card aria-label="Weeks">
      <div className="grid gap-1">
        <h3 className="text-2xl">{year} season weeks</h3>
        <p className="m-0 text-sm text-muted-foreground">
          {weeks.length} of {MAX_WEEK} weeks prepared · {finalCount} final. Regular season only.
        </p>
      </div>
      {next === null && (
        <p className="m-0 border-l-4 border-primary pl-3 text-sm">
          {finalCount === MAX_WEEK
            ? "Season complete. All 18 weeks are final. Choose Start a new season in the season selector when you're ready."
            : "All 18 weeks are prepared. Manage an existing week below; finalize the remaining weeks to finish the season."}
        </p>
      )}
      <form onSubmit={submit} className="grid gap-3">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Week">
            <NativeSelect
              name="number"
              value={number}
              disabled={busy}
              onChange={(event) => setNumber(Number(event.target.value))}
            >
              {Array.from({ length: MAX_WEEK }, (_, index) => index + 1).map((value) => {
                const week = weeks.find((item) => item.number === value);
                return (
                  <option key={value} value={value}>
                    {weekLabel(value)} · {week ? WEEK_PHASE_LABEL[week.phase] : "Not created"}
                  </option>
                );
              })}
            </NativeSelect>
          </Field>
          {existing ? (
            <Link to={`/weeks/${existing.id}/manage`} className={buttonVariants()}>
              Manage week
            </Link>
          ) : (
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create week"}
            </Button>
          )}
        </div>
        {!existing && (
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              name="importGames"
              type="checkbox"
              defaultChecked
              disabled={busy}
              className="size-5 accent-primary"
            />
            Import games and spreads from ESPN
          </label>
        )}
      </form>
      {weeks.length > 0 && (
        <ul className="m-0 grid list-none p-0">
          {[...weeks]
            .sort((a, b) => b.number - a.number)
            .map((week) => (
              <li key={week.id} className="border-t">
                <Link
                  to={`/weeks/${week.id}/manage`}
                  aria-label={`Manage ${weekLabel(week.number)}`}
                  className="flex min-h-14 items-center justify-between gap-3 text-foreground no-underline hover:text-primary"
                >
                  <span className="shrink-0 font-display text-xl font-bold uppercase">
                    {weekLabel(week.number)}
                  </span>
                  <Badge variant={week.status === "open" ? "default" : "outline"}>
                    {WEEK_PHASE_LABEL[week.phase]}
                  </Badge>
                </Link>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
