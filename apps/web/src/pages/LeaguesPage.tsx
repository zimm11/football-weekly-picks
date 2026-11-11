import { CaretRightIcon } from "@phosphor-icons/react";
import type { InvitePreview, LeagueSummary } from "@picks/shared";
import { type FormEvent, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, Eyebrow, Notice } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { api, messageOf, unwrap } from "../api";
import { notifyDone } from "../notify";
import { Link, navigate } from "../router";
import { useLoad } from "./useLoad";

/** A whole row that is one link: easier to hit with a thumb than a word of text. */
export const rowLink =
  "flex min-h-16 items-center gap-3 rounded-md border bg-card px-4 py-3 text-foreground no-underline transition-colors hover:border-primary/60";

export function LeaguesPage() {
  const leagues = useLoad(() => unwrap<LeagueSummary[]>(api.leagues.$get()), "leagues");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
    // The 6am game-day lock is measured in the league's time zone; start with the creator's.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setBusy(true);
    try {
      const { id } = await unwrap<{ id: string }>(api.leagues.$post({ json: { name, timeZone } }));
      // A new league has no weeks yet, so start where the admin sets one up and finds the invite link.
      navigate(`/leagues/${id}/league`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  if (leagues.error) return <Notice kind="alert">{leagues.error}</Notice>;
  if (!leagues.data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="grid gap-6">
      <h2 className="text-4xl leading-none font-extrabold">Your leagues</h2>
      {leagues.data.length === 0 ? (
        <Card>
          <p className="m-0 text-muted-foreground">
            You're not in a league yet. To join one, open the invite link from its admin. Or start your own
            below.
          </p>
        </Card>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0">
          {leagues.data.map((league) => (
            <li key={league.id}>
              <Link to={`/leagues/${league.id}`} className={rowLink}>
                <span className="mr-auto font-display text-2xl font-bold tracking-wide uppercase">
                  {league.name}
                </span>
                {league.role === "admin" && <Badge variant="outline">Admin</Badge>}
                <CaretRightIcon aria-hidden className="size-5 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Card>
        <Eyebrow>Start a league</Eyebrow>
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="League name">
            <Input name="name" required maxLength={80} />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create league"}
          </Button>
        </form>
        {error && <Notice kind="alert">{error}</Notice>}
      </Card>
    </div>
  );
}

export function JoinPage({ code }: { code: string }) {
  const invite = useLoad(() => unwrap<InvitePreview>(api.invites[":code"].$get({ param: { code } })), code);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    try {
      const { leagueId } = await unwrap<{ leagueId: string }>(
        api.invites[":code"].join.$post({ param: { code } }),
      );
      notifyDone(`You're in. Welcome to ${invite.data?.leagueName ?? "the league"}.`);
      navigate(`/leagues/${leagueId}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  if (invite.error) return <Notice kind="alert">{invite.error}</Notice>;
  if (!invite.data) return <p className="text-muted-foreground">Loading…</p>;
  return (
    <div className="mx-auto grid max-w-sm gap-5 pt-6">
      <div className="grid gap-2">
        <Eyebrow>You're invited</Eyebrow>
        <h2 className="text-4xl leading-none font-extrabold">{invite.data.leagueName}</h2>
      </div>
      <Card>
        {invite.data.alreadyMember ? (
          <>
            <p className="m-0">You're already in this league.</p>
            <Link to={`/leagues/${invite.data.leagueId}`} className={buttonVariants()}>
              Go to the league
            </Link>
          </>
        ) : (
          <>
            <p className="m-0">You've been invited to join this league.</p>
            <Button type="button" disabled={busy} onClick={join}>
              {busy ? "Joining…" : "Join league"}
            </Button>
          </>
        )}
        {error && <Notice kind="alert">{error}</Notice>}
      </Card>
    </div>
  );
}
