ALTER TABLE "production_processes" ADD CONSTRAINT "production_processes_method_b_prereqs_chk" CHECK ("production_processes"."sampling_method" <> 'method_b' OR (
        "production_processes"."method_b_unlocked_at" IS NOT NULL
        AND "production_processes"."agreed_baseline_size" IS NOT NULL
        AND "production_processes"."random_sampling_plan_ref" IS NOT NULL
        AND btrim("production_processes"."random_sampling_plan_ref") <> ''
        AND "production_processes"."moisture_pathway" IS NOT NULL
      ));