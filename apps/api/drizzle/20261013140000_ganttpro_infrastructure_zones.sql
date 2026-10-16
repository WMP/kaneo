ALTER TABLE "ganttpro_infra_host" ADD COLUMN "zone" text;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_region" ADD COLUMN "zones" jsonb DEFAULT '[]'::jsonb NOT NULL;