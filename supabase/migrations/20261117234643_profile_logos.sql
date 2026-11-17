ALTER TABLE "profiles" ADD COLUMN "avatar_id" integer;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_avatar_id_range" CHECK ("profiles"."avatar_id" between 1 and 100);