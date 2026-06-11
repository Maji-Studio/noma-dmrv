CREATE TABLE "geo_route_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile" text NOT NULL,
	"origin_lat" double precision NOT NULL,
	"origin_lng" double precision NOT NULL,
	"destination_lat" double precision NOT NULL,
	"destination_lng" double precision NOT NULL,
	"coordinates" jsonb NOT NULL,
	"distance_km" real NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "geo_route_cache_key_idx" ON "geo_route_cache" USING btree ("profile","origin_lat","origin_lng","destination_lat","destination_lng");