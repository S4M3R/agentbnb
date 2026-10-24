CREATE TYPE "public"."account_status" AS ENUM('pending', 'connected', 'needs_reauth', 'disconnected');--> statement-breakpoint
CREATE TYPE "public"."application_channel" AS ENUM('internal', 'external_auto', 'external_manual');--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('draft', 'sent', 'accepted', 'declined', 'scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."availability_kind" AS ENUM('available', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'paused', 'gone');--> statement-breakpoint
CREATE TYPE "public"."listing_type" AS ENUM('couch', 'private_room', 'shared_room', 'entire_place', 'house_sit', 'work_exchange', 'farm_stay');--> statement-breakpoint
CREATE TYPE "public"."location_precision" AS ENUM('exact', 'approximate', 'neighborhood', 'city');--> statement-breakpoint
CREATE TYPE "public"."price_model" AS ENUM('free', 'exchange', 'paid');--> statement-breakpoint
CREATE TYPE "public"."scrape_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_access" AS ENUM('internal', 'public', 'login', 'partner_api');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('internal', 'couch', 'house_sit', 'work_exchange', 'farm_stay', 'home_swap');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"availability_id" uuid,
	"start_date" date,
	"end_date" date,
	"intro" text,
	"channel" "application_channel" NOT NULL,
	"status" "application_status" DEFAULT 'draft' NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_hosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text NOT NULL,
	"display_name" text,
	"profile_url" text,
	"avatar_url" text,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"reference_count" integer,
	"rating" real,
	"member_since" timestamp with time zone,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"external_id" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"kind" "availability_kind" DEFAULT 'available' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listing_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"url" text NOT NULL,
	"source_url" text,
	"blob_pathname" text,
	"position" integer DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"caption" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"external_id" text,
	"external_url" text,
	"host_user_id" uuid,
	"external_host_id" uuid,
	"type" "listing_type" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"guest_expectations" text,
	"house_rules" text,
	"market" text,
	"neighborhood" text,
	"city" text,
	"subregion" text,
	"region" text,
	"country_code" text,
	"lat" double precision,
	"lng" double precision,
	"location_precision" "location_precision",
	"address" text,
	"max_guests" integer,
	"min_nights" integer,
	"max_nights" integer,
	"price_model" "price_model" DEFAULT 'free' NOT NULL,
	"price_amount_cents" integer,
	"currency" text,
	"amenities" text[] DEFAULT '{}'::text[] NOT NULL,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rating" real,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"raw" jsonb,
	"content_hash" text,
	"first_seen_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"last_scraped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" text NOT NULL,
	"market" text,
	"status" "scrape_run_status" DEFAULT 'running' NOT NULL,
	"listings_found" integer DEFAULT 0 NOT NULL,
	"listings_created" integer DEFAULT 0 NOT NULL,
	"listings_updated" integer DEFAULT 0 NOT NULL,
	"listings_gone" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "source_kind" NOT NULL,
	"access" "source_access" NOT NULL,
	"base_url" text,
	"tos_notes" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_source_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"external_username" text,
	"status" "account_status" DEFAULT 'pending' NOT NULL,
	"credential_ref" text,
	"connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"home_city" text,
	"languages" text[] DEFAULT '{}'::text[] NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_availability_id_listing_availability_id_fk" FOREIGN KEY ("availability_id") REFERENCES "public"."listing_availability"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_hosts" ADD CONSTRAINT "external_hosts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_availability" ADD CONSTRAINT "listing_availability_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_photos" ADD CONSTRAINT "listing_photos_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_host_user_id_users_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_external_host_id_external_hosts_id_fk" FOREIGN KEY ("external_host_id") REFERENCES "public"."external_hosts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_source_accounts" ADD CONSTRAINT "user_source_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_source_accounts" ADD CONSTRAINT "user_source_accounts_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_user_idx" ON "applications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "applications_listing_idx" ON "applications" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_hosts_source_external_idx" ON "external_hosts" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "listing_availability_listing_idx" ON "listing_availability" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "listing_availability_dates_idx" ON "listing_availability" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "listing_photos_listing_idx" ON "listing_photos" USING btree ("listing_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_source_external_idx" ON "listings" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "listings_market_status_idx" ON "listings" USING btree ("market","status");--> statement-breakpoint
CREATE INDEX "listings_city_idx" ON "listings" USING btree ("city");--> statement-breakpoint
CREATE INDEX "listings_lat_lng_idx" ON "listings" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "listings_host_user_idx" ON "listings" USING btree ("host_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_source_accounts_user_source_idx" ON "user_source_accounts" USING btree ("user_id","source_id");