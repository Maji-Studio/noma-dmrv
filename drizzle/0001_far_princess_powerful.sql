CREATE TABLE "test_table" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_gps_latitude_range" CHECK ("feedstocks"."gps_latitude" is null or ("feedstocks"."gps_latitude" >= -90 and "feedstocks"."gps_latitude" <= 90));--> statement-breakpoint
ALTER TABLE "feedstocks" ADD CONSTRAINT "feedstocks_gps_longitude_range" CHECK ("feedstocks"."gps_longitude" is null or ("feedstocks"."gps_longitude" >= -180 and "feedstocks"."gps_longitude" <= 180));