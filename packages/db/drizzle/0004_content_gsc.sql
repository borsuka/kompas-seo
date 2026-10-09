CREATE TYPE "public"."brief_status" AS ENUM('queued', 'running', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."gsc_status" AS ENUM('pending_site', 'active', 'error');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'content.brief';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'gsc.sync';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'gsc.schedule';--> statement-breakpoint
CREATE TABLE "content_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid,
	"keyword" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"status" "brief_status" DEFAULT 'queued' NOT NULL,
	"source" text,
	"job_id" uuid,
	"analysis" jsonb,
	"pages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"people_also_ask" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"brief" jsonb,
	"error" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" "gsc_status" NOT NULL,
	"site_url" text,
	"refresh_token_enc" text,
	"scope" text,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"connected_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_briefs_org_idx" ON "content_briefs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_connections_project_uidx" ON "gsc_connections" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "gsc_connections_org_idx" ON "gsc_connections" USING btree ("organization_id");