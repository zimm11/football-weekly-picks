CREATE TABLE "week_participants" (
	"week_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "week_participants_week_id_user_id_pk" PRIMARY KEY("week_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "week_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "picks_week_idx";--> statement-breakpoint
ALTER TABLE "week_participants" ADD CONSTRAINT "week_participants_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "week_participants" ADD CONSTRAINT "week_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "week_participants_user_idx" ON "week_participants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_outbox_user_idx" ON "email_outbox" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_posts_author_idx" ON "message_posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "message_posts_quoted_post_idx" ON "message_posts" USING btree ("quoted_post_id");--> statement-breakpoint
CREATE INDEX "message_reactions_user_idx" ON "message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_reads_user_idx" ON "message_reads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "message_threads_author_idx" ON "message_threads" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "picks_week_user_idx" ON "picks" USING btree ("week_id","user_id");--> statement-breakpoint
CREATE INDEX "picks_user_idx" ON "picks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_delivery_league_idx" ON "push_deliveries" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "push_delivery_thread_idx" ON "push_deliveries" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "push_delivery_week_idx" ON "push_deliveries" USING btree ("week_id");--> statement-breakpoint
CREATE INDEX "push_delivery_created_idx" ON "push_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tiebreaker_guesses_user_idx" ON "tiebreaker_guesses" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "week_recap_views_user_idx" ON "week_recap_views" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "weeks_tiebreaker_game_idx" ON "weeks" USING btree ("tiebreaker_game_id");--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_id_week_key" UNIQUE("id","week_id");