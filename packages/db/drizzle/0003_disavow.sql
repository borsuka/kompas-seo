CREATE TYPE "public"."disavow_type" AS ENUM('domain', 'url');--> statement-breakpoint
CREATE TABLE "disavow_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "disavow_type" NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "disavow_entries" ADD CONSTRAINT "disavow_entries_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disavow_entries" ADD CONSTRAINT "disavow_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disavow_entries" ADD CONSTRAINT "disavow_entries_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "disavow_entries_uidx" ON "disavow_entries" USING btree ("project_id","type","value");--> statement-breakpoint
CREATE INDEX "disavow_entries_org_idx" ON "disavow_entries" USING btree ("organization_id");