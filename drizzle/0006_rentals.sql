CREATE TYPE "public"."price_period" AS ENUM('night', 'week', 'month', 'stay');--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'rental';--> statement-breakpoint
ALTER TYPE "public"."source_kind" ADD VALUE 'hostel';--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "price_period" "price_period";