ALTER TABLE "receipt_exports" ALTER COLUMN "organization_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE receipt_exports ADD CONSTRAINT receipt_export_scope CHECK (
  (organization_id IS NOT NULL AND snapshot_json->>'version'='1' AND snapshot_json->>'organizationId'=organization_id::text)
  OR (organization_id IS NULL AND snapshot_json->>'version'='2' AND snapshot_json->'organizationId'='null'::jsonb)
);
