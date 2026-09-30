ALTER TABLE "activity" ADD COLUMN "actor_via" text;--> statement-breakpoint
ALTER TABLE "activity" ADD COLUMN "actor_token_hint" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "auth_via" text;