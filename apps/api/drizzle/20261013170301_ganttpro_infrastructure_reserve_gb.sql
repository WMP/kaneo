ALTER TABLE "ganttpro_infra_model" ADD COLUMN "hypervisor_reserve_gb" integer DEFAULT 8 NOT NULL;--> statement-breakpoint
-- Backfill (hand-written, must run before the check below): the reserve moves
-- from a percentage to GB. Existing models keep today's usable RAM:
-- reserve GB = ceil(ram_gb * percent / 100), which keeps the old usable RAM
-- floor(ram_gb * (100 - percent) / 100) exactly. LEAST keeps it below ram_gb so
-- that the new check holds for every row (ram_gb >= 1 is guaranteed). The old
-- hypervisor_reserve_percent column stays, deprecated, for an older binary.
UPDATE "ganttpro_infra_model"
SET "hypervisor_reserve_gb" = LEAST(
  "ram_gb" - 1,
  CEIL("ram_gb" * "hypervisor_reserve_percent" / 100.0)::int
);--> statement-breakpoint
ALTER TABLE "ganttpro_infra_model" ADD CONSTRAINT "ganttpro_infra_model_hypervisor_reserve_gb_check" CHECK ("ganttpro_infra_model"."hypervisor_reserve_gb" >= 0 AND "ganttpro_infra_model"."hypervisor_reserve_gb" < "ganttpro_infra_model"."ram_gb");
