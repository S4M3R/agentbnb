CREATE TYPE "public"."publication_status" AS ENUM('queued', 'running', 'needs_user', 'live', 'failed', 'removed');--> statement-breakpoint
ALTER TYPE "public"."listing_status" ADD VALUE 'draft' BEFORE 'active';--> statement-breakpoint
CREATE TABLE "listing_publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"status" "publication_status" DEFAULT 'queued' NOT NULL,
	"status_message" text,
	"external_url" text,
	"browser_session_id" text,
	"live_view_url" text,
	"user_acted_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listing_publications" ADD CONSTRAINT "listing_publications_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_publications" ADD CONSTRAINT "listing_publications_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "listing_publications_listing_source_idx" ON "listing_publications" USING btree ("listing_id","source_id");