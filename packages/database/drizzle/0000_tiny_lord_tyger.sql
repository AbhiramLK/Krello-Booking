CREATE TYPE "public"."active_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."allocation_status" AS ENUM('held', 'confirmed', 'released');--> statement-breakpoint
CREATE TYPE "public"."booking_mode" AS ENUM('exclusive', 'shared');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('online', 'phone', 'walk_in', 'admin');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('pending', 'approved', 'rejected', 'expired', 'cancelled_by_customer', 'cancelled_by_business', 'completed', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."business_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('closed', 'custom_hours');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'manager', 'staff');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('visible', 'removed');--> statement-breakpoint
CREATE TYPE "public"."outbox_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('collection', 'refund');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'upi', 'card', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'partially_paid', 'paid');--> statement-breakpoint
CREATE TYPE "public"."price_unit" AS ENUM('per_hour', 'per_slot');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_type" AS ENUM('base', 'time_of_day', 'day_of_week', 'special_date', 'date_override');--> statement-breakpoint
CREATE TYPE "public"."submission_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'grace', 'expired');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('draft', 'pending_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "activity_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "active_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"business_id" uuid,
	"target_type" text NOT NULL,
	"target_id" text,
	"action" text NOT NULL,
	"before_snapshot" jsonb,
	"after_snapshot" jsonb,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_exclusive" boolean NOT NULL,
	"units" integer DEFAULT 1 NOT NULL,
	"allocation_status" "allocation_status" NOT NULL,
	"released_at" timestamp with time zone,
	"price_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "booking_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"from_status" "booking_status",
	"to_status" "booking_status" NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_reference" text NOT NULL,
	"status_token_hash" text NOT NULL,
	"status_token_revoked_at" timestamp with time zone,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"customer_name" text NOT NULL,
	"customer_phone" text,
	"customer_email" text,
	"customer_notes" text,
	"group_size" integer DEFAULT 1 NOT NULL,
	"source" "booking_source" NOT NULL,
	"status" "booking_status" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pending_expires_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" uuid,
	"internal_notes" text,
	"cancellation_reason" text,
	"rejection_reason" text,
	"price_snapshot" jsonb NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"total_amount" integer NOT NULL,
	"amount_collected" integer DEFAULT 0 NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_categories" (
	"business_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "business_categories_business_id_category_id_pk" PRIMARY KEY("business_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "business_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"location_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "active_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"contact_phone" text,
	"logo_url" text,
	"cover_url" text,
	"gallery_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amenities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verification_status" "verification_status" DEFAULT 'draft' NOT NULL,
	"is_listed" boolean DEFAULT true NOT NULL,
	"status" "business_status" DEFAULT 'active' NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "favourites" (
	"customer_user_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "favourites_customer_user_id_business_id_pk" PRIMARY KEY("customer_user_id","business_id")
);
--> statement-breakpoint
CREATE TABLE "location_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"opens_minute" integer NOT NULL,
	"closes_minute" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"address" text NOT NULL,
	"locality" text NOT NULL,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"postal_code" text NOT NULL,
	"country_code" text DEFAULT 'IN' NOT NULL,
	"phone" text,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"status" "active_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"business_id" uuid,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"business_id" uuid,
	"payload" jsonb NOT NULL,
	"status" "outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "payment_kind" DEFAULT 'collection' NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"method" "payment_method" NOT NULL,
	"reference" text,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by" uuid,
	"notes" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"resource_id" uuid,
	"rule_type" "pricing_rule_type" NOT NULL,
	"label" text,
	"days_of_week" jsonb,
	"date" date,
	"start_minute" integer,
	"end_minute" integer,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"status" "active_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"booking_id" uuid,
	"endpoint" text NOT NULL,
	"public_key" text NOT NULL,
	"auth_secret" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "resource_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid,
	"removed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resource_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"resource_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"opens_minute" integer NOT NULL,
	"closes_minute" integer NOT NULL,
	"slot_duration_minutes" integer NOT NULL,
	"slot_interval_minutes" integer NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"status" "active_status" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"name" text NOT NULL,
	"resource_type" text NOT NULL,
	"description" text,
	"booking_mode" "booking_mode" DEFAULT 'exclusive' NOT NULL,
	"capacity" integer DEFAULT 1 NOT NULL,
	"price_unit" "price_unit" DEFAULT 'per_hour' NOT NULL,
	"price_per_person" boolean DEFAULT false NOT NULL,
	"advance_days" integer DEFAULT 14 NOT NULL,
	"min_notice_minutes" integer DEFAULT 0 NOT NULL,
	"configuration" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "active_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"customer_user_id" uuid,
	"author_name" text NOT NULL,
	"rating" integer NOT NULL,
	"body" text,
	"moderation_status" "moderation_status" DEFAULT 'visible' NOT NULL,
	"moderation_reason" text,
	"reported_at" timestamp with time zone,
	"business_response" text,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"resource_id" uuid,
	"date" date NOT NULL,
	"exception_type" "exception_type" NOT NULL,
	"opens_minute" integer,
	"closes_minute" integer,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_payment_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"reference" text NOT NULL,
	"proof_url" text,
	"status" "submission_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_amount" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"billing_interval" text DEFAULT 'month' NOT NULL,
	"trial_eligible" boolean DEFAULT true NOT NULL,
	"limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"status" "active_status" DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" NOT NULL,
	"trial_starts_at" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"current_period_starts_at" timestamp with time zone,
	"current_period_ends_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"email" text,
	"name" text,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_verification_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"business_id" uuid NOT NULL,
	"owner_identity_url" text,
	"venue_photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"review_status" "submission_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"rejection_reason" text,
	"internal_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_allocations" ADD CONSTRAINT "booking_allocations_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_categories" ADD CONSTRAINT "business_categories_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_categories" ADD CONSTRAINT "business_categories_category_id_activity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."activity_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_memberships" ADD CONSTRAINT "business_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_hours" ADD CONSTRAINT "location_hours_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_hours" ADD CONSTRAINT "location_hours_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_blocks" ADD CONSTRAINT "resource_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_schedules" ADD CONSTRAINT "resource_schedules_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_schedules" ADD CONSTRAINT "resource_schedules_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_user_id_users_id_fk" FOREIGN KEY ("customer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment_submissions" ADD CONSTRAINT "subscription_payment_submissions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment_submissions" ADD CONSTRAINT "subscription_payment_submissions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment_submissions" ADD CONSTRAINT "subscription_payment_submissions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payment_submissions" ADD CONSTRAINT "subscription_payment_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_verification_submissions" ADD CONSTRAINT "business_verification_submissions_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_verification_submissions" ADD CONSTRAINT "business_verification_submissions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_uq" ON "activity_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "audit_business_idx" ON "audit_logs" USING btree ("business_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "allocations_resource_time_idx" ON "booking_allocations" USING btree ("resource_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "allocations_booking_idx" ON "booking_allocations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "status_history_booking_idx" ON "booking_status_history" USING btree ("booking_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_reference_uq" ON "bookings" USING btree ("public_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_token_uq" ON "bookings" USING btree ("status_token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_idem_uq" ON "bookings" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "bookings_business_time_idx" ON "bookings" USING btree ("business_id","location_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_status_idx" ON "bookings" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "bookings_pending_idx" ON "bookings" USING btree ("status","pending_expires_at");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_user_id");--> statement-breakpoint
CREATE INDEX "bookings_phone_idx" ON "bookings" USING btree ("customer_phone");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_uq" ON "business_memberships" USING btree ("business_id","user_id");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "business_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_slug_uq" ON "businesses" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "businesses_owner_idx" ON "businesses" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "location_hours_idx" ON "location_hours" USING btree ("location_id","day_of_week");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_slug_uq" ON "locations" USING btree ("business_id","slug");--> statement-breakpoint
CREATE INDEX "locations_city_idx" ON "locations" USING btree ("city","locality");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_user_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_phone_idx" ON "otp_challenges" USING btree ("phone","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "payments_business_time_idx" ON "payments" USING btree ("business_id","collected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idem_uq" ON "payments" USING btree ("business_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "pricing_rules_idx" ON "pricing_rules" USING btree ("location_id","resource_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_uq" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "resource_blocks_idx" ON "resource_blocks" USING btree ("resource_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "resource_schedules_idx" ON "resource_schedules" USING btree ("resource_id","day_of_week");--> statement-breakpoint
CREATE INDEX "resources_location_idx" ON "resources" USING btree ("business_id","location_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_uq" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_business_idx" ON "reviews" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "schedule_exceptions_idx" ON "schedule_exceptions" USING btree ("location_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sub_payments_status_idx" ON "subscription_payment_submissions" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_business_uq" ON "subscriptions" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "verif_business_idx" ON "business_verification_submissions" USING btree ("business_id");