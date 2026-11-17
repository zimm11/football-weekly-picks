ALTER TABLE "push_deliveries" ADD COLUMN "native_receipt_id" text;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "transport" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_transport_check" CHECK ("push_subscriptions"."transport" in ('web', 'expo'));