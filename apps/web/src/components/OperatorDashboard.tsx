// biome-ignore-all lint/a11y/noRedundantRoles: mobile card rows change display, so explicit roles preserve table semantics.
import {
  FEEDBACK_KIND_LABELS,
  type FeedbackItem,
  type FeedbackStatus,
  type GrowthCount,
  type OperatorOverview,
} from "@picks/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatGrid, StatTile } from "./StatTile";

type Props = {
  overview: OperatorOverview;
  feedback: FeedbackItem[];
  /** The report whose status is being saved, if any. */
  savingId?: string;
  busy?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onSetStatus: (id: string, status: FeedbackStatus) => void;
};

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const dayOrDash = (iso: string | null) => (iso ? day(iso) : "—");
/** Week starts are calendar dates (`YYYY-MM-DD`, UTC), so they are shown without shifting to local time. */
const weekLabel = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const growthDetail = (n: GrowthCount) => `+${n.last7Days} in 7 days · +${n.last30Days} in 30`;

const KIND_BADGE = { bug: "warn", feature: "default", other: "outline" } as const;

function FeedbackCard({
  item,
  saving,
  disabled,
  onSetStatus,
}: { item: FeedbackItem; saving: boolean; disabled: boolean } & Pick<Props, "onSetStatus">) {
  const name = item.author ? (item.author.displayName ?? "No name yet") : "Deleted account";
  const open = item.status === "open";
  return (
    <li className="grid gap-2 rounded-md border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge variant={KIND_BADGE[item.kind]}>{FEEDBACK_KIND_LABELS[item.kind]}</Badge>
        <span>{day(item.createdAt)}</span>
      </div>
      <p className="m-0 whitespace-pre-wrap break-words">{item.message}</p>
      <p className="m-0 text-sm break-words text-muted-foreground">
        {name}
        {item.author?.email && (
          <>
            {" · "}
            <a href={`mailto:${item.author.email}`}>{item.author.email}</a>
          </>
        )}
        {item.page && <> · sent from {item.page}</>}
      </p>
      {item.kind === "bug" && item.userAgent && (
        <p className="m-0 text-xs break-words text-muted-foreground">{item.userAgent}</p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="h-11 justify-self-start"
        disabled={disabled || saving}
        onClick={() => onSetStatus(item.id, open ? "done" : "open")}
      >
        {saving ? "Saving…" : open ? "Mark done" : "Reopen"}
      </Button>
    </li>
  );
}

/** App-wide numbers and the feedback inbox, for the accounts that run the app. */
export function OperatorDashboard({
  overview,
  feedback,
  savingId,
  busy = false,
  loadingMore = false,
  onLoadMore,
  onSetStatus,
}: Props) {
  const open = feedback.filter((item) => item.status === "open");
  const done = feedback.filter((item) => item.status === "done");
  const list = (items: FeedbackItem[], label: string) => (
    <ul aria-label={label} className="m-0 grid list-none gap-2 p-0">
      {items.map((item) => (
        <FeedbackCard
          key={item.id}
          item={item}
          saving={savingId === item.id}
          disabled={busy}
          onSetStatus={onSetStatus}
        />
      ))}
    </ul>
  );
  return (
    <div className="grid gap-8">
      <StatGrid label="App totals">
        <StatTile label="Accounts" value={overview.accounts.total} detail={growthDetail(overview.accounts)} />
        <StatTile label="Leagues" value={overview.leagues.total} detail={growthDetail(overview.leagues)} />
        <StatTile
          label="Active players"
          value={overview.activePlayers.last7Days}
          detail={`Picked or posted in 7 days · ${overview.activePlayers.last30Days} in 30`}
        />
        <StatTile label="Active leagues" value={overview.activeLeagues} detail="A pick saved in 7 days" />
        <StatTile label="Picks" value={overview.picks.total} detail={growthDetail(overview.picks)} />
        <StatTile label="Messages" value={overview.messages.total} detail={growthDetail(overview.messages)} />
      </StatGrid>

      <section className="grid gap-3">
        <h3 className="text-2xl">Feedback</h3>
        <p className="m-0 text-muted-foreground">{overview.openFeedback} open reports · newest first</p>
        {open.length === 0 ? (
          <Card>{onLoadMore ? "No open feedback in the reports loaded so far." : "No open feedback."}</Card>
        ) : (
          list(open, "Open feedback")
        )}
        {done.length > 0 && (
          <details>
            <summary className="flex min-h-11 cursor-pointer items-center font-medium">
              Done ({done.length})
            </summary>
            {list(done, "Finished feedback")}
          </details>
        )}
        {onLoadMore && (
          <Button variant="outline" disabled={busy} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Load older feedback"}
          </Button>
        )}
      </section>

      <section className="grid gap-3">
        <h3 className="text-2xl">Week by week</h3>
        <p className="m-0 text-muted-foreground">Weeks run Monday to Sunday (UTC), newest first.</p>
        <table role="table" aria-label="Activity by week" className="data-table card-rows">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col">Week of</th>
              <th scope="col" className="num">
                Signups
              </th>
              <th scope="col" className="num">
                New leagues
              </th>
              <th scope="col" className="num">
                Players picking
              </th>
              <th scope="col" className="num">
                Picks made
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {overview.weeks.map((week) => (
              <tr role="row" key={week.weekStart} className="max-md:grid-cols-4">
                <td role="cell" className="font-display text-lg font-bold max-md:col-span-4">
                  {weekLabel(week.weekStart)}
                </td>
                <td role="cell" data-label="Signups" className="num">
                  {week.signups}
                </td>
                <td role="cell" data-label="Leagues" className="num">
                  {week.leaguesCreated}
                </td>
                <td role="cell" data-label="Players" className="num">
                  {week.players}
                </td>
                <td role="cell" data-label="Picks" className="num">
                  {week.picks}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3">
        <h3 className="text-2xl">Newest leagues</h3>
        {overview.recentLeagues.length === 0 ? (
          <Card>No leagues yet.</Card>
        ) : (
          <table role="table" aria-label="Newest leagues" className="data-table card-rows">
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col">League</th>
                <th scope="col">Created</th>
                <th scope="col" className="num">
                  Players
                </th>
                <th scope="col">Last pick</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {overview.recentLeagues.map((league) => (
                <tr role="row" key={league.id} className="max-md:grid-cols-3">
                  <td role="cell" className="font-medium break-words max-md:col-span-3">
                    {league.name}
                  </td>
                  <td role="cell" data-label="Created">
                    {day(league.createdAt)}
                  </td>
                  <td role="cell" data-label="Players" className="num">
                    {league.members}
                  </td>
                  <td role="cell" data-label="Last pick">
                    {dayOrDash(league.lastPickAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="grid gap-3">
        <h3 className="text-2xl">Newest accounts</h3>
        <table role="table" aria-label="Newest accounts" className="data-table card-rows">
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col">Account</th>
              <th scope="col">Signed up</th>
              <th scope="col">Last sign-in</th>
              <th scope="col" className="num">
                Leagues
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {overview.recentSignups.map((account) => (
              <tr role="row" key={`${account.email}-${account.createdAt}`} className="max-md:grid-cols-3">
                <td role="cell" className="break-words max-md:col-span-3">
                  <span className="font-medium">{account.displayName ?? "No name yet"}</span>
                  {account.email && <span className="text-muted-foreground"> · {account.email}</span>}
                </td>
                <td role="cell" data-label="Signed up">
                  {day(account.createdAt)}
                </td>
                <td role="cell" data-label="Last sign-in">
                  {dayOrDash(account.lastSignInAt)}
                </td>
                <td role="cell" data-label="Leagues" className="num">
                  {account.leagues}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
