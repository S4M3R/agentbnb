CREATE TYPE "public"."keychain_created_by" AS ENUM('person', 'agent');--> statement-breakpoint
CREATE TYPE "public"."keychain_status" AS ENUM('active', 'unverified', 'failed');--> statement-breakpoint
CREATE TABLE "keychain_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"site" text NOT NULL,
	"source_id" text,
	"domain" text,
	"login" text NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"created_by" "keychain_created_by" DEFAULT 'person' NOT NULL,
	"status" "keychain_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "keychain_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"allow_sign_up" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "keychain_entries" ADD CONSTRAINT "keychain_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keychain_entries" ADD CONSTRAINT "keychain_entries_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "keychain_settings" ADD CONSTRAINT "keychain_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "keychain_entries_user_site_idx" ON "keychain_entries" USING btree ("user_id","site");