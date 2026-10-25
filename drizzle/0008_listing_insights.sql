CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "listing_insights" (
	"listing_id" uuid PRIMARY KEY NOT NULL,
	"summary" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"features" jsonb NOT NULL,
	"photo_notes" jsonb,
	"photo_status" text NOT NULL,
	"quality" real NOT NULL,
	"embedding" vector(1536),
	"embedding_text" text,
	"model" text NOT NULL,
	"content_hash" text NOT NULL,
	"usage" jsonb,
	"analyzed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listing_insights" ADD CONSTRAINT "listing_insights_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_insights_embedding_idx" ON "listing_insights" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "listing_insights_tags_idx" ON "listing_insights" USING gin ("tags");
