ALTER TABLE "message_posts" ADD COLUMN "quoted_post_id" uuid;--> statement-breakpoint
ALTER TABLE "message_threads" ADD COLUMN "pinned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "message_posts" ADD CONSTRAINT "message_posts_quoted_post_id_message_posts_id_fk" FOREIGN KEY ("quoted_post_id") REFERENCES "public"."message_posts"("id") ON DELETE set null ON UPDATE no action;