-- What Drizzle's schema can't express. Everything else from this change is in the migration before this one.

-- The tiebreaker must be one of the week's own games. Like the single-column key beside it, deleting the game
-- clears the tiebreaker, and only that column: a plain SET NULL would also null the week's id. Drizzle has no
-- way to write the column list, so the key lives here (schema.ts points to it).
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_tiebreaker_game_week_fk" FOREIGN KEY ("tiebreaker_game_id", "id") REFERENCES "public"."games"("id", "week_id") ON DELETE SET NULL ("tiebreaker_game_id");--> statement-breakpoint

-- Weeks that are already final get their players recorded now, by the rule the API has used until today
-- (`weekParticipants` in apps/api/src/context.ts): in the league at the week's last kickoff, or picked in it,
-- and not removed before that kickoff. From here on, leaving or rejoining can't change them either. A final
-- week without games has no kickoff to judge by and stays on the old rule.
INSERT INTO "week_participants" ("week_id", "user_id")
SELECT w."id", m."user_id"
FROM "weeks" w
JOIN "seasons" s ON s."id" = w."season_id"
JOIN "league_members" m ON m."league_id" = s."league_id"
JOIN LATERAL (SELECT max(g."kickoff") AS last_kickoff FROM "games" g WHERE g."week_id" = w."id") k ON true
WHERE w."status" = 'final'
  AND k.last_kickoff IS NOT NULL
  AND (m."removed_at" IS NULL OR m."removed_at" > k.last_kickoff)
  AND (
    m."joined_at" <= k.last_kickoff
    OR EXISTS (SELECT 1 FROM "picks" p WHERE p."week_id" = w."id" AND p."user_id" = m."user_id")
  )
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Clients never query the database directly: the API connects as a privileged role, and browsers hold only the
-- publishable key for Supabase Auth. RLS (enabled with no policies) already blocks rows through the Data API,
-- but Supabase's default grants still give `anon` and `authenticated` every privilege on every public table,
-- including TRUNCATE, which RLS doesn't cover. Take them away, for what exists and for tables and sequences
-- created later, so a forgotten `.enableRLS()` can't expose a table either.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;--> statement-breakpoint

-- Functions are executable by everyone (PUBLIC) unless told otherwise. The app defines none, but the hosted
-- project has `rls_auto_enable()`, an event-trigger function the dashboard added to turn RLS on for new tables;
-- it is SECURITY DEFINER and was callable through the Data API. The trigger keeps firing without EXECUTE (it
-- isn't checked for triggers); this only stops clients calling it. A function added to `public` later is
-- executable by PUBLIC again until revoked: per-schema defaults can't change that.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
