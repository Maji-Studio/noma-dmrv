DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM deliveries d
		INNER JOIN orders o ON o.id = d.order_id AND o.organization_id = d.organization_id
		WHERE d.customer_location_id IS NOT NULL
			AND d.customer_location_id IS DISTINCT FROM o.customer_location_id
	) THEN
		RAISE EXCEPTION 'Cannot drop delivery destination: existing deliveries differ from their order destination. Pre-production: reset the database, see docs/database.md.';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM deliveries d
		WHERE d.biochar_product_id IS NOT NULL
			AND NOT EXISTS (
				SELECT 1
				FROM output_stock_allocations a
				WHERE a.delivery_id = d.id AND a.organization_id = d.organization_id
					AND a.biochar_product_id = d.biochar_product_id
			)
	) THEN
		RAISE EXCEPTION 'Cannot drop delivery product: existing products are absent from delivery allocations. Pre-production: reset the database, see docs/database.md.';
	END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_customer_location_id_customer_locations_id_fk";
--> statement-breakpoint
ALTER TABLE "deliveries" DROP CONSTRAINT "deliveries_biochar_product_id_biochar_products_id_fk";
--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "customer_location_id";--> statement-breakpoint
ALTER TABLE "deliveries" DROP COLUMN "biochar_product_id";
