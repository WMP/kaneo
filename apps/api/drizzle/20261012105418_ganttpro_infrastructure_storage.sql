CREATE TABLE "ganttpro_infra_storage_capacity" (
	"id" text PRIMARY KEY NOT NULL,
	"cluster_id" text NOT NULL,
	"label" text NOT NULL,
	"model_name" text,
	"capacity_gb" integer NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"available_from" date,
	"hostname" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_infra_storage_capacity_capacity_gb_check" CHECK ("ganttpro_infra_storage_capacity"."capacity_gb" > 0),
	CONSTRAINT "ganttpro_infra_storage_capacity_status_check" CHECK ("ganttpro_infra_storage_capacity"."status" IN ('planned', 'ordered', 'installed'))
);
--> statement-breakpoint
CREATE TABLE "ganttpro_infra_storage_cluster" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"region" text NOT NULL,
	"kind" text NOT NULL,
	"ec_data_chunks" integer,
	"ec_coding_chunks" integer,
	"fill_threshold_percent" integer DEFAULT 80 NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_infra_storage_cluster_workspace_id_name_unique" UNIQUE("workspace_id","name"),
	CONSTRAINT "ganttpro_infra_storage_cluster_kind_check" CHECK ("ganttpro_infra_storage_cluster"."kind" IN ('self_managed', 'managed_service')),
	CONSTRAINT "ganttpro_infra_storage_cluster_ec_check" CHECK (("ganttpro_infra_storage_cluster"."kind" = 'self_managed' AND "ganttpro_infra_storage_cluster"."ec_data_chunks" >= 1 AND "ganttpro_infra_storage_cluster"."ec_coding_chunks" >= 1) OR ("ganttpro_infra_storage_cluster"."kind" = 'managed_service' AND "ganttpro_infra_storage_cluster"."ec_data_chunks" IS NULL AND "ganttpro_infra_storage_cluster"."ec_coding_chunks" IS NULL)),
	CONSTRAINT "ganttpro_infra_storage_cluster_fill_threshold_check" CHECK ("ganttpro_infra_storage_cluster"."fill_threshold_percent" BETWEEN 1 AND 100),
	CONSTRAINT "ganttpro_infra_storage_cluster_lead_time_days_check" CHECK ("ganttpro_infra_storage_cluster"."lead_time_days" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ganttpro_infra_vm" ADD COLUMN "ceph_storage_gb" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_vm" ADD COLUMN "storage_cluster_id" text;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_storage_capacity" ADD CONSTRAINT "ganttpro_infra_storage_capacity_cluster_id_ganttpro_infra_storage_cluster_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."ganttpro_infra_storage_cluster"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_storage_cluster" ADD CONSTRAINT "ganttpro_infra_storage_cluster_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ganttpro_infra_storage_capacity_cluster_id_idx" ON "ganttpro_infra_storage_capacity" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "ganttpro_infra_storage_cluster_workspace_id_idx" ON "ganttpro_infra_storage_cluster" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "ganttpro_infra_vm" ADD CONSTRAINT "ganttpro_infra_vm_storage_cluster_id_ganttpro_infra_storage_cluster_id_fk" FOREIGN KEY ("storage_cluster_id") REFERENCES "public"."ganttpro_infra_storage_cluster"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ganttpro_infra_vm_storage_cluster_id_idx" ON "ganttpro_infra_vm" USING btree ("storage_cluster_id");--> statement-breakpoint
ALTER TABLE "ganttpro_infra_vm" ADD CONSTRAINT "ganttpro_infra_vm_ceph_storage_gb_check" CHECK ("ganttpro_infra_vm"."ceph_storage_gb" >= 0);