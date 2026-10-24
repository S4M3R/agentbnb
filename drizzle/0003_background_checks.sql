CREATE TYPE "public"."background_check_status" AS ENUM('running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."background_check_verdict" AS ENUM('consistent', 'some_gaps', 'red_flags');--> statement-breakpoint
CREATE TYPE "public"."finding_category" AS ENUM('identity', 'reputation', 'presence', 'red_flag');--> statement-breakpoint
CREATE TYPE "public"."finding_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('new', 'replied', 'accepted', 'declined', 'expired', 'withdrawn');--> statement-breakpoint
CREATE TABLE "background_check_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"check_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_check_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"check_id" uuid NOT NULL,
	"category" "finding_category" NOT NULL,
	"title" text NOT NULL,
	"detail" text,
	"source_url" text,
	"source_title" text,
	"confidence" "finding_confidence" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "background_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"guest_user_id" uuid,
	"status" "background_check_status" DEFAULT 'running' NOT NULL,
	"verdict" "background_check_verdict",
	"summary" text,
	"profile" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"questions" text[] DEFAULT '{}'::text[] NOT NULL,
	"unverified" text[] DEFAULT '{}'::text[] NOT NULL,
	"model" text,
	"steps" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incoming_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_user_id" uuid NOT NULL,
	"listing_id" uuid,
	"source_id" text NOT NULL,
	"application_id" uuid,
	"guest_user_id" uuid,
	"external_ref" text,
	"external_url" text,
	"guest" jsonb NOT NULL,
	"message" text,
	"start_date" date,
	"end_date" date,
	"guest_count" integer,
	"status" "request_status" DEFAULT 'new' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incoming_requests_application_id_unique" UNIQUE("application_id")
);
--> statement-breakpoint
ALTER TABLE "background_check_events" ADD CONSTRAINT "background_check_events_check_id_background_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."background_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_check_findings" ADD CONSTRAINT "background_check_findings_check_id_background_checks_id_fk" FOREIGN KEY ("check_id") REFERENCES "public"."background_checks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_request_id_incoming_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."incoming_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_checks" ADD CONSTRAINT "background_checks_guest_user_id_users_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_requests" ADD CONSTRAINT "incoming_requests_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_requests" ADD CONSTRAINT "incoming_requests_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_requests" ADD CONSTRAINT "incoming_requests_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_requests" ADD CONSTRAINT "incoming_requests_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incoming_requests" ADD CONSTRAINT "incoming_requests_guest_user_id_users_id_fk" FOREIGN KEY ("guest_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "background_check_events_check_idx" ON "background_check_events" USING btree ("check_id","created_at");--> statement-breakpoint
CREATE INDEX "background_check_findings_check_idx" ON "background_check_findings" USING btree ("check_id","created_at");--> statement-breakpoint
CREATE INDEX "background_checks_request_idx" ON "background_checks" USING btree ("request_id","started_at");--> statement-breakpoint
CREATE INDEX "background_checks_guest_idx" ON "background_checks" USING btree ("guest_user_id");--> statement-breakpoint
CREATE INDEX "background_checks_expires_idx" ON "background_checks" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "incoming_requests_host_idx" ON "incoming_requests" USING btree ("host_user_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incoming_requests_host_source_ref_idx" ON "incoming_requests" USING btree ("host_user_id","source_id","external_ref");