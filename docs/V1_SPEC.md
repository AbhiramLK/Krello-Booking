# Activity Booking SaaS --- Product Requirements \& Technical Specification

**Document status:** V1 product specification --- discovery baseline  
**Working product name:**Krello  
**Version:** 1.0-draft  
**Date:** 12 November 2026  
**Initial market:** Local businesses in India; designed to scale
nationally  
**Platform:** Web only  
**Currency and language:** INR (₹), English  
**Primary commercial model:** Monthly SaaS subscription paid by
businesses

> \*\*Purpose:\*\* This document is the primary product and engineering
> reference for the V1 of a multi-tenant booking platform serving
> recreational activity businesses. It consolidates decisions made
> during product discovery, proposes an implementation approach, and
> explicitly identifies unresolved decisions. Where a requirement is not
> fully settled, it is marked as a proposal or open decision rather than
> silently treated as confirmed.

\---

# 1\. Executive summary

The product is a web-based, multi-tenant SaaS platform for businesses
that sell access to bookable activities, facilities, equipment, or time
slots. Initial target businesses include pool and snooker halls,
football turfs, gaming lounges, swimming pools, and similar local
recreational venues.

Today, many such businesses manage reservations through phone calls,
walk-ins, and informal messaging. Customers cannot reliably see current
availability or know whether a slot is still available without
contacting the venue. Businesses also struggle to keep online enquiries,
calls, walk-ins, cancellations, and resource schedules synchronised.

The platform provides a shared booking engine with three connected
interfaces:

1. **Customer marketplace and booking experience** --- customers
discover venues, view services and prices, check availability,
submit booking requests, and track their booking status.
2. **Business management dashboard** --- owners and staff manage
locations, resources, schedules, prices, booking requests, offline
bookings, payments collected at the venue, reviews, and analytics.
3. **Platform super-admin dashboard** --- the platform operator
verifies businesses, manages tenants and subscriptions, configures
plans and categories, and monitors the overall platform.

The product is a hybrid: a central marketplace with individual business
pages hosted under the platform domain. Example:
`platform.example/arena-football`.

## 1.1 Product principles

* Web-first: no native Android or iOS application is part of V1.
* One shared booking engine: online, phone, and walk-in bookings must
use the same availability and reservation rules.
* Flexible resource model: the platform must not hardcode a separate
booking system for each activity category.
* Fixed-slot scheduling: businesses configure slot duration and
intervals; customers select from generated slots.
* Approval-based reservations: a customer submits a request; the
business approves or rejects it.
* Reliable inventory: a resource and time slot cannot be
double-booked.
* Low operating cost: prefer free tiers and low-cost managed services
where they meet reliability and security needs.
* National-scale foundations: launch locally, but avoid architectural
choices that prevent national expansion.
* Configurable operations: business-specific rules should be
data/configuration-driven wherever practical.
* Auditability: important booking, payment, staff, and administrative
actions must be traceable.

## 1.2 Product goals

* Make venue availability visible online without requiring a customer
to call.
* Let customers request bookings directly from the web.
* Give businesses a single operational calendar for online and offline
bookings.
* Reduce double bookings and manual coordination.
* Help owners understand bookings, utilisation, and money collected.
* Provide a repeatable SaaS onboarding and subscription model.
* Create a foundation that can support multiple activity categories
and multiple business locations.

## 1.3 Non-goals for V1

* Native mobile applications.
* Online customer payment collection or payment gateway checkout.
* Map-based marketplace discovery.
* WhatsApp or email notification workflows.
* Customer-uploaded review photographs.
* Dynamic customer-selected start times; V1 uses fixed slots.
* Automated call-centre functionality or in-platform voice calling.
* Full accounting, tax filing, payroll, or inventory management.
* Public API access for third-party developers unless separately
approved.

\---

# 2\. Product structure and terminology

## 2.1 Three product surfaces

### A. Customer marketplace

The public website where customers can: - Search by location, locality,
activity category, or venue name. - Browse and filter business
listings. - View venue information, facilities, prices, opening hours,
and bookable resources. - Select a date and available fixed slot. -
Submit a booking request after phone OTP verification. - Track pending,
approved, rejected, cancelled, and completed bookings. - Create an
account or use guest checkout. - Manage favourites, profile details, and
booking history. - Review eligible completed bookings.

### B. Business dashboard

A tenant-scoped dashboard for business owners, managers, and staff. It
supports: - Business and location profile management. - Resource
configuration. - Operating hours, slot generation, and pricing. - Online
booking request review. - Phone and walk-in booking entry. - Temporary
resource blocks. - Customer and booking records. - Venue payment
collection records. - Staff management and role permissions. - Reviews
and business responses. - Business-level analytics.

### C. Platform super-admin

A restricted platform-operator interface for: - Business application
review and verification. - Tenant activation, suspension, and status
management. - Subscription plan configuration and assignment. - Manual
subscription payment verification. - Platform-wide booking and tenant
monitoring. - Activity category management. - Platform-level
configuration and audit review.

## 2.2 Core terms

\---

Term                                Meaning

\---

Platform                            The SaaS product and its shared
infrastructure

Tenant / Business                   A business account using the SaaS

Location                            A physical venue or branch operated
by a business

Resource                            A bookable unit, such as a pool
table, turf, PC, console, lane, or
session capacity

Slot                                A fixed start/end interval
generated from a resource schedule

Booking request                     A customer's request to reserve one
or more resources

Booking                             The reservation record and its
overall lifecycle

Allocation                          The reservation of a particular
resource for a particular time
interval

Pending hold                        Temporary inventory lock while a
booking awaits business approval

Block                               A period when a resource cannot be
booked, e.g. maintenance

Tenant user                         Owner, manager, or staff member
working for a business

Customer                            A person requesting or making a
booking

## Super-admin                         An authorised platform operator

\---

# 3\. Users, roles, and permissions

## 3.1 Customer roles

### Guest customer

* Can browse public listings and availability.
* Can submit a booking request after OTP verification.
* Can access booking status using a secure booking link or
verification flow.
* Can cancel where business policy permits.
* Can optionally create an account.

### Registered customer

* Has the same booking capabilities as a guest.
* Can view booking history across businesses.
* Can manage profile details and favourites.
* Can access upcoming and past bookings.
* Can submit eligible reviews.

**Identity rule:** A verified phone number is the primary customer
identity. Email is optional. A customer account is shared across all
businesses on the platform.

## 3.2 Business roles

V1 uses three predefined roles.

\---

Capability                    Owner            Manager                   Staff

\---

View business                   Yes                Yes                 Limited
dashboard

Manage business                 Yes     Configurable /                      No
profile                                        limited

Manage locations                Yes                Yes                      No

Manage resources                Yes                Yes                      No
and schedules

View bookings                   Yes                Yes                     Yes

Approve/reject                  Yes                Yes  Proposed: configurable
online requests                                                 by role policy

Create                          Yes                Yes                     Yes
phone/walk-in  
bookings

Cancel bookings                 Yes                Yes               Proposed:
permission-controlled

Record venue                    Yes                Yes                     Yes
payments

View analytics                  Yes                Yes            No / limited

Manage staff                    Yes                 No                      No
accounts

Manage                          Yes                 No                      No
subscription

Manage owner                    Yes                 No                      No
account
---

**Permission detail requiring final configuration:** The exact actions
allowed to staff (especially approving requests, cancelling bookings,
and editing payment records) should be represented as a central
role-permission matrix. Do not scatter role checks throughout the UI.

### Owner

* Full control over the business and its locations.
* Can add and remove managers and staff.
* Can view and manage subscription details.
* Can access all business analytics and financial records.

### Manager

* Manages day-to-day venue operations.
* Can manage resources, schedules, bookings, and operational staff
tasks.
* Cannot transfer ownership or change subscription ownership.

### Staff

* Handles operational tasks such as viewing bookings, entering
walk-ins, marking attendance/completion, and recording payments,
subject to the final permission matrix.
* Cannot manage subscription or sensitive business-wide configuration.

## 3.3 Platform super-admin

Super-admin capabilities: - Review and approve/reject business
applications. - View and manage tenant accounts. - Suspend or reactivate
tenants. - Configure subscription plans, limits, trials, and grace
policies. - Verify manually paid subscriptions. - Manage platform
activity categories. - View platform-wide booking and operational
metrics. - Review reports and moderate reviews. - View audit events for
platform-level actions.

Super-admin access must be protected by strong authentication and
explicit authorisation. Cross-tenant access must be logged.

\---

# 4\. Business onboarding and verification

## 4.1 Onboarding model

Both self-service and platform-assisted onboarding are required.

* **Self-service:** A business owner registers and submits its
details.
* **Assisted:** A platform administrator creates or helps configure
the business account.

## 4.2 Verification requirements

V1 verification requirements: 1. Owner identity verification. 2.
Business contact phone verification. 3. Venue photographs.

Business registration documents are not mandatory in the initial V1
scope. Address verification is not a mandatory document requirement in
the current decision set.

## 4.3 Onboarding workflow

1. Owner creates an account and verifies their phone.
2. Owner enters business name, contact information, business
description, and location details.
3. Owner submits identity verification information and venue
photographs.
4. Application enters `pending\_review`.
5. Platform super-admin reviews the application.
6. Admin approves or rejects it, with an internal reason.
7. On approval, the business can configure locations, resources,
schedules, and pricing.
8. The public listing becomes discoverable only when the business is
verified and has completed the required listing setup.

**Rule:** A business must not appear as a bookable public listing before
verification approval.

## 4.4 Multiple locations

A business account may manage multiple physical locations. Each location
has its own: - Address and contact details. - Opening hours and holiday
calendar. - Resources. - Slot schedules. - Pricing rules. - Bookings and
blocks. - Staff assignments (staff may be assigned to one or multiple
locations).

The owner receives a consolidated view across all locations.
Location-level data must remain clearly segmented in operational views.

\---

# 5\. Customer marketplace and business pages

## 5.1 Marketplace discovery

V1 discovery is a combination of: - Location-first discovery. -
Category-first discovery. - Search-first discovery.

Customers can search by: - Venue/business name. - Activity category. -
City, locality, or PIN code. - Relevant service or facility keywords.

Map-based discovery is explicitly out of scope for V1.

### Proposed filters

* Activity category.
* Location/locality.
* Price range.
* Availability for a selected date (where practical).
* Rating.
* Business or venue attributes, if structured data is available.

### Proposed sorting

* Relevance.
* Price: low to high / high to low.
* Rating.
* Proximity or locality relevance, if reliable location data is
available.

Distance-based sorting is a proposal and should not be represented as
exact GPS routing in V1.

## 5.2 Business public listing

Each public business page should support: - Business name and logo. -
Cover image and image gallery. - Business description. - Address and
locality. - Contact information. - Operating hours. - Activity
categories. - Facilities and amenities. - Bookable resources or resource
types. - Price information. - Available dates and fixed slots. -
Customer ratings and reviews. - Booking and cancellation policy
summary. - Clear booking request action.

## 5.3 URL strategy

Standard V1 URL pattern:

* Marketplace: `https://<platform-domain>/`
* Business page: `https://<platform-domain>/<business-slug>`
* Location page:
`https://<platform-domain>/<business-slug>/<location-slug>`
(proposed)
* Booking status: `https://<platform-domain>/booking/<secure-token>`
(proposed; token must be unguessable and revocable)

Custom domains and subdomains are not part of the V1 customer-facing URL
requirement.

## 5.4 SEO and discoverability

Public marketplace and business pages should be: - Server-rendered or
statically rendered where suitable. - Indexable with canonical URLs. -
Equipped with page titles, descriptions, Open Graph metadata, and
structured data where appropriate. - Protected from indexing private
customer data, booking pages, and dashboard routes.

\---

# 6\. Resource and facility model

## 6.1 Flexible resource engine

The system must use a generic resource model rather than hardcoded
activity-specific booking logic.

Examples:

Business category      Example resources

\---

Pool/snooker hall      Table 1, Table 2, VIP table
Football turf          Pitch 1, Pitch 2
Gaming lounge          PC 01, PC 02, PlayStation 1
Swimming pool          Session capacity, lane, or bookable session
Other activity venue   Any configurable bookable unit

A business creates resources and defines how each is booked.

## 6.2 Resource attributes

A resource should support: - Name. - Resource type/category. -
Description. - Location. - Capacity or group-size constraints, if
applicable. - Active/inactive status. - Slot duration. - Slot
interval. - Operating schedule. - Pricing rules. - Advance booking
rules. - Minimum/maximum booking constraints. - Resource-specific notes
or amenities.

Not every field needs to apply to every resource type. Use optional
attributes and configuration rather than a schema full of
category-specific hardcoding.

## 6.3 Independent resource configuration

Each resource can have its own: - Schedule. - Slot duration and
interval. - Operating days. - Opening/closing times. - Breaks. - Price
rules. - Capacity. - Advance booking restrictions. - Maintenance blocks.

Example: - Table 1: 30-minute slots. - Table 2: 60-minute slots. - Table
3: 60-minute slots. - Table 4: 90-minute slots. - Table 5: weekends
only.

This is supported in V1.

\---

# 7\. Scheduling and availability engine

## 7.1 Fixed-slot scheduling

V1 uses fixed slots, not arbitrary customer-selected start times.

Businesses configure: - Opening and closing hours. - Slot duration. -
Slot interval / start-time cadence. - Resource-specific schedules. -
Weekday and weekend schedules. - Special dates and holidays. - Break
periods. - Maintenance and unavailable periods.

The system generates bookable slots from these configurations.

## 7.2 Schedule hierarchy

Recommended precedence: 1. Resource-specific exception or block. 2.
Resource-specific date override. 3. Resource weekly schedule. 4.
Location operating schedule. 5. Business defaults.

A resource must not offer a slot outside the location's valid operating
hours unless an explicit override is configured.

## 7.3 Availability states

A slot/resource interval may be: - `available` - `pending\_hold` -
`confirmed` - `blocked` - `unavailable` (outside operating schedule or
not bookable)

Availability should be calculated from schedule rules plus active
allocations and blocks. Avoid treating a cached availability response as
the final authority when accepting a booking.

## 7.4 Pending hold and expiry

When a customer submits a request: 1. The system validates availability.
2. It creates the booking request and associated resource allocations in
one database transaction. 3. It places a temporary hold on all requested
resources. 4. It sets `pending\_expires\_at`. 5. It notifies the business
dashboard. 6. The business sees the remaining time before expiry.

The pending hold duration is configurable by the business.

If the request expires without a decision: - The booking transitions to
`expired`. - All held allocations are released. - The slot becomes
available again. - The customer-facing status page reflects expiry.

A scheduled background process must expire overdue requests. Expiry must
be idempotent: running it more than once must not release or alter
inventory incorrectly.

**Manual extension of pending expiry:** Proposed for business users, but
not yet explicitly confirmed. Keep this as an open decision or implement
only if approved.

## 7.5 Concurrency and double-booking prevention

This is a critical correctness requirement.

Two customers may view the same availability at the same time. The
backend must guarantee that only one conflicting reservation succeeds.

Required approach: - PostgreSQL transaction around booking creation and
allocation. - Lock or atomically claim the relevant resource/time
inventory. - Enforce a database-level conflict constraint for active
allocations. - Re-check availability inside the transaction. - Return a
clear conflict response if another request claimed the slot first. -
Never rely only on frontend availability checks.

For fixed slots, use a unique active allocation key or equivalent
constraint. If variable-length allocations are later supported, use
PostgreSQL range/exclusion constraints to prevent overlapping intervals.

## 7.6 Multi-resource bookings

V1 supports one booking containing multiple resource allocations.

Example: A customer requests two pool tables for the same period.

Expected behaviour: - One booking reference. - Multiple resource
allocations. - One combined price. - One business approval/rejection
decision. - All resources are held or none are held. - If any requested
resource is unavailable, the whole request fails or the customer is
asked to revise the selection. - Cancellation and status rules apply
consistently to the booking unless a future partial-allocation feature
is approved.

**Open detail:** V1 discovery confirms multiple resources in one
booking, but does not yet specify whether each resource may have a
different time interval. Recommended initial behaviour is to require the
same date/time window for all resources in one booking. Confirm before
implementation.

## 7.7 Offline and walk-in bookings

The business dashboard must support: - Phone bookings entered by
staff. - Walk-in bookings. - Admin-created reservations. - Temporary
resource blocks.

All these operations must use the same booking/availability engine as
public online requests.

A phone or walk-in booking should immediately make the corresponding
resource/time unavailable to online customers.

Offline bookings should record their source, creator, and customer
details where available.

\---

# 8\. Booking lifecycle and workflows

## 8.1 Booking request flow

1. Customer selects business and location.
2. Customer selects one or more resources.
3. Customer selects a date and available fixed slot(s).
4. Customer enters name, phone number, group size, and optional email.
5. Customer completes phone OTP verification.
6. Backend validates all allocations and pricing.
7. Backend creates one booking and all resource allocations
transactionally.
8. All requested resources enter pending hold.
9. Business receives an in-dashboard and browser push notification
where permission is available.
10. Business contacts the customer by phone to confirm details.
11. Business approves or rejects the request.
12. Customer's booking status page updates and browser push notification
is sent where available.

## 8.2 Business approval actions

Business users should be able to: - Approve request. - Reject request. -
Provide rejection reason. - Add internal notes. - View customer contact
information. - View remaining time before expiry.

Changing the booking time directly is not supported. If a customer needs
another time, the original request must be cancelled/rejected and a new
request submitted.

## 8.3 Booking states

Recommended state model:

State                     Meaning

\---

`pending`                 Awaiting business decision; inventory held
`approved`                Business accepted; inventory confirmed
`rejected`                Business declined; inventory released
`expired`                 Approval deadline passed; inventory released
`cancelled\_by\_customer`   Customer cancelled
`cancelled\_by\_business`   Business cancelled
`completed`               Activity/booking completed
`no\_show`                 Customer did not attend

Do not use payment status as a booking status. Payment collection is a
separate lifecycle.

### State transition rules

* `pending` → `approved`
* `pending` → `rejected`
* `pending` → `expired`
* `pending` → `cancelled\_by\_customer`
* `approved` → `cancelled\_by\_customer` (if policy allows)
* `approved` → `cancelled\_by\_business`
* `approved` → `completed`
* `approved` → `no\_show`

Terminal-state transitions must be restricted. For example, an expired
booking must not later be approved unless an explicit recovery workflow
is designed.

## 8.4 Business cancellation

A business can cancel an approved booking, for example because of
maintenance or weather.

Required: - Cancellation reason. - Actor identity. - Timestamp. -
Customer notification. - Release of resource allocations. - Audit event.

## 8.5 Customer booking management

Customers can: - View status through a secure booking status page. -
Cancel pending requests. - Cancel approved bookings when allowed by
policy. - View booking history when signed in. - Receive updates when a
business accepts or rejects a request.

A secure booking link must use a high-entropy token and must not expose
personal information to anyone who guesses a sequential booking ID.

## 8.6 No-show handling

Business staff can mark an approved booking as `no\_show`. The platform
records: - Who marked it. - When it was marked. - Optional internal
notes.

The business can contact customers directly. Repeat no-show flags or
customer restrictions may be considered, but automated penalties are not
part of the confirmed V1 scope.

\---

# 9\. Pricing engine

## 9.1 Supported pricing rules

V1 should support: - Resource-specific pricing. - Time-of-day pricing. -
Weekday/weekend pricing. - Special-date or holiday pricing. - Different
prices for different resources. - Group-size or capacity-related pricing
where relevant (exact model to be configured per resource type).

## 9.2 Pricing precedence

Recommended rule precedence: 1. Explicit resource/date override. 2.
Resource-specific special-date rule. 3. Resource weekday/weekend rule.
4. Resource time-of-day rule. 5. Resource base price. 6.
Business/location default, if configured.

The pricing engine must identify conflicts and either apply a documented
precedence rule or reject ambiguous configurations. It must not silently
stack incompatible rules.

## 9.3 Booking crossing price periods

Example: A booking runs 4:30 PM--6:30 PM and peak pricing begins at 5
PM.

Recommended calculation: - 4:30--5:00 PM at off-peak rate. - 5:00--6:30
PM at peak rate. - Sum the segments to produce the booking amount.

This is a recommended behaviour and should be confirmed before
implementation. An alternative is to restrict bookings to slot
boundaries that never cross a price boundary.

## 9.4 Price snapshot

When a booking request is created, persist a price snapshot: - Resource
name and identifier. - Slot start/end. - Applied pricing rule. - Unit
rate. - Quantity/duration. - Discounts, if later supported. - Subtotal
and total. - Currency (INR).

Subsequent changes to business pricing must not rewrite historical
booking amounts.

## 9.5 Coupons and promotions

Coupons and promotional campaigns are not confirmed for V1. Keep the
pricing architecture extensible, but do not include a complex promotion
engine in the initial build without a separate decision.

\---

# 10\. Cancellation policies

Businesses can configure: 1. Whether customers can cancel pending
requests. 2. Whether customers can cancel approved bookings. 3.
Cancellation deadline. 4. Whether a cancellation reason is required. 5.
Whether businesses can cancel at any time.

Cancellation rules should be visible to customers before they submit a
request.

The system must record cancellation actor, timestamp, reason, and
resulting inventory release.

Since customer payments are collected at the venue in V1, online refunds
are out of scope. If a business records an advance or partial venue
collection, any refund or adjustment is handled manually and recorded in
the payment ledger.

\---

# 11\. Payment collection and venue reconciliation

## 11.1 V1 payment model

Customers reserve online but pay the business at the venue. Online
payment gateway checkout is not part of V1.

The business dashboard records money collected.

## 11.2 Payment statuses

* `unpaid`
* `partially\_paid`
* `paid`
* `refunded` or `adjusted` only if manual refund/adjustment recording
is approved

Payment status must be separate from booking status.

## 11.3 Payment record fields

Each payment/collection record should include: - Booking ID. - Amount. -
Currency. - Payment method: cash, UPI, card, other. - Collection
date/time. - Recording staff member. - Optional reference or note. -
Status and any reversal/adjustment link.

Support multiple collection entries against one booking to represent
partial payments.

## 11.4 Revenue reporting

Dashboard reporting must distinguish: - Booking value. - Amount
collected. - Outstanding amount. - Paid bookings. - Partially paid
bookings. - Unpaid bookings. - Cancelled booking value (excluded from
realised collection). - Collections by payment method.

Do not label booking value as revenue collected. Clearly distinguish
expected booking value from recorded cash/UPI/card collections.

\---

# 12\. Customer accounts and identity

## 12.1 Customer information

Required: - Full name. - Phone number. - OTP verification. - Group size.

Optional: - Email. - Additional booking notes.

## 12.2 Authentication

Phone number is the primary customer identity. OTP is required at
booking submission.

Registered accounts can access booking history and favourites. Guest
checkout remains available.

OTP provider selection is an implementation decision. Evaluate providers
available in India, delivery reliability, pricing, DLT/template
requirements, and operational support before selecting.

## 12.3 Abuse controls

* Rate-limit OTP requests and verification attempts.
* Add resend cooldowns.
* Protect booking submission against automated abuse.
* Avoid exposing whether a phone number belongs to an account.
* Store phone numbers securely and restrict staff access to necessary
customer data.

\---

# 13\. Notifications

## 13.1 V1 channels

* Browser push notifications.
* In-dashboard notifications.
* Customer booking status page.
* SMS OTP for phone verification only.

WhatsApp and email notification workflows are deferred.

## 13.2 Events

Event                       Customer             Business

\---

Booking request created     Status page          Dashboard + push
Booking approved            Status page + push   Dashboard
Booking rejected            Status page + push   Dashboard
Booking expired             Status page          Dashboard
Customer cancellation       Status page          Dashboard + push
Business cancellation       Status page + push   Dashboard
Upcoming booking reminder   Not confirmed        Not confirmed

Browser push requires HTTPS, service worker support, browser permission,
and a valid push subscription. The booking status page remains the
source of truth when push is unavailable or permission is denied.

## 13.3 Notification architecture

Use an internal notification module with: - Event creation. - Recipient
resolution. - Channel selection. - Delivery attempts. - Retry policy. -
Delivery status. - Failure logging.

Notification delivery must not be allowed to corrupt or roll back a
successful booking transaction. Use a transactional outbox or equivalent
reliable event dispatch pattern.

\---

# 14\. Reviews and ratings

V1 includes: - Star rating. - Written review. - One review per completed
booking. - Business response. - Platform-admin moderation/removal for
abusive or fraudulent content.

Only customers with eligible completed bookings can review. A rejected,
expired, pending, cancelled, or no-show booking is not review-eligible.

Review photographs are deferred to a later version.

Open policy details: - Rating scale (recommended 1--5 stars). - Whether
the review is tied to a specific location or business overall. - Whether
edited reviews are allowed. - Whether businesses can report reviews. -
Moderation appeal process.

Businesses must not be able to delete negative reviews themselves.

\---

# 15\. Business dashboard specification

## 15.1 Dashboard overview

The landing page should show: - Today's booking requests. - Pending
requests and expiry countdowns. - Confirmed bookings. - Available and
occupied resources. - Upcoming reservations. - Today's expected booking
value. - Today's recorded collections. - Cancellation statistics.

## 15.2 Core sections

1. Overview.
2. Calendar / bookings.
3. Booking requests.
4. Locations.
5. Resources.
6. Schedules and availability.
7. Pricing.
8. Customers.
9. Payments / collections.
10. Reviews.
11. Analytics.
12. Staff and permissions.
13. Business profile.
14. Subscription and plan.
15. Settings.

## 15.3 Booking calendar

Calendar/list views should support: - Day and week views. - Location
filter. - Resource filter. - Booking status filter. - Booking source
filter (online, phone, walk-in, admin). - Quick view of customer and
booking details. - Resource blocks and maintenance periods.

## 15.4 Manual booking creation

Authorised business users can create: - Phone booking. - Walk-in
booking. - Admin-created reservation.

The system should validate availability and create the booking through
the same inventory rules. The creator and source must be recorded.

The business may need to create a reservation without a customer
account. Customer phone/name collection should be supported where
practical.

## 15.5 Resource management

Business users can: - Create, edit, deactivate resources. - Assign
resources to locations. - Configure capacity and resource details. -
Configure slot duration and intervals. - Set schedules and price
rules. - Create maintenance blocks. - View upcoming allocations.

## 15.6 Staff management

Owner can: - Invite staff. - Assign Owner/Manager/Staff roles (only one
owner or ownership transfer rules require separate policy). - Assign
staff to locations. - Deactivate staff access. - Review staff activity
through audit logs.

\---

# 16\. Platform super-admin specification

## 16.1 Sections

1. Platform overview.
2. Business applications.
3. Business directory.
4. Verification queue.
5. Tenant details.
6. Subscription plans.
7. Subscription payment verification.
8. Platform-wide bookings.
9. Activity categories.
10. Review moderation.
11. Reports and analytics.
12. Platform settings.
13. Audit logs.

## 16.2 Business management

Admin can: - Approve/reject applications. - Suspend/reactivate a
business. - View tenant and location information. - View subscription
status. - View public listing state. - Record internal notes. - Review
verification history.

Any admin action affecting a tenant must be logged with actor,
timestamp, target, action, and reason where applicable.

\---

# 17\. SaaS subscription model

## 17.1 Commercial model

Businesses pay a recurring monthly SaaS subscription. Customer booking
payments are collected directly by the venue and are not platform
payment transactions in V1.

Pricing discovery is required before finalising INR plan prices.

## 17.2 Plans

V1 supports multiple subscription tiers. The super-admin must be able to
configure: - Plan name and description. - Price and billing interval. -
Trial eligibility. - Number of locations. - Number of resources. -
Number of staff accounts. - Booking volume allowance. - Analytics
features. - Plan status and visibility.

A custom plan or manual override may be supported operationally, but the
exact custom pricing workflow is not finalised.

## 17.3 Trial

A 7-day free trial is confirmed.

Trial start/end timestamps must be stored. Trial eligibility and whether
a business can restart a trial require abuse controls and policy
definition.

## 17.4 Subscription payment

V1 uses manual subscription payment and admin verification.

Suggested flow: 1. Business selects a plan. 2. Platform displays payment
instructions. 3. Business makes payment outside the platform. 4.
Business submits transaction/reference details or payment proof. 5.
Super-admin verifies payment. 6. Subscription is activated or renewed.
7. Business sees subscription status and next due date.

No automatic recurring payment gateway is required in V1.

## 17.5 Expiry and grace period

Confirmed policy: 1. Subscription becomes overdue. 2. Business receives
in-product reminders. 3. Grace period begins. 4. After grace period,
public booking page is disabled. 5. Business dashboard becomes
read-only. 6. Historical bookings and payment records remain accessible.
7. Reactivation restores normal functionality.

**Open decision:** Exact grace period duration is not yet selected.

**Open decision:** Handling of already-approved future bookings when a
subscription expires needs a clear policy. Recommended default: do not
silently cancel customer-confirmed bookings; preserve read-only access
to fulfilment records and let the business contact affected customers if
it cannot honour them.

## 17.6 Plan enforcement

Plan limits are configurable by super-admin: - Locations. - Resources. -
Staff accounts. - Booking volume. - Analytics features.

The system must define whether limits are hard blocks, warnings, or soft
allowances. Recommended approach: warn near limits and prevent creation
of additional billable capacity after the limit, while never deleting
existing data.

\---

# 18\. Data model --- logical schema

The following is a logical starting point, not a final migration-ready
schema. Exact columns, indexes, foreign keys, and enum strategy should
be validated during implementation.

## 18.1 Core entities

### `users`

* `id`
* `phone`
* `phone\_verified\_at`
* `email` (nullable)
* `name`
* `password\_hash` or external auth identifier, depending on auth
design
* `status`
* `created\_at`
* `updated\_at`

### `customer\_profiles`

* `user\_id`
* `preferences`
* `created\_at`
* `updated\_at`

### `businesses`

* `id`
* `owner\_user\_id`
* `name`
* `slug`
* `description`
* `logo\_asset\_id`
* `verification\_status`
* `public\_status`
* `status`
* `created\_at`
* `updated\_at`

### `business\_verification\_submissions`

* `id`
* `business\_id`
* `owner\_identity\_asset/reference`
* `phone\_verified\_at`
* `venue\_photo\_asset\_ids`
* `review\_status`
* `reviewed\_by`
* `reviewed\_at`
* `rejection\_reason`
* `created\_at`

Sensitive identity documents must use restricted storage and retention
policies. Collect only what is necessary for the verification process.

### `business\_memberships`

* `id`
* `business\_id`
* `user\_id`
* `role` (`owner`, `manager`, `staff`)
* `status`
* `created\_at`

### `locations`

* `id`
* `business\_id`
* `name`
* `slug`
* `address`
* `locality`
* `city`
* `state`
* `postal\_code`
* `country\_code`
* `phone`
* `timezone`
* `status`
* `created\_at`
* `updated\_at`

### `activity\_categories`

* `id`
* `name`
* `slug`
* `description`
* `status`
* `sort\_order`

### `resources`

* `id`
* `business\_id`
* `location\_id`
* `name`
* `resource\_type`
* `description`
* `capacity`
* `configuration\_json`
* `status`
* `created\_at`
* `updated\_at`

### `resource\_schedules`

* `id`
* `resource\_id`
* `day\_of\_week`
* `opens\_at`
* `closes\_at`
* `slot\_duration\_minutes`
* `slot\_interval\_minutes`
* `effective\_from`
* `effective\_to`
* `status`

### `schedule\_exceptions`

* `id`
* `resource\_id`
* `date`
* `exception\_type`
* `opens\_at`
* `closes\_at`
* `reason`

### `resource\_blocks`

* `id`
* `resource\_id`
* `starts\_at`
* `ends\_at`
* `reason`
* `created\_by`
* `created\_at`

### `pricing\_rules`

* `id`
* `business\_id`
* `location\_id`
* `resource\_id` (nullable if inherited)
* `rule\_type`
* `day\_of\_week` (nullable)
* `date` (nullable)
* `start\_time` (nullable)
* `end\_time` (nullable)
* `amount`
* `currency`
* `priority`
* `effective\_from`
* `effective\_to`
* `status`

### `bookings`

* `id`
* `public\_reference`
* `business\_id`
* `location\_id`
* `customer\_user\_id` (nullable for guest)
* `customer\_name`
* `customer\_phone`
* `customer\_email` (nullable)
* `group\_size`
* `source` (`online`, `phone`, `walk\_in`, `admin`)
* `status`
* `requested\_at`
* `pending\_expires\_at`
* `approved\_at`
* `rejected\_at`
* `cancelled\_at`
* `completed\_at`
* `created\_by`
* `internal\_notes`
* `cancellation\_reason`
* `rejection\_reason`
* `price\_snapshot`
* `currency`
* `total\_amount`
* `created\_at`
* `updated\_at`

### `booking\_allocations`

* `id`
* `booking\_id`
* `business\_id`
* `location\_id`
* `resource\_id`
* `starts\_at`
* `ends\_at`
* `allocation\_status`
* `price\_snapshot`
* `created\_at`

### `booking\_status\_history`

* `id`
* `booking\_id`
* `from\_status`
* `to\_status`
* `actor\_user\_id`
* `reason`
* `created\_at`

### `payments`

* `id`
* `booking\_id`
* `business\_id`
* `amount`
* `currency`
* `method` (`cash`, `upi`, `card`, `other`)
* `status`
* `reference`
* `collected\_at`
* `recorded\_by`
* `notes`
* `created\_at`

### `reviews`

* `id`
* `booking\_id`
* `business\_id`
* `location\_id`
* `customer\_user\_id`
* `rating`
* `body`
* `moderation\_status`
* `business\_response`
* `responded\_at`
* `created\_at`
* `updated\_at`

### `subscriptions`

* `id`
* `business\_id`
* `plan\_id`
* `status`
* `trial\_starts\_at`
* `trial\_ends\_at`
* `current\_period\_starts\_at`
* `current\_period\_ends\_at`
* `grace\_ends\_at`
* `created\_at`
* `updated\_at`

### `subscription\_plans`

* `id`
* `name`
* `description`
* `price\_amount`
* `currency`
* `billing\_interval`
* `limits\_json`
* `features\_json`
* `status`

### `subscription\_payment\_submissions`

* `id`
* `subscription\_id`
* `business\_id`
* `amount`
* `reference`
* `proof\_asset\_id` (optional)
* `status`
* `reviewed\_by`
* `reviewed\_at`
* `created\_at`

### `notifications`

* `id`
* `recipient\_user\_id`
* `business\_id` (nullable)
* `event\_type`
* `payload`
* `channel`
* `status`
* `sent\_at`
* `read\_at`
* `created\_at`

### `push\_subscriptions`

* `id`
* `user\_id`
* `endpoint`
* `public\_key`
* `auth\_secret`
* `user\_agent`
* `created\_at`
* `revoked\_at`

### `audit\_logs`

* `id`
* `actor\_user\_id`
* `business\_id` (nullable)
* `target\_type`
* `target\_id`
* `action`
* `before\_snapshot`
* `after\_snapshot`
* `reason`
* `ip\_hash\_or\_metadata`
* `created\_at`

### `favourites`

* `id`
* `customer\_user\_id`
* `business\_id`
* `created\_at`

## 18.2 Data isolation

Every tenant-owned record must be scoped to `business\_id`, directly or
through a parent relation. Location-level records must also be scoped to
`location\_id` where relevant.

Requirements: - Enforce tenant scoping in the service/repository
layer. - Consider PostgreSQL Row-Level Security as defence in depth. -
Never trust a tenant ID supplied by the browser without validating
membership. - Super-admin cross-tenant queries must use explicit
privileged paths and be audited. - Add indexes for tenant ID, location
ID, resource ID, status, and time range. - Ensure unique constraints for
slugs and membership relationships.

## 18.3 Booking integrity constraints

At minimum: - A resource cannot have conflicting active allocations. -
Booking and all allocations are created atomically. - Multi-resource
allocations succeed or fail together. - An expired/rejected/cancelled
request releases its hold exactly once. - Booking status changes and
status history are committed together. - Payment records cannot exceed
the allowed collection amount unless an explicit overpayment policy is
approved. - A review is unique per eligible booking.

\---

# 19\. API specification --- initial endpoint inventory

API style and exact route conventions remain to be finalised. REST-style
endpoints are a suitable starting point.

## 19.1 Public marketplace

Method   Endpoint                               Purpose

\---

GET      `/public/categories`                   List activity categories
GET      `/public/businesses`                   Search and filter businesses
GET      `/public/businesses/:slug`             Business public profile
GET      `/public/businesses/:slug/locations`   List locations
GET      `/public/locations/:id/resources`      Public bookable resources
GET      `/public/availability`                 Query available fixed slots
GET      `/public/businesses/:id/reviews`       Public reviews

## 19.2 Authentication and OTP

Method   Endpoint              Purpose

\---

POST     `/auth/otp/request`   Request OTP
POST     `/auth/otp/verify`    Verify OTP
POST     `/auth/logout`        End session
GET      `/auth/me`            Current user/profile

## 19.3 Customer bookings

Method   Endpoint                       Purpose

\---

POST     `/bookings`                    Submit booking request
GET      `/bookings/:id`                Get authorised booking
GET      `/booking-status/:token`       Secure guest status lookup
POST     `/bookings/:id/cancel`         Request cancellation
GET      `/me/bookings`                 Customer booking history
POST     `/bookings/:id/reviews`        Submit eligible review
POST     `/me/favourites/:businessId`   Add favourite
DELETE   `/me/favourites/:businessId`   Remove favourite

## 19.4 Business operations

Method   Endpoint                            Purpose

\---

GET      `/business/bookings`                List tenant bookings
POST     `/business/bookings/:id/approve`    Approve request
POST     `/business/bookings/:id/reject`     Reject request
POST     `/business/bookings/:id/cancel`     Business cancellation
POST     `/business/bookings/:id/complete`   Mark completed
POST     `/business/bookings/:id/no-show`    Mark no-show
POST     `/business/bookings/:id/notes`      Add internal note
POST     `/business/bookings/manual`         Create phone/walk-in booking
POST     `/business/resources`               Create resource
PATCH    `/business/resources/:id`           Update resource
POST     `/business/resources/:id/blocks`    Block resource
GET      `/business/availability`            Business availability view
POST     `/business/payments`                Record collection
GET      `/business/analytics`               Business analytics

## 19.5 Platform administration

\---

Method                  Endpoint                                    Purpose

\---

GET                     `/admin/business-applications`              Verification queue

POST                    `/admin/businesses/:id/approve`             Approve business

POST                    `/admin/businesses/:id/reject`              Reject application

POST                    `/admin/businesses/:id/suspend`             Suspend tenant

POST                    `/admin/businesses/:id/reactivate`          Reactivate tenant

GET                     `/admin/subscription-plans`                 List plans

POST                    `/admin/subscription-plans`                 Create plan

PATCH                   `/admin/subscription-plans/:id`             Update plan

POST                    `/admin/subscription-payments/:id/verify`   Verify manual payment

GET                     `/admin/audit-logs`                         Review platform audit
events
---

## 19.6 API requirements

* Validate all inputs server-side.
* Use consistent error response shapes.
* Enforce tenant permissions at the backend.
* Add pagination to list endpoints.
* Add idempotency keys to booking creation and payment-record creation
where duplicate submissions are possible.
* Use rate limiting for OTP, public search, booking creation, and
login.
* Return conflict responses for unavailable inventory.
* Do not expose internal notes, identity verification data, or private
customer fields through public endpoints.
* Document endpoints with OpenAPI/Swagger or an equivalent generated
API reference.

\---

# 20\. Technical architecture

## 20.1 Agreed direction

Layer                  Direction

\---

Frontend               Next.js + React
Language               TypeScript
Styling                Tailwind CSS
UI components          shadcn/ui
Repository             Monorepo
Backend architecture   Modular monolith
Database               PostgreSQL
ORM                    Prisma or Drizzle --- final choice pending
Cache                  Avoid initially unless justified
Cloud                  AWS preferred; evaluate Azure credits
Currency               INR
Locale                 English, India
Deployment             Web applications and API

## 20.2 Proposed monorepo

``` text
activity-booking-platform/
├── apps/
│   ├── marketplace/       # Customer website
│   ├── business/          # Business dashboard
│   ├── admin/             # Platform super-admin
│   └── api/               # Modular backend
│
├── packages/
│   ├── ui/                # Shared UI components
│   ├── database/          # Schema, migrations, repositories
│   ├── auth/              # Authentication and permissions
│   ├── booking-engine/    # Availability, holds, allocations
│   ├── pricing/           # Pricing calculation
│   ├── notifications/     # Push and OTP orchestration
│   ├── validation/        # Shared input schemas
│   ├── types/             # Shared TypeScript types
│   └── config/            # Shared configuration
│
├── infrastructure/
│   ├── aws/
│   └── azure/
│
├── docs/
└── package.json
```

This is a proposed structure. The three frontends and API may be
independently deployed, but should share packages and a single versioned
domain model.

## 20.3 Modular monolith modules

Backend modules: 1. Identity and authentication. 2. Customers. 3.
Businesses and memberships. 4. Verification. 5. Locations. 6. Activity
categories. 7. Resources. 8. Scheduling and availability. 9. Booking and
allocations. 10. Pricing. 11. Payments and collections. 12. Reviews. 13.
Notifications. 14. Subscriptions and billing administration. 15.
Analytics. 16. Audit logging. 17. Platform administration.

Modules should communicate through defined service interfaces and domain
events. Avoid circular dependencies and direct cross-module table
manipulation.

## 20.4 Booking engine as a protected domain module

The booking engine owns: - Availability calculation. - Slot
validation. - Pending holds. - Expiry. - Approval/rejection
transitions. - Allocation conflicts. - Multi-resource atomicity. -
Cancellation and release.

Other modules must not bypass the booking engine to create or modify
allocations.

## 20.5 Background jobs

Background jobs are needed for: - Expiring pending booking requests. -
Subscription trial and grace-period transitions. - Notification
dispatch/retry. - Aggregated analytics if needed. - Cleanup of expired
OTP challenges and temporary data.

Use a durable job/queue mechanism or scheduled worker. Do not rely on
in-memory timers in a web server instance.

\---

# 21\. Cloud and infrastructure strategy

## 21.1 Provider direction

AWS is the current preference because the team already uses it and may
have existing plans. Azure should be evaluated if credits become
available.

Do not make the application dependent on proprietary cloud features
unless the cost or operational benefit is compelling.

## 21.2 Cost principles

* Start with the smallest reliable managed infrastructure.
* Avoid Kubernetes and microservices in V1.
* Avoid Redis until a measured requirement exists.
* Avoid always-on infrastructure that is not needed.
* Use managed PostgreSQL where possible.
* Use object storage for images and verification assets.
* Use CDN and caching for public assets.
* Set budgets and billing alerts.
* Separate development, staging, and production environments.
* Review free-tier limits, egress, backup, and support costs before
committing.

## 21.3 Candidate infrastructure components

Need              Candidate approach

\---

Web hosting       AWS or Azure hosting option selected after cost review
API hosting       Managed container/app service or low-cost compute
Database          Managed PostgreSQL
File storage      S3-compatible object storage
CDN               CloudFront or Cloudflare
DNS               Existing cloud DNS or Cloudflare
Secrets           Cloud secrets manager or secure environment injection
CI/CD             GitHub Actions
Logs/monitoring   Cloud-native tools plus low-cost error monitoring
Scheduled jobs    Cloud scheduler or worker process
OTP               Indian SMS provider selected after pricing/compliance review
Push              Browser Web Push protocol

No provider or service is considered final until a cost and capability
comparison is completed.

## 21.4 Portability

Keep provider-specific integrations behind adapters for: - Object
storage. - OTP delivery. - Push notification delivery. - Background job
scheduling. - Logging/monitoring.

This makes a future AWS/Azure move less disruptive.

\---

# 22\. Security, privacy, and compliance

## 22.1 Authentication and sessions

* Secure session handling.
* OTP rate limits and brute-force protections.
* Strong authentication for business owners and super-admins.
* Secure cookie settings.
* Session revocation on account suspension or credential changes.
* Avoid storing plaintext OTPs.
* Store passwords only using a modern password hashing algorithm if
passwords are used.

## 22.2 Authorisation

* Role-based access control.
* Tenant membership validation on every business request.
* Location-level access checks where applicable.
* Explicit super-admin privileges.
* Audit privileged access and cross-tenant operations.

## 22.3 Data protection

* TLS in transit.
* Encryption at rest where supported.
* Restricted access to owner identity verification data.
* Signed URLs for private uploads.
* Avoid putting personal information in public URLs or notification
payloads.
* Define retention and deletion policies.
* Keep production secrets out of source control.
* Redact sensitive values from logs.

## 22.4 Abuse prevention

* OTP request and verification rate limits.
* Booking creation rate limits.
* Bot and spam protection where needed.
* Secure random booking status tokens.
* Input validation and output encoding.
* Protection against IDOR and cross-tenant data access.
* Upload validation for file type and size.
* Audit log protection against ordinary tenant modification.

## 22.5 Privacy and legal review

Before launch, obtain appropriate review of: - Privacy policy. - Terms
of service. - Business subscription terms. - Customer cancellation
terms. - Data retention and deletion. - Identity verification data
handling. - Applicable Indian privacy and consumer requirements.

This document is a product/engineering specification, not legal advice.

\---

# 23\. UI/UX requirements

## 23.1 General

* Responsive desktop, tablet, and mobile browser layouts.
* English-only V1.
* Consistent design system.
* Accessible forms and controls.
* Clear loading, empty, success, error, and conflict states.
* Avoid making booking status dependent only on colour.
* Fast booking flow with minimal friction.
* Clear distinction between pending and confirmed reservations.

## 23.2 Customer pages

1. Marketplace home.
2. Search results.
3. Category results.
4. Business public profile.
5. Location selection.
6. Resource selection.
7. Date and slot selection.
8. Customer details.
9. OTP verification.
10. Booking request confirmation.
11. Booking status.
12. Login/account.
13. Customer dashboard.
14. Booking history/details.
15. Favourites.
16. Reviews.

## 23.3 Business dashboard pages

1. Login.
2. Onboarding and verification.
3. Dashboard overview.
4. Booking calendar.
5. Booking request detail.
6. Manual booking creation.
7. Resource list/detail.
8. Schedule editor.
9. Availability/block editor.
10. Pricing editor.
11. Locations.
12. Customers.
13. Payment collection.
14. Analytics.
15. Reviews and responses.
16. Staff management.
17. Business profile.
18. Subscription.
19. Settings.

## 23.4 Super-admin pages

1. Admin login.
2. Platform overview.
3. Verification queue.
4. Business detail.
5. Tenant management.
6. Subscription plan management.
7. Subscription payment verification.
8. Platform bookings.
9. Category management.
10. Review moderation.
11. Platform analytics.
12. Audit log.
13. Platform settings.

## 23.5 UX requirements for booking

* Show date and timezone clearly.
* Make slot availability current.
* Show the price before the customer submits.
* Explain that the request is pending business approval.
* Do not imply a booking is confirmed until the business approves it.
* Show the pending expiry expectation.
* Display cancellation policy before submission.
* Provide a stable status page after submission.
* Clearly explain when a slot becomes available again after rejection,
cancellation, or expiry.

\---

# 24\. Analytics and reporting

## 24.1 Business analytics

V1 includes: - Daily, weekly, monthly booking counts. - Booking status
distribution. - Resource utilisation. - Most-booked resources. - Peak
booking hours. - Cancellation and rejection rates. - Customer booking
history. - Booking value. - Recorded collections. - Outstanding
amount. - Payment method breakdown.

## 24.2 Platform analytics

Super-admin should be able to view: - Total registered businesses. -
Verified and pending businesses. - Active and expired subscriptions. -
Subscription revenue recorded from manual verification. - Total
bookings. - Booking activity by category and location. - Active
customers. - Platform usage and growth.

## 24.3 Metric definitions

Define metrics centrally: - **Booking value:** Total value of valid
bookings in the selected period. - **Collections:** Actual amounts
recorded as received by businesses. - **Outstanding:** Booking amount
less recorded collections, subject to adjustments. - **Utilisation:**
Booked resource time divided by available resource time. -
**Cancellation rate:** Cancelled bookings divided by the chosen eligible
booking denominator.

Do not mix platform subscription revenue with business venue
collections.

\---

# 25\. Non-functional requirements

These are proposed launch standards and should be converted into
measurable targets during engineering planning.

## 25.1 Reliability

* Booking creation must be transaction-safe.
* No double-booking under concurrent requests.
* Expiry and notification jobs must be retryable and idempotent.
* Backups must be automated and restore-tested.
* Errors must be observable.

## 25.2 Performance

* Public pages should be server-rendered or cached appropriately.
* Search and availability endpoints should be indexed and optimised.
* Avoid unnecessary client-side JavaScript.
* Use image optimisation and CDN delivery.
* Establish performance budgets before launch.

## 25.3 Availability

* Define a realistic initial uptime objective based on the chosen
hosting tier.
* Monitor API, database, background jobs, and notification delivery.
* Alert on booking failures and database capacity.

## 25.4 Scalability

* National-scale tenant model.
* Pagination for large lists.
* Indexed tenant and time-based queries.
* Stateless web/API processes where practical.
* Background processing for non-critical work.
* No premature microservices.

## 25.5 Accessibility

* Keyboard-accessible controls.
* Semantic page structure.
* Labels and validation messages for forms.
* Adequate contrast.
* Accessible status communication.

\---

# 26\. Testing strategy and acceptance criteria

## 26.1 Booking integrity tests

Must test: - Two customers request the same resource/slot
simultaneously. - A phone booking conflicts with an online request. - A
walk-in booking conflicts with a pending online request. - One resource
in a multi-resource booking is unavailable. - Pending request expires. -
Business approves just before expiry. - Business attempts to approve
after expiry. - Customer cancels a pending request. - Customer cancels
an approved request within policy. - Business cancels an approved
request. - Resource is blocked for maintenance. - Schedule changes after
future bookings already exist.

## 26.2 Tenant isolation tests

Must test: - Business A cannot access Business B's bookings. - Staff
cannot access unauthorised locations. - Customer cannot access another
customer's booking. - Super-admin access is explicit and audited. -
Public endpoints never reveal private notes or verification data.

## 26.3 Subscription tests

Must test: - Seven-day trial starts and expires correctly. - Manual
payment submission and admin verification. - Grace period transitions. -
Public page disabling after grace. - Dashboard read-only mode. -
Reactivation. - Plan limit enforcement. - Existing records remain
accessible after expiry.

## 26.4 Acceptance criteria

V1 is not ready for production until: - A verified business can
configure at least one location and resource. - A customer can discover
the business and submit an OTP-verified request. - The business receives
the request and can approve/reject it. - The slot is held during pending
approval and released on rejection/expiry/cancellation. - Concurrent
requests cannot double-book a resource. - Multiple resources can be
requested as one booking atomically. - Phone and walk-in bookings update
online availability. - Venue collections can be recorded and reported. -
Business owners can manage staff within their role permissions. -
Super-admin can verify businesses and manage subscriptions. - Customer
reviews are limited to eligible completed bookings. - Tenant data
isolation tests pass. - Backups, monitoring, and recovery procedures are
operational.

\---

# 27\. V1 scope summary

## Included in V1

* Central marketplace.
* Individual business public pages.
* Location/category/search discovery.
* Business verification.
* Multiple business locations.
* Flexible resources.
* Fixed-slot scheduling.
* Resource-specific schedules.
* Time/day/date pricing.
* Multi-resource bookings.
* OTP-verified customer booking requests.
* Business approval and rejection.
* Pending holds and automatic expiry.
* Customer booking status pages.
* Customer accounts and guest checkout.
* Phone and walk-in booking entry.
* Temporary resource blocks.
* Cancellation policies.
* Business-initiated cancellation.
* Payment collection tracking at venue.
* Customer reviews and business responses.
* Business dashboard.
* Predefined owner/manager/staff roles.
* Business analytics.
* Platform super-admin.
* Multiple subscription plans.
* Seven-day free trial.
* Manual subscription payment verification.
* Subscription grace and read-only expiry flow.
* Browser push and in-dashboard notifications.
* Audit logs.
* Responsive web experience.

## Explicitly deferred

* Native mobile apps.
* Online customer checkout/payment gateway.
* Map-based discovery.
* WhatsApp notifications.
* Email notifications.
* Review photographs.
* Custom domains and business subdomains.
* Automated subscription payment collection.
* Coupons and advanced promotions.
* Advanced customer loyalty features.
* Third-party public API.
* Automated no-show penalties.

\---

# 28\. V2 and V3 roadmap

These are candidate upgrades, not commitments.

## V2 --- Automation and customer experience

* Online advance payments and deposits.
* Automated subscription payments.
* WhatsApp and email notifications.
* Review photographs.
* Map-based discovery.
* Coupons and promotional campaigns.
* Customer loyalty and repeat booking tools.
* Automated reminders.
* Advanced analytics and exports.
* Custom domains and stronger business branding.
* Waitlists for unavailable slots.
* More advanced cancellation and refund workflows.

## V3 --- Platform expansion

* Native mobile applications, if justified.
* Multi-country currency and localisation.
* Third-party integrations and public API.
* Multi-resource bundles and packages.
* Memberships and recurring reservations.
* Advanced demand-based pricing.
* Franchise and enterprise management.
* Automated customer risk/no-show insights.
* Advanced CRM and marketing automation.
* Marketplace recommendations and personalisation.

\---

# 29\. Open decisions register

The following details should not be silently assumed during
implementation.

\---

ID                      Open decision           Recommended next step

\---

OD-01                   Final product name and  Decide after product
domain                  specification

OD-02                   Subscription plan       Conduct local market
prices                  price discovery

OD-03                   Grace period duration   Choose a clear number
of days

OD-04                   Treatment of approved   Preserve fulfilment
future bookings after   records; define
subscription expiry     business obligations

OD-05                   Exact staff permission  Finalise
matrix                  Owner/Manager/Staff
actions

OD-06                   Can one multi-resource  Start with same
booking contain         interval for all
different time          resources
intervals?

OD-07                   Pending expiry manual   Confirm whether
extension               business users can
extend

OD-08                   Pricing when a slot     Split pricing by time
crosses peak/off-peak   segment or constrain
boundary                slot boundaries

OD-09                   Rating scale and review Recommend 1--5 stars;
edit policy             define edit window

OD-10                   Exact OTP provider      Compare India pricing
and compliance

OD-11                   Browser push            Evaluate Web Push
provider/library        implementation

OD-12                   Backend framework       Select after small
architecture evaluation

OD-13                   ORM                     Compare Prisma and
Drizzle

OD-14                   AWS vs Azure deployment Compare credits,
managed database,
compute, storage,
egress

OD-15                   Booking status          Define token expiry and
guest-link security     revocation

OD-16                   Customer booking limits Define sensible
defaults and
per-business overrides

OD-17                   Subscription            Decide what counts
booking-volume          toward plan quota
definition

OD-18                   Manual subscription     Define required
payment proof           reference/proof and
review process

OD-19                   Business identity       Define minimum data
verification            collection and secure
provider/process        retention

OD-20                   Booking reminders       Decide whether any
reminders are required
in V1
---

\---

# 30\. Recommended engineering sequence

This is a dependency-oriented sequence, not a commitment to launch a
reduced MVP.

1. **Foundation:** Repository, environments, database, authentication,
tenancy, roles, audit.
2. **Business configuration:** Onboarding, verification, locations,
resources, schedules, pricing.
3. **Booking engine:** Availability, slot generation, holds, expiry,
transactions, multi-resource allocations.
4. **Customer experience:** Marketplace, business pages, OTP, booking
requests, status pages, accounts.
5. **Business operations:** Dashboard, approvals, offline bookings,
cancellations, payment collection.
6. **Platform administration:** Verification queue, tenants,
subscription plans, manual payment verification.
7. **Engagement:** Browser push, reviews, moderation, favourites.
8. **Analytics:** Business and platform reporting.
9. **Hardening:** Security, concurrency, tenant isolation,
accessibility, performance, backups, monitoring.
10. **Production readiness:** UAT with representative businesses,
operational runbooks, and deployment.

\---

# 31\. Definition of done

A feature is not complete merely because its UI exists.

Every feature must have: - Documented business rules. - Backend
validation. - Permission checks. - Loading, empty, error, and success
states. - Audit events where the action is operationally significant. -
Automated tests for critical paths. - Responsive UI. - Observability for
failures. - Updated documentation.

The booking engine, tenant isolation, and payment ledger deserve
particularly rigorous testing.

\---

# Appendix A --- Product decisions confirmed during discovery

* Hybrid central marketplace and individual business pages.
* Initial onboarding of nearby independent activity businesses.
* Monthly business subscriptions; subscription pricing to be
researched.
* Web-only product.
* Three interfaces: customer, business, platform super-admin.
* Flexible resource model.
* Fixed slots, configurable by resource.
* Phone, walk-in, admin-created bookings, and temporary blocks.
* Guest checkout and registered customer accounts.
* Customer payment at venue for V1.
* Business approval required for online booking requests.
* Pending request temporarily locks inventory.
* Configurable pending expiry.
* Business can approve/reject, add internal notes, and contact
customer by phone.
* Customer can track booking status and cancel according to policy.
* Browser push notifications and OTP for booking verification.
* English and INR only.
* Search/category/location discovery; no map in V1.
* Public business listing only after verification.
* Business verification uses owner identity, phone verification, and
venue photographs.
* Three predefined business roles.
* Multiple locations per business.
* Reviews included; photographs deferred.
* Resource-level schedules and pricing.
* Multi-resource booking as one booking.
* Venue collection tracking.
* Multiple subscription tiers with configurable limits.
* Seven-day free trial.
* Manual subscription payment verification.
* Grace period followed by disabled public listing and read-only
dashboard.
* National-scale architecture, local-first rollout.
* Next.js, React, TypeScript, Tailwind, shadcn/ui, monorepo, modular
monolith, PostgreSQL.
* AWS preferred; Azure credits may influence the final cloud decision.
* Low-cost infrastructure without compromising reliability.

# Appendix B --- Important implementation cautions

1. **Never use the frontend as the authority for availability.** The
backend and database transaction must decide whether a resource can
be allocated.
2. **Do not create one booking record per resource for a multi-resource
request.** Use one booking with multiple allocations.
3. **Do not conflate approval with payment.** A booking can be approved
and still unpaid.
4. **Do not conflate booking value with money collected.** Analytics
must show both.
5. **Do not allow tenant IDs from the browser to grant access.** Derive
tenant access from the authenticated user's membership.
6. **Do not expire pending holds using only in-memory timers.** Use
durable timestamps and a retryable worker.
7. **Do not let notification failures undo a booking.** Dispatch
notifications reliably after transaction commit.
8. **Do not delete tenant history when a subscription expires.** Use a
restricted read-only state.
9. **Do not expose customer information in public listing or status
endpoints.**
10. **Do not add microservices, Kubernetes, or Redis without a measured
requirement.**

\---

**End of V1 product and technical specification.**

This is a discovery-baseline specification. Before implementation,
resolve the open decisions register and convert the logical schema/API
inventory into migration-ready database definitions and versioned API
contracts.

