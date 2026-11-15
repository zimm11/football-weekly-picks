import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import {
  formatLine,
  type Game,
  type GameInsights,
  type MarketInsights,
  type MatchupInsights,
  type TeamInsights,
  teamName,
} from "@picks/shared";
import { cn } from "cn";
import { type ReactNode, useEffect, useState } from "react";
import { Eyebrow, Notice } from "@/components/ui/card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatPercent, kickoffDay, kickoffTime } from "../format";
import { TeamLogo } from "./TeamLogo";

type Props = {
  /** The game to show, or null while the sheet is closed. */
  game: Game | null;
  timeZone: string;
  /** Rejects with a message to show when the game's background can't be loaded. */
  load: (gameId: string) => Promise<GameInsights>;
  onClose: () => void;
};

/** "Giants -2.5" for a home line of -2.5, "Commanders -2.5" for +2.5: the line as the favorite's. */
function favoriteLine(game: Pick<Game, "homeTeam" | "awayTeam">, homeLine: number): string {
  if (homeLine === 0) return "Pick'em";
  return homeLine < 0
    ? formatLine(teamName(game.homeTeam), homeLine)
    : formatLine(teamName(game.awayTeam), -homeLine);
}

const points = (n: number) => `${n} ${n === 1 ? "point" : "points"}`;

/**
 * Background on one game, slid up over the pick sheet: what a national prediction market makes of it, then
 * each team's form, injuries and headlines. It loads when opened and never touches the picks underneath.
 */
export function MatchupSheet({ game, timeZone, load, onClose }: Props) {
  const [state, setState] = useState<{ gameId: string; insights?: GameInsights; error?: string }>();
  const gameId = game?.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is a fresh closure each render; the game says when to fetch.
  useEffect(() => {
    if (!gameId) return;
    let current = true;
    setState({ gameId });
    load(gameId).then(
      (insights) => current && setState({ gameId, insights }),
      (err) =>
        current &&
        setState({ gameId, error: err instanceof Error ? err.message : "Couldn't load this matchup." }),
    );
    return () => {
      current = false;
    };
  }, [gameId]);

  // Ignore what was loaded for a game other than the one on screen.
  const shown = state && state.gameId === gameId ? state : undefined;
  const insights = shown?.insights;

  return (
    <Sheet open={!!game} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" aria-describedby={undefined}>
        {game && (
          <>
            <SheetHeader>
              <SheetTitle>
                {teamName(game.awayTeam)} at {teamName(game.homeTeam)}
              </SheetTitle>
              <SheetDescription>
                {kickoffDay(game.kickoff, timeZone)} · {kickoffTime(game.kickoff, timeZone)}
                {game.spread !== null && ` · ${favoriteLine(game, game.spread)}`}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-6 px-4 pb-6">
              {shown?.error && <Notice kind="alert">{shown.error}</Notice>}
              {!insights && !shown?.error && <p className="m-0 text-muted-foreground">Loading matchup…</p>}
              {insights && !insights.market && !insights.matchup && (
                <p className="m-0 text-muted-foreground">No stats are available for this game right now.</p>
              )}
              {insights?.market && <Market game={game} market={insights.market} />}
              {insights?.matchup && <Matchup game={game} matchup={insights.matchup} timeZone={timeZone} />}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-2.5">
      <Eyebrow>{title}</Eyebrow>
      {children}
    </section>
  );
}

/** A label on the left and its value on the right. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="m-0 text-right font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function Market({ game, market }: { game: Game; market: MarketInsights }) {
  const home = teamName(game.homeTeam);
  const away = teamName(game.awayTeam);
  const push = market.cover ? 1 - market.cover.home - market.cover.away : 0;
  // How far the league's line sits from the market's, from the home team's side.
  const edge = market.spread !== null && game.spread !== null ? game.spread - market.spread : 0;
  // Rounded once, so the two sides always add up to 100.
  const homePct = market.homeWin === null ? 0 : Math.round(market.homeWin * 100);
  const awayPct = 100 - homePct;

  return (
    <Section title="Prediction market">
      {market.homeWin !== null && (
        <div className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-3 font-display text-lg font-bold uppercase">
            <span>
              {away} <span className="tabular-nums">{awayPct}%</span>
            </span>
            <span className="text-sm font-medium text-muted-foreground">To win</span>
            <span>
              <span className="tabular-nums">{homePct}%</span> {home}
            </span>
          </div>
          {/* The two halves are told apart by the labels above them, away on the left as on the pick card. */}
          <div
            role="img"
            aria-label={`Chance to win: ${away} ${awayPct}%, ${home} ${homePct}%`}
            className="flex h-2.5 gap-0.5"
          >
            <div className="rounded-l-sm bg-muted-foreground/60" style={{ flexGrow: awayPct }} />
            <div className="rounded-r-sm bg-foreground" style={{ flexGrow: homePct }} />
          </div>
        </div>
      )}
      <dl className="m-0">
        {market.cover && game.spread !== null && (
          <>
            <Row label={`${formatLine(away, game.spread === 0 ? 0 : -game.spread)} covers`}>
              {formatPercent(market.cover.away)}
            </Row>
            <Row label={`${formatLine(home, game.spread)} covers`}>{formatPercent(market.cover.home)}</Row>
            {push >= 0.005 && <Row label="Push">{formatPercent(push)}</Row>}
          </>
        )}
        {market.spread !== null && <Row label="Market's line">{favoriteLine(game, market.spread)}</Row>}
      </dl>
      {edge !== 0 && (
        <p className="m-0 text-sm">
          {edge > 0 ? home : away} get {points(Math.abs(edge))} more here than at the market's line.
        </p>
      )}
      <p className="m-0 text-sm text-muted-foreground">
        Prices from {market.source}, a national prediction market. They show what traders expect, not how this
        league picked.
      </p>
    </Section>
  );
}

function TeamHeading({ abbr, className }: { abbr: string; className?: string }) {
  return (
    <span className={cn("flex items-center gap-2 font-display text-lg font-bold uppercase", className)}>
      <TeamLogo abbr={abbr} size={24} />
      {teamName(abbr)}
    </span>
  );
}

/** The same kind of list for each team, away first as on the pick card. */
function PerTeam({
  game,
  matchup,
  children,
}: {
  game: Game;
  matchup: MatchupInsights;
  children: (team: TeamInsights) => ReactNode;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(["away", "home"] as const).map((side) => (
        <div key={side} className="grid content-start gap-1.5">
          <TeamHeading abbr={side === "home" ? game.homeTeam : game.awayTeam} />
          {children(matchup[side])}
        </div>
      ))}
    </div>
  );
}

const RESULT_CLASS = { W: "text-win", L: "text-muted-foreground", T: "text-foreground" };

function Matchup({ game, matchup, timeZone }: { game: Game; matchup: MatchupInsights; timeZone: string }) {
  const { home, away } = matchup;
  const comparison = [
    { label: "Record", home: home.record, away: away.record },
    { label: "Road / home", home: home.venueRecord, away: away.venueRecord },
    ...matchup.stats,
  ].filter((row) => row.home !== null && row.away !== null);

  // A league-wide story is filed under both teams: show it once.
  const seen = new Set<string>();
  const news = [
    ...away.news.map((n) => ({ ...n, team: game.awayTeam })),
    ...home.news.map((n) => ({ ...n, team: game.homeTeam })),
  ]
    .filter((n) => !seen.has(n.url) && seen.add(n.url))
    .sort((a, b) => b.published.localeCompare(a.published));
  const newsDate = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });

  const has = (pick: (team: TeamInsights) => unknown[]) => pick(home).length > 0 || pick(away).length > 0;

  return (
    <>
      {comparison.length > 0 && (
        <Section title="Team stats">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-x-3">
            <TeamHeading abbr={game.awayTeam} className="pb-1" />
            <span />
            <TeamHeading abbr={game.homeTeam} className="flex-row-reverse pb-1" />
            {comparison.map((row) => (
              <div key={row.label} className="col-span-3 grid grid-cols-subgrid border-t py-2">
                <span className="font-medium tabular-nums">{row.away}</span>
                <span className="text-center text-sm text-muted-foreground">{row.label}</span>
                <span className="text-right font-medium tabular-nums">{row.home}</span>
              </div>
            ))}
          </div>
          {matchup.overUnder !== null && (
            <p className="m-0 text-sm text-muted-foreground">
              Posted total for this game: <span className="text-foreground">{matchup.overUnder} points</span>.
            </p>
          )}
        </Section>
      )}

      {has((t) => t.lastFive) && (
        <Section title="Last five games">
          <PerTeam game={game} matchup={matchup}>
            {(team) => (
              <ul className="m-0 grid list-none gap-1 p-0 text-sm">
                {team.lastFive.length === 0 && <li className="text-muted-foreground">No games yet.</li>}
                {/* Newest first: the latest result says the most. */}
                {[...team.lastFive].reverse().map((g, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, and a team can meet the same opponent twice.
                  <li key={i} className="flex gap-2 tabular-nums">
                    <span className={cn("w-4 font-bold", RESULT_CLASS[g.result])}>{g.result}</span>
                    <span>{g.score}</span>
                    <span className="text-muted-foreground">
                      {g.home ? "vs" : "at"} {g.opponent}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PerTeam>
        </Section>
      )}

      {has((t) => t.injuries) && (
        <Section title="Injuries">
          <PerTeam game={game} matchup={matchup}>
            {(team) => (
              <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
                {team.injuries.length === 0 && <li className="text-muted-foreground">None listed.</li>}
                {team.injuries.map((i) => (
                  <li key={`${i.name}-${i.status}`}>
                    {i.position && <span className="text-muted-foreground">{i.position} </span>}
                    <span className="font-medium">{i.name}</span>
                    <span className="block text-muted-foreground">
                      {i.status}
                      {i.injury && ` · ${i.injury}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PerTeam>
        </Section>
      )}

      {has((t) => t.leaders) && (
        <Section title="Season leaders">
          <PerTeam game={game} matchup={matchup}>
            {(team) => (
              <ul className="m-0 grid list-none gap-1.5 p-0 text-sm">
                {team.leaders.map((l) => (
                  <li key={l.label}>
                    <span className="font-medium">{l.name}</span>
                    <span className="block text-muted-foreground tabular-nums">{l.line}</span>
                  </li>
                ))}
              </ul>
            )}
          </PerTeam>
        </Section>
      )}

      {news.length > 0 && (
        <Section title="Latest news">
          <ul className="m-0 grid list-none p-0">
            {news.map((n) => (
              <li key={n.url} className="border-b last:border-b-0">
                {/* Opens ESPN in a new tab, so unsaved picks stay where they are. */}
                <a
                  href={n.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-h-11 items-center gap-3 py-2 text-foreground no-underline hover:text-primary"
                >
                  <span className="grid gap-0.5">
                    <span className="font-medium">{n.headline}</span>
                    <span className="text-sm text-muted-foreground">
                      {n.team} · {newsDate.format(new Date(n.published))}
                    </span>
                  </span>
                  <ArrowSquareOutIcon aria-hidden className="ml-auto size-5 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {matchup.url && (
        <a
          href={matchup.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-input text-base font-semibold text-foreground no-underline hover:bg-raised"
        >
          Full game page on ESPN
          <ArrowSquareOutIcon aria-hidden className="size-5" />
        </a>
      )}
    </>
  );
}
