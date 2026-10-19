DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM certification_submissions WHERE submission_type = 'dataUpload') THEN
		RAISE EXCEPTION 'Cannot remove reactor telemetry upload: dataUpload submissions exist';
	END IF;
END $$;--> statement-breakpoint
DROP TABLE "certifier_sensors" CASCADE;
