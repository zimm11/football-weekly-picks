-- Integrity rules the API already follows, enforced by the database too. Existing production rows satisfy all
-- of them (checked before writing this migration).

-- Drizzle's text({ enum }) is a TypeScript type only; these make the allowed values a database rule.
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_role_check" CHECK ("role" IN ('admin', 'member'));--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_status_check" CHECK ("status" IN ('draft', 'open', 'final'));--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_side_check" CHECK ("side" IN ('home', 'away'));--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_kind_check" CHECK ("kind" IN ('bug', 'feature', 'other'));--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_status_check" CHECK ("status" IN ('open', 'done'));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("kind" IN ('new_thread', 'pick_reminder'));--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_status_check" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'skipped'));--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_kind_check" CHECK ("kind" IN ('new_thread', 'pick_reminder'));--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_status_check" CHECK ("status" IN ('pending', 'sent', 'skipped', 'failed'));--> statement-breakpoint

-- A pick's denormalized week must be its game's week, and the tiebreaker must be one of the week's own games.
-- Each repeats the delete behavior of the single-column key beside it (cascade the picks, clear the tiebreaker).
-- With NO ACTION instead, removing a game would only work while Postgres happened to fire the older key's
-- trigger first; triggers fire in name order, so that could flip.
ALTER TABLE "picks" ADD CONSTRAINT "picks_game_week_fk" FOREIGN KEY ("game_id", "week_id") REFERENCES "public"."games"("id", "week_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_tiebreaker_game_week_fk" FOREIGN KEY ("tiebreaker_game_id", "id") REFERENCES "public"."games"("id", "week_id") ON DELETE SET NULL ("tiebreaker_game_id");--> statement-breakpoint

-- Clients never query the database directly: the API connects as a privileged role, and browsers hold only the
-- publishable key for Supabase Auth. RLS (enabled with no policies) already blocks rows through the Data API,
-- but Supabase's default grants still give `anon` and `authenticated` every privilege on every public table,
-- including TRUNCATE, which RLS doesn't cover. Take them away, for existing objects and for tables and sequences
-- created later, so a forgotten `.enableRLS()` can't expose a table either. (A function created later is still
-- executable through Postgres's built-in PUBLIC default; the app has none.)
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;--> statement-breakpoint

-- The hosted project's dashboard added an event-trigger function that turns RLS on for new tables. It is
-- SECURITY DEFINER and was executable through the Data API. The trigger stays; only the client roles lose
-- EXECUTE. It doesn't exist locally, hence the guard.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;
