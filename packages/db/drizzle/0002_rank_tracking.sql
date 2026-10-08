CREATE TYPE "public"."rank_alert_type" AS ENUM('position_drop', 'position_gain', 'enter_top', 'leave_top');--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'rankings.schedule';--> statement-breakpoint
ALTER TYPE "public"."job_type" ADD VALUE 'rankings.check';--> statement-breakpoint
CREATE TABLE "rank_alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"alert_id" uuid NOT NULL,
	"tracked_keyword_id" uuid NOT NULL,
	"date" date NOT NULL,
	"previous_position" smallint,
	"position" smallint,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rank_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "rank_alert_type" NOT NULL,
	"threshold" smallint NOT NULL,
	"tag" text,
	"emails" text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_keywords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"location_code" integer NOT NULL,
	"language_code" text NOT NULL,
	"device" "device" NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_checked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rank_alert_events" ADD CONSTRAINT "rank_alert_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_alert_events" ADD CONSTRAINT "rank_alert_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_alert_events" ADD CONSTRAINT "rank_alert_events_alert_id_rank_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."rank_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_alert_events" ADD CONSTRAINT "rank_alert_events_tracked_keyword_id_tracked_keywords_id_fk" FOREIGN KEY ("tracked_keyword_id") REFERENCES "public"."tracked_keywords"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_alerts" ADD CONSTRAINT "rank_alerts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_alerts" ADD CONSTRAINT "rank_alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_alerts" ADD CONSTRAINT "rank_alerts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD CONSTRAINT "tracked_keywords_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD CONSTRAINT "tracked_keywords_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_keywords" ADD CONSTRAINT "tracked_keywords_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rank_alert_events_uidx" ON "rank_alert_events" USING btree ("alert_id","tracked_keyword_id","date");--> statement-breakpoint
CREATE INDEX "rank_alert_events_project_idx" ON "rank_alert_events" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "rank_alerts_project_idx" ON "rank_alerts" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_keywords_uidx" ON "tracked_keywords" USING btree ("project_id","keyword","location_code","language_code","device");--> statement-breakpoint
CREATE INDEX "tracked_keywords_org_idx" ON "tracked_keywords" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tracked_keywords_due_idx" ON "tracked_keywords" USING btree ("last_checked_at");