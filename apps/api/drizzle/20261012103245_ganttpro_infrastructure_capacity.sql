CREATE TABLE "ganttpro_infra_host" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"model_id" text NOT NULL,
	"region" text NOT NULL,
	"label" text NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"available_from" date,
	"hostname" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_infra_host_status_check" CHECK ("ganttpro_infra_host"."status" IN ('planned', 'ordered', 'installed'))
);
--> statement-breakpoint
CREATE TABLE "ganttpro_infra_model" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text NOT NULL,
	"family" text,
	"ram_gb" integer NOT NULL,
	"vcpu" integer NOT NULL,
	"storage_gb" integer NOT NULL,
	"regions" jsonb NOT NULL,
	"lead_time_days" integer DEFAULT 0 NOT NULL,
	"hypervisor_reserve_percent" integer DEFAULT 5 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_infra_model_provider_check" CHECK ("ganttpro_infra_model"."provider" IN ('ovh', 'azure', 'other')),
	CONSTRAINT "ganttpro_infra_model_ram_gb_check" CHECK ("ganttpro_infra_model"."ram_gb" > 0),
	CONSTRAINT "ganttpro_infra_model_vcpu_check" CHECK ("ganttpro_infra_model"."vcpu" > 0),
	CONSTRAINT "ganttpro_infra_model_storage_gb_check" CHECK ("ganttpro_infra_model"."storage_gb" >= 0),
	CONSTRAINT "ganttpro_infra_model_lead_time_days_check" CHECK ("ganttpro_infra_model"."lead_time_days" >= 0),
	CONSTRAINT "ganttpro_infra_model_hypervisor_reserve_check" CHECK ("ganttpro_infra_model"."hypervisor_reserve_percent" BETWEEN 0 AND 90)
);
--> statement-breakpoint
CREATE TABLE "ganttpro_infra_vm" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"host_id" text,
	"name" text NOT NULL,
	"vcpu" integer DEFAULT 0 NOT NULL,
	"ram_gb" integer DEFAULT 0 NOT NULL,
	"storage_gb" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ganttpro_infra_vm_vcpu_check" CHECK ("ganttpro_infra_vm"."vcpu" >= 0),
	CONSTRAINT "ganttpro_infra_vm_ram_gb_check" CHECK ("ganttpro_infra_vm"."ram_gb" >= 0),
	CONSTRAINT "ganttpro_infra_vm_storage_gb_check" CHECK ("ganttpro_infra_vm"."storage_gb" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ganttpro_infra_host" ADD CONSTRAINT "ganttpro_infra_host_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_host" ADD CONSTRAINT "ganttpro_infra_host_model_id_ganttpro_infra_model_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ganttpro_infra_model"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_model" ADD CONSTRAINT "ganttpro_infra_model_project_id_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_vm" ADD CONSTRAINT "ganttpro_infra_vm_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ganttpro_infra_vm" ADD CONSTRAINT "ganttpro_infra_vm_host_id_ganttpro_infra_host_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."ganttpro_infra_host"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ganttpro_infra_host_project_id_idx" ON "ganttpro_infra_host" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ganttpro_infra_host_model_id_idx" ON "ganttpro_infra_host" USING btree ("model_id");--> statement-breakpoint
CREATE INDEX "ganttpro_infra_model_project_id_idx" ON "ganttpro_infra_model" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "ganttpro_infra_vm_task_id_idx" ON "ganttpro_infra_vm" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "ganttpro_infra_vm_host_id_idx" ON "ganttpro_infra_vm" USING btree ("host_id");