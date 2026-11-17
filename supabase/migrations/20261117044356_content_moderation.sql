CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"target_key" text NOT NULL,
	"post_id" uuid,
	"subject_user_id" uuid,
	"league_id" uuid,
	"reporter_id" uuid,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "content_reports_kind_check" CHECK ("content_reports"."kind" in ('post', 'display_name', 'league_name')),
	CONSTRAINT "content_reports_source_check" CHECK ("content_reports"."source" in ('player', 'recheck', 'appeal')),
	CONSTRAINT "content_reports_reason_check" CHECK ("content_reports"."reason" in ('harassment', 'hate', 'sexual', 'threat_self_harm', 'spam', 'other', 'flagged', 'appeal')),
	CONSTRAINT "content_reports_status_check" CHECK ("content_reports"."status" in ('open', 'removed', 'dismissed')),
	CONSTRAINT "content_reports_post_check" CHECK (("content_reports"."kind" = 'post') = ("content_reports"."post_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "content_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" text NOT NULL,
	"post_id" uuid,
	"user_id" uuid,
	"league_id" uuid,
	"actor_id" uuid,
	"report_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_action_check" CHECK ("moderation_actions"."action" in ('remove', 'hide', 'restore', 'dismiss', 'mute', 'unmute', 'suspend', 'unsuspend', 'reset_name'))
);
--> statement-breakpoint
ALTER TABLE "moderation_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "user_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
DROP INDEX "message_posts_author_idx";--> statement-breakpoint
ALTER TABLE "league_members" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_posts" ADD COLUMN "screening" text DEFAULT 'skipped' NOT NULL;--> statement-breakpoint
ALTER TABLE "message_posts" ADD COLUMN "screening_scores" jsonb;--> statement-breakpoint
ALTER TABLE "message_posts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_posts" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "message_posts" ADD COLUMN "removed_by" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "muted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_post_id_message_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."message_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_post_id_message_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."message_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_content_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."content_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_reports_open_idx" ON "content_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_target_idx" ON "content_reports" USING btree ("target_key");--> statement-breakpoint
CREATE INDEX "content_reports_post_idx" ON "content_reports" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "content_reports_subject_idx" ON "content_reports" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "content_reports_league_idx" ON "content_reports" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "content_reports_reporter_idx" ON "content_reports" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "content_reports_resolved_by_idx" ON "content_reports" USING btree ("resolved_by");--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_one_open_per_reporter" ON "content_reports" USING btree ("target_key","reporter_id") WHERE "content_reports"."status" = 'open' and "content_reports"."reporter_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_one_open_flag" ON "content_reports" USING btree ("target_key") WHERE "content_reports"."status" = 'open' and "content_reports"."reporter_id" is null;--> statement-breakpoint
CREATE INDEX "moderation_actions_user_idx" ON "moderation_actions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_created_idx" ON "moderation_actions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_post_idx" ON "moderation_actions" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_league_idx" ON "moderation_actions" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_actor_idx" ON "moderation_actions" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "moderation_actions_report_idx" ON "moderation_actions" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
ALTER TABLE "message_posts" ADD CONSTRAINT "message_posts_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_posts_removed_by_idx" ON "message_posts" USING btree ("removed_by");--> statement-breakpoint
CREATE INDEX "message_posts_unchecked_idx" ON "message_posts" USING btree ("created_at") WHERE "message_posts"."screening" = 'unchecked';--> statement-breakpoint
CREATE INDEX "message_posts_removed_idx" ON "message_posts" USING btree ("removed_at") WHERE "message_posts"."removed_at" is not null;--> statement-breakpoint
CREATE INDEX "message_posts_author_idx" ON "message_posts" USING btree ("author_id","created_at");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('new_thread', 'pick_reminder', 'moderation'));--> statement-breakpoint
ALTER TABLE "message_posts" ADD CONSTRAINT "message_posts_screening_check" CHECK ("message_posts"."screening" in ('allow', 'block', 'unchecked', 'skipped'));