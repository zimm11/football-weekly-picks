CREATE TABLE "square_boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"external_id" text,
	"year" integer,
	"week" integer,
	"home_team" text NOT NULL,
	"away_team" text NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"max_per_player" integer DEFAULT 10 NOT NULL,
	"home_digits" integer[],
	"away_digits" integer[],
	"drawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "square_boards_max_per_player_check" CHECK ("square_boards"."max_per_player" between 1 and 100),
	CONSTRAINT "square_boards_week_check" CHECK ("square_boards"."week" is null or "square_boards"."week" between 1 and 22),
	CONSTRAINT "square_boards_draw_check" CHECK (("square_boards"."drawn_at" is null and "square_boards"."home_digits" is null and "square_boards"."away_digits" is null) or ("square_boards"."drawn_at" is not null and cardinality("square_boards"."home_digits") = 10 and cardinality("square_boards"."away_digits") = 10))
);
--> statement-breakpoint
ALTER TABLE "square_boards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "square_claims" (
	"board_id" uuid NOT NULL,
	"row" integer NOT NULL,
	"col" integer NOT NULL,
	"user_id" uuid,
	"guest_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "square_claims_board_id_row_col_pk" PRIMARY KEY("board_id","row","col"),
	CONSTRAINT "square_claims_owner_check" CHECK (("square_claims"."user_id" is null) <> ("square_claims"."guest_name" is null)),
	CONSTRAINT "square_claims_row_check" CHECK ("square_claims"."row" between 0 and 9),
	CONSTRAINT "square_claims_col_check" CHECK ("square_claims"."col" between 0 and 9)
);
--> statement-breakpoint
ALTER TABLE "square_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "square_scores" (
	"board_id" uuid NOT NULL,
	"period" text NOT NULL,
	"home_score" integer NOT NULL,
	"away_score" integer NOT NULL,
	"by_admin" boolean DEFAULT false NOT NULL,
	CONSTRAINT "square_scores_board_id_period_pk" PRIMARY KEY("board_id","period"),
	CONSTRAINT "square_scores_period_check" CHECK ("square_scores"."period" in ('q1', 'half', 'q3', 'final')),
	CONSTRAINT "square_scores_scores_check" CHECK ("square_scores"."home_score" >= 0 and "square_scores"."away_score" >= 0)
);
--> statement-breakpoint
ALTER TABLE "square_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "survivor_picks" (
	"week_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"side" text NOT NULL,
	"by_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survivor_picks_week_id_user_id_pk" PRIMARY KEY("week_id","user_id"),
	CONSTRAINT "survivor_picks_side_check" CHECK ("survivor_picks"."side" in ('home', 'away'))
);
--> statement-breakpoint
ALTER TABLE "survivor_picks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_outbox" DROP CONSTRAINT "email_outbox_kind_check";--> statement-breakpoint
ALTER TABLE "push_deliveries" DROP CONSTRAINT "push_deliveries_kind_check";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "spread_by_admin" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "type" text DEFAULT 'weekly' NOT NULL;--> statement-breakpoint
ALTER TABLE "leagues" ADD COLUMN "management" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email_league_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "league_events" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "square_boards" ADD CONSTRAINT "square_boards_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_claims" ADD CONSTRAINT "square_claims_board_id_square_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."square_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_claims" ADD CONSTRAINT "square_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "square_scores" ADD CONSTRAINT "square_scores_board_id_square_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."square_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survivor_picks" ADD CONSTRAINT "survivor_picks_game_week_fk" FOREIGN KEY ("game_id","week_id") REFERENCES "public"."games"("id","week_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "square_boards_league_idx" ON "square_boards" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "square_claims_board_user_idx" ON "square_claims" USING btree ("board_id","user_id");--> statement-breakpoint
CREATE INDEX "square_claims_user_idx" ON "square_claims" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "survivor_picks_user_idx" ON "survivor_picks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "survivor_picks_game_idx" ON "survivor_picks" USING btree ("game_id");--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_board_id_square_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."square_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_delivery_board_idx" ON "push_deliveries" USING btree ("board_id");--> statement-breakpoint
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('new_thread', 'pick_reminder', 'league_event', 'moderation'));--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_type_check" CHECK ("leagues"."type" in ('weekly', 'playoff', 'squares', 'survivor'));--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_management_check" CHECK ("leagues"."management" in ('auto', 'manual'));--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_manual_weekly_check" CHECK ("leagues"."management" = 'auto' or "leagues"."type" = 'weekly');--> statement-breakpoint
ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_kind_check" CHECK ("push_deliveries"."kind" in ('new_thread', 'pick_reminder', 'league_event'));--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_number_check" CHECK ("weeks"."number" between 1 and 22);