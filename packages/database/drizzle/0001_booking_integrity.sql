-- Integrity rules that the ORM schema cannot express.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- No two active allocations of an exclusive resource may overlap in time.
-- Half-open ranges, so back-to-back slots do not conflict.
ALTER TABLE "booking_allocations"
  ADD CONSTRAINT "allocations_no_overlap"
  EXCLUDE USING gist (
    "resource_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("allocation_status" IN ('held', 'confirmed') AND "is_exclusive");
--> statement-breakpoint
ALTER TABLE "booking_allocations" ADD CONSTRAINT "allocations_time_order" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "booking_allocations" ADD CONSTRAINT "allocations_units_positive" CHECK ("units" > 0);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_time_order" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_total_nonneg" CHECK ("total_amount" >= 0);
--> statement-breakpoint
-- Collections may never exceed the booking amount, and never go negative.
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_collected_range"
  CHECK ("amount_collected" >= 0 AND "amount_collected" <= "total_amount");
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_group_positive" CHECK ("group_size" > 0);
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_range" CHECK ("rating" BETWEEN 1 AND 5);
--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "blocks_time_order" CHECK ("ends_at" > "starts_at");
--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_capacity_positive" CHECK ("capacity" > 0);
--> statement-breakpoint
ALTER TABLE "resource_schedules" ADD CONSTRAINT "schedules_valid"
  CHECK ("closes_minute" > "opens_minute" AND "slot_duration_minutes" > 0 AND "slot_interval_minutes" > 0
         AND "day_of_week" BETWEEN 0 AND 6);
--> statement-breakpoint
-- Audit rows are append-only for ordinary database roles.
CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();
