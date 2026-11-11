import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Conventions
 * - Money is stored as integer paise (1 INR = 100 paise).
 * - Instants are `timestamptz` in UTC. Wall-clock schedule values are stored as
 *   minutes from local midnight; a closing value above 1440 runs past midnight.
 * - Every tenant-owned table carries `business_id`.
 */

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export const userStatus = pgEnum("user_status", ["active", "suspended"]);
export const verificationStatus = pgEnum("verification_status", [
  "draft",
  "pending_review",
  "approved",
  "rejected",
]);
export const businessStatus = pgEnum("business_status", ["active", "suspended"]);
export const memberRole = pgEnum("member_role", ["owner", "manager", "staff"]);
export const activeStatus = pgEnum("active_status", ["active", "inactive"]);
export const bookingMode = pgEnum("booking_mode", ["exclusive", "shared"]);
export const priceUnit = pgEnum("price_unit", ["per_hour", "per_slot"]);
export const exceptionType = pgEnum("exception_type", ["closed", "custom_hours"]);
export const pricingRuleType = pgEnum("pricing_rule_type", [
  "base",
  "time_of_day",
  "day_of_week",
  "special_date",
  "date_override",
]);
export const bookingStatus = pgEnum("booking_status", [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled_by_customer",
  "cancelled_by_business",
  "completed",
  "no_show",
]);
export const bookingSource = pgEnum("booking_source", ["online", "phone", "walk_in", "admin"]);
export const allocationStatus = pgEnum("allocation_status", ["held", "confirmed", "released"]);
export const paymentMethod = pgEnum("payment_method", ["cash", "upi", "card", "other"]);
export const paymentKind = pgEnum("payment_kind", ["collection", "refund"]);
export const paymentStatus = pgEnum("payment_status", ["unpaid", "partially_paid", "paid"]);
export const moderationStatus = pgEnum("moderation_status", ["visible", "removed"]);
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "grace",
  "expired",
]);
export const submissionStatus = pgEnum("submission_status", ["pending", "verified", "rejected"]);
export const outboxStatus = pgEnum("outbox_status", ["pending", "done", "failed"]);

/* ---------- identity ---------- */

export const users = pgTable(
  "users",
  {
    id: id(),
    phone: text("phone").notNull(),
    phoneVerifiedAt: ts("phone_verified_at"),
    email: text("email"),
    name: text("name"),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    status: userStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_phone_uq").on(t.phone)],
);

export const otpChallenges = pgTable(
  "otp_challenges",
  {
    id: id(),
    phone: text("phone").notNull(),
    codeHash: text("code_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("otp_phone_idx").on(t.phone, t.createdAt)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/* ---------- tenants ---------- */

export const activityCategories = pgTable(
  "activity_categories",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    status: activeStatus("status").notNull().default("active"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_slug_uq").on(t.slug)],
);

export const businesses = pgTable(
  "businesses",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    contactPhone: text("contact_phone"),
    logoUrl: text("logo_url"),
    coverUrl: text("cover_url"),
    galleryUrls: jsonb("gallery_urls").$type<string[]>().notNull().default([]),
    amenities: jsonb("amenities").$type<string[]>().notNull().default([]),
    verificationStatus: verificationStatus("verification_status").notNull().default("draft"),
    /** Owner's switch for the public listing. The listing is only live when the
     * business is also approved, active and has a usable subscription. */
    isListed: boolean("is_listed").notNull().default(true),
    status: businessStatus("status").notNull().default("active"),
    /** Booking rules, see BusinessPolicy in booking-engine. */
    policy: jsonb("policy").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("businesses_slug_uq").on(t.slug), index("businesses_owner_idx").on(t.ownerUserId)],
);

export const businessCategories = pgTable(
  "business_categories",
  {
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => activityCategories.id),
  },
  (t) => [primaryKey({ columns: [t.businessId, t.categoryId] })],
);

export const verificationSubmissions = pgTable(
  "business_verification_submissions",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    ownerIdentityUrl: text("owner_identity_url"),
    venuePhotoUrls: jsonb("venue_photo_urls").$type<string[]>().notNull().default([]),
    reviewStatus: submissionStatus("review_status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    internalNote: text("internal_note"),
    createdAt: createdAt(),
  },
  (t) => [index("verif_business_idx").on(t.businessId)],
);

export const businessMemberships = pgTable(
  "business_memberships",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: memberRole("role").notNull(),
    /** Empty means every location. */
    locationIds: jsonb("location_ids").$type<string[]>().notNull().default([]),
    status: activeStatus("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("membership_uq").on(t.businessId, t.userId), index("membership_user_idx").on(t.userId)],
);

export const locations = pgTable(
  "locations",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    address: text("address").notNull(),
    locality: text("locality").notNull(),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    countryCode: text("country_code").notNull().default("IN"),
    phone: text("phone"),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    status: activeStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("locations_slug_uq").on(t.businessId, t.slug),
    index("locations_city_idx").on(t.city, t.locality),
  ],
);

/** Weekly opening hours of a location. Several rows per day are allowed. */
export const locationHours = pgTable(
  "location_hours",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    dayOfWeek: integer("day_of_week").notNull(), // 0 = Sunday
    opensMinute: integer("opens_minute").notNull(),
    closesMinute: integer("closes_minute").notNull(),
  },
  (t) => [index("location_hours_idx").on(t.locationId, t.dayOfWeek)],
);

/* ---------- resources and schedules ---------- */

export const resources = pgTable(
  "resources",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    name: text("name").notNull(),
    resourceType: text("resource_type").notNull(),
    description: text("description"),
    /** exclusive: one booking per slot. shared: `capacity` places per slot. */
    bookingMode: bookingMode("booking_mode").notNull().default("exclusive"),
    capacity: integer("capacity").notNull().default(1),
    priceUnit: priceUnit("price_unit").notNull().default("per_hour"),
    pricePerPerson: boolean("price_per_person").notNull().default(false),
    /** How many days ahead customers may book. */
    advanceDays: integer("advance_days").notNull().default(14),
    /** Minimum notice before a slot starts, in minutes. */
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(0),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull().default({}),
    sortOrder: integer("sort_order").notNull().default(0),
    status: activeStatus("status").notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("resources_location_idx").on(t.businessId, t.locationId, t.status)],
);

/** Weekly slot-generating windows. A gap between two rows is a break. */
export const resourceSchedules = pgTable(
  "resource_schedules",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    dayOfWeek: integer("day_of_week").notNull(),
    opensMinute: integer("opens_minute").notNull(),
    closesMinute: integer("closes_minute").notNull(),
    slotDurationMinutes: integer("slot_duration_minutes").notNull(),
    slotIntervalMinutes: integer("slot_interval_minutes").notNull(),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    status: activeStatus("status").notNull().default("active"),
  },
  (t) => [index("resource_schedules_idx").on(t.resourceId, t.dayOfWeek)],
);

/** A dated exception. With `resource_id` null it applies to the whole location. */
export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    resourceId: uuid("resource_id").references(() => resources.id),
    date: date("date").notNull(),
    exceptionType: exceptionType("exception_type").notNull(),
    opensMinute: integer("opens_minute"),
    closesMinute: integer("closes_minute"),
    reason: text("reason"),
  },
  (t) => [index("schedule_exceptions_idx").on(t.locationId, t.date)],
);

export const resourceBlocks = pgTable(
  "resource_blocks",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by").references(() => users.id),
    removedAt: ts("removed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("resource_blocks_idx").on(t.resourceId, t.startsAt, t.endsAt)],
);

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    /** Null means a location-wide default. */
    resourceId: uuid("resource_id").references(() => resources.id),
    ruleType: pricingRuleType("rule_type").notNull(),
    label: text("label"),
    daysOfWeek: jsonb("days_of_week").$type<number[] | null>(),
    date: date("date"),
    startMinute: integer("start_minute"),
    endMinute: integer("end_minute"),
    /** Paise per price unit of the resource. */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    priority: integer("priority").notNull().default(0),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    status: activeStatus("status").notNull().default("active"),
  },
  (t) => [index("pricing_rules_idx").on(t.locationId, t.resourceId, t.status)],
);

/* ---------- bookings ---------- */

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    publicReference: text("public_reference").notNull(),
    /** SHA-256 of the guest status-link token. */
    statusTokenHash: text("status_token_hash").notNull(),
    statusTokenRevokedAt: ts("status_token_revoked_at"),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    customerUserId: uuid("customer_user_id").references(() => users.id),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    customerNotes: text("customer_notes"),
    groupSize: integer("group_size").notNull().default(1),
    source: bookingSource("source").notNull(),
    status: bookingStatus("status").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    pendingExpiresAt: ts("pending_expires_at"),
    approvedAt: ts("approved_at"),
    rejectedAt: ts("rejected_at"),
    cancelledAt: ts("cancelled_at"),
    completedAt: ts("completed_at"),
    createdBy: uuid("created_by").references(() => users.id),
    internalNotes: text("internal_notes"),
    cancellationReason: text("cancellation_reason"),
    rejectionReason: text("rejection_reason"),
    priceSnapshot: jsonb("price_snapshot").$type<unknown>().notNull(),
    currency: text("currency").notNull().default("INR"),
    totalAmount: integer("total_amount").notNull(),
    /** Net of collections minus refunds; maintained with the payment ledger. */
    amountCollected: integer("amount_collected").notNull().default(0),
    paymentStatus: paymentStatus("payment_status").notNull().default("unpaid"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("bookings_reference_uq").on(t.publicReference),
    uniqueIndex("bookings_token_uq").on(t.statusTokenHash),
    uniqueIndex("bookings_idem_uq").on(t.businessId, t.idempotencyKey),
    index("bookings_business_time_idx").on(t.businessId, t.locationId, t.startsAt),
    index("bookings_status_idx").on(t.businessId, t.status),
    index("bookings_pending_idx").on(t.status, t.pendingExpiresAt),
    index("bookings_customer_idx").on(t.customerUserId),
    index("bookings_phone_idx").on(t.customerPhone),
  ],
);

/**
 * One row per resource per booking. Conflicts between active exclusive
 * allocations are prevented by an exclusion constraint added in a custom
 * migration (see drizzle/*_booking_integrity.sql).
 */
export const bookingAllocations = pgTable(
  "booking_allocations",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => resources.id),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    /** Copied from the resource at booking time; drives the constraint. */
    isExclusive: boolean("is_exclusive").notNull(),
    /** Places taken on a shared resource; 1 for exclusive resources. */
    units: integer("units").notNull().default(1),
    status: allocationStatus("allocation_status").notNull(),
    releasedAt: ts("released_at"),
    priceSnapshot: jsonb("price_snapshot").$type<unknown>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("allocations_resource_time_idx").on(t.resourceId, t.startsAt, t.endsAt),
    index("allocations_booking_idx").on(t.bookingId),
  ],
);

export const bookingStatusHistory = pgTable(
  "booking_status_history",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    fromStatus: bookingStatus("from_status"),
    toStatus: bookingStatus("to_status").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorKind: text("actor_kind").notNull(), // customer | business | system | admin
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [index("status_history_booking_idx").on(t.bookingId, t.createdAt)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    kind: paymentKind("kind").notNull().default("collection"),
    /** Always positive; `kind` says whether it adds or subtracts. */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("INR"),
    method: paymentMethod("method").notNull(),
    reference: text("reference"),
    collectedAt: ts("collected_at").notNull().defaultNow(),
    recordedBy: uuid("recorded_by").references(() => users.id),
    notes: text("notes"),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("payments_booking_idx").on(t.bookingId),
    index("payments_business_time_idx").on(t.businessId, t.collectedAt),
    uniqueIndex("payments_idem_uq").on(t.businessId, t.idempotencyKey),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: id(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    customerUserId: uuid("customer_user_id").references(() => users.id),
    authorName: text("author_name").notNull(),
    rating: integer("rating").notNull(),
    body: text("body"),
    moderationStatus: moderationStatus("moderation_status").notNull().default("visible"),
    moderationReason: text("moderation_reason"),
    reportedAt: ts("reported_at"),
    businessResponse: text("business_response"),
    respondedAt: ts("responded_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("reviews_booking_uq").on(t.bookingId), index("reviews_business_idx").on(t.businessId)],
);

export const favourites = pgTable(
  "favourites",
  {
    customerUserId: uuid("customer_user_id")
      .notNull()
      .references(() => users.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.customerUserId, t.businessId] })],
);

/* ---------- subscriptions ---------- */

export const subscriptionPlans = pgTable("subscription_plans", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  priceAmount: integer("price_amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  billingInterval: text("billing_interval").notNull().default("month"),
  trialEligible: boolean("trial_eligible").notNull().default(true),
  /** { locations, resources, staff, bookingsPerMonth } — null means unlimited. */
  limits: jsonb("limits").$type<Record<string, number | null>>().notNull().default({}),
  features: jsonb("features").$type<Record<string, boolean>>().notNull().default({}),
  isPublic: boolean("is_public").notNull().default(true),
  status: activeStatus("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    status: subscriptionStatus("status").notNull(),
    trialStartsAt: ts("trial_starts_at"),
    trialEndsAt: ts("trial_ends_at"),
    currentPeriodStartsAt: ts("current_period_starts_at"),
    currentPeriodEndsAt: ts("current_period_ends_at"),
    graceEndsAt: ts("grace_ends_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("subscriptions_business_uq").on(t.businessId)],
);

export const subscriptionPaymentSubmissions = pgTable(
  "subscription_payment_submissions",
  {
    id: id(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    amount: integer("amount").notNull(),
    reference: text("reference").notNull(),
    proofUrl: text("proof_url"),
    status: submissionStatus("status").notNull().default("pending"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: createdAt(),
  },
  (t) => [index("sub_payments_status_idx").on(t.status, t.createdAt)],
);

/* ---------- notifications, audit, settings ---------- */

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    recipientUserId: uuid("recipient_user_id")
      .notNull()
      .references(() => users.id),
    businessId: uuid("business_id").references(() => businesses.id),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    link: text("link"),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientUserId, t.createdAt)],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    /** Set for guests who subscribe from a booking status page. */
    bookingId: uuid("booking_id").references(() => bookings.id),
    endpoint: text("endpoint").notNull(),
    publicKey: text("public_key").notNull(),
    authSecret: text("auth_secret").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("push_endpoint_uq").on(t.endpoint)],
);

/** Transactional outbox: written in the same transaction as the change. */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: id(),
    eventType: text("event_type").notNull(),
    businessId: uuid("business_id").references(() => businesses.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: outboxStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    availableAt: ts("available_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_pending_idx").on(t.status, t.availableAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorKind: text("actor_kind").notNull(),
    businessId: uuid("business_id").references(() => businesses.id),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    action: text("action").notNull(),
    before: jsonb("before_snapshot").$type<unknown>(),
    after: jsonb("after_snapshot").$type<unknown>(),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_business_idx").on(t.businessId, t.createdAt),
    index("audit_target_idx").on(t.targetType, t.targetId),
  ],
);

export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: ts("window_start").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
