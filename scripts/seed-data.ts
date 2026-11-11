/**
 * Plain data for the demo seed: the venues, their rooms and prices, the people,
 * and the wording of reviews and reasons. Everything here is fictional.
 * The logic that turns it into rows and bookings lives in seed.ts.
 */

/** Minutes after local midnight. */
export const at = (hour: number, minute = 0) => hour * 60 + minute;
const DAY = 24 * 60;

export interface PricingRuleSpec {
  type: "base" | "time_of_day" | "day_of_week";
  label?: string;
  /** Paise per price unit (per hour or per slot). */
  amount: number;
  startMinute?: number;
  endMinute?: number;
  daysOfWeek?: number[];
}

export interface ResourceGroupSpec {
  names: string[];
  resourceType: string;
  description: string;
  bookingMode: "exclusive" | "shared";
  capacity: number;
  priceUnit: "per_hour" | "per_slot";
  pricePerPerson: boolean;
  slotMinutes: number;
  /** Daily schedule windows, [opens, closes]. A gap between two is a break. */
  windows: [number, number][];
  advanceDays: number;
  minNoticeMinutes: number;
  rules: PricingRuleSpec[];
  /** How the history generator uses this group. */
  demand: {
    /** Relative share of the location's bookings. */
    weight: number;
    /** Weights for booking 1, 2 or 3 consecutive slots. */
    lengths: [number, number, number];
    /** Party size range for one booking. */
    party: [number, number];
    /** Start windows that attract more bookings. */
    peaks: [number, number][];
    /** Chance that a booking takes several items of this group together. */
    multiChance?: number;
  };
}

export interface LocationSpec {
  name: string;
  slug: string;
  address: string;
  locality: string;
  postalCode: string;
  phone: string;
  hours: [number, number][];
  groups: ResourceGroupSpec[];
  /** Bookings generated per day, [min, max]. */
  perDay: { weekday: [number, number]; weekend: [number, number] };
}

export interface BusinessSpec {
  slug: string;
  name: string;
  description: string;
  contactPhone: string;
  amenities: string[];
  categories: string[];
  owner: { phone: string; name: string };
  plan: "Starter" | "Growth" | "Pro";
  subscription: "active" | "trialing";
  policy: {
    pendingHoldMinutes: number;
    customerCanCancelPending: boolean;
    customerCanCancelApproved: boolean;
    cancellationDeadlineMinutes: number;
    cancellationReasonRequired: boolean;
  };
  locations: LocationSpec[];
  reviews: { positive: string[]; neutral: string[]; negative: string[] };
}

export const PLANS = [
  {
    name: "Starter",
    description: "One venue, the essentials.",
    priceAmount: 99900,
    limits: { locations: 1, resources: 10, staff: 2, bookingsPerMonth: 300 },
    features: { insights: false, csvExport: false, prioritySupport: false },
    sortOrder: 1,
  },
  {
    name: "Growth",
    description: "Several locations and a bigger team.",
    priceAmount: 249900,
    limits: { locations: 3, resources: 40, staff: 10, bookingsPerMonth: 1500 },
    features: { insights: true, csvExport: true, prioritySupport: false },
    sortOrder: 2,
  },
  {
    name: "Pro",
    description: "No limits, with priority support.",
    priceAmount: 499900,
    limits: { locations: null, resources: null, staff: null, bookingsPerMonth: null },
    features: { insights: true, csvExport: true, prioritySupport: true },
    sortOrder: 3,
  },
] as const;

export const CATEGORIES = [
  { slug: "snooker-pool", name: "Snooker & Pool", description: "Snooker, pool and billiards tables." },
  { slug: "gaming-lounge", name: "Gaming Lounge", description: "PC and console gaming by the hour." },
  { slug: "swimming", name: "Swimming", description: "Lap lanes, open swim and coached sessions." },
  { slug: "football-turf", name: "Football Turf", description: "Five-a-side and seven-a-side turf." },
  { slug: "badminton", name: "Badminton", description: "Indoor courts by the hour." },
] as const;

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
export { EVERY_DAY };

export const BUSINESSES: BusinessSpec[] = [
  {
    slug: "cue-masters",
    name: "Cue Masters",
    description:
      "Full-size snooker and pool tables in the heart of Indiranagar, with a private VIP table, a snack counter and weekday coaching. A second room is open in Koramangala.",
    contactPhone: "+918041000101",
    amenities: ["Air conditioning", "Snacks and drinks", "Coaching available", "Parking", "Lockers"],
    categories: ["snooker-pool"],
    owner: { phone: "+919000000011", name: "Vikram Shetty" },
    plan: "Growth",
    subscription: "active",
    policy: {
      pendingHoldMinutes: 30,
      customerCanCancelPending: true,
      customerCanCancelApproved: true,
      cancellationDeadlineMinutes: 120,
      cancellationReasonRequired: false,
    },
    locations: [
      {
        name: "Indiranagar",
        slug: "indiranagar",
        address: "14, 12th Main Road, HAL 2nd Stage",
        locality: "Indiranagar",
        postalCode: "560038",
        phone: "+918041000101",
        hours: [[at(11), at(23)]],
        perDay: { weekday: [2, 3], weekend: [3, 5] },
        groups: [
          {
            names: ["Table 1", "Table 2", "Table 3", "Table 4", "Table 5"],
            resourceType: "snooker_table",
            description: "Full-size snooker table, 60-minute slots.",
            bookingMode: "exclusive",
            capacity: 4,
            priceUnit: "per_hour",
            pricePerPerson: false,
            slotMinutes: 60,
            windows: [[at(11), at(23)]],
            advanceDays: 14,
            minNoticeMinutes: 30,
            rules: [
              { type: "base", amount: 20000 },
              { type: "time_of_day", label: "Evening", amount: 30000, startMinute: at(17), endMinute: at(23) },
              { type: "day_of_week", label: "Weekend", amount: 35000, daysOfWeek: [0, 6] },
            ],
            demand: { weight: 5, lengths: [62, 28, 10], party: [2, 4], peaks: [[at(17), at(23)]] },
          },
          {
            names: ["VIP table"],
            resourceType: "snooker_table",
            description: "Private room with a tournament-size table, 90-minute slots.",
            bookingMode: "exclusive",
            capacity: 4,
            priceUnit: "per_hour",
            pricePerPerson: false,
            slotMinutes: 90,
            windows: [[at(11), at(23)]],
            advanceDays: 14,
            minNoticeMinutes: 30,
            rules: [
              { type: "base", amount: 20000 },
              { type: "time_of_day", label: "Evening", amount: 30000, startMinute: at(17), endMinute: at(23) },
              { type: "day_of_week", label: "Weekend", amount: 35000, daysOfWeek: [0, 6] },
            ],
            demand: { weight: 1, lengths: [80, 20, 0], party: [2, 4], peaks: [[at(17), at(23)]] },
          },
        ],
      },
      {
        name: "Koramangala",
        slug: "koramangala",
        address: "27, 80 Feet Road, 5th Block",
        locality: "Koramangala",
        postalCode: "560095",
        phone: "+918041000102",
        hours: [[at(11), at(23)]],
        perDay: { weekday: [0, 1], weekend: [1, 2] },
        groups: [
          {
            names: ["Table 1", "Table 2", "Table 3"],
            resourceType: "snooker_table",
            description: "Full-size snooker table, 60-minute slots.",
            bookingMode: "exclusive",
            capacity: 4,
            priceUnit: "per_hour",
            pricePerPerson: false,
            slotMinutes: 60,
            windows: [[at(11), at(23)]],
            advanceDays: 14,
            minNoticeMinutes: 30,
            rules: [
              { type: "base", amount: 20000 },
              { type: "time_of_day", label: "Evening", amount: 30000, startMinute: at(17), endMinute: at(23) },
              { type: "day_of_week", label: "Weekend", amount: 35000, daysOfWeek: [0, 6] },
            ],
            demand: { weight: 1, lengths: [65, 27, 8], party: [2, 4], peaks: [[at(17), at(23)]] },
          },
        ],
      },
    ],
    reviews: {
      positive: [
        "Well-kept tables and the cloth is in great shape. Easy to book and the staff were friendly.",
        "Best snooker room in the area. The VIP table is worth it for a group.",
        "Clean, quiet and the lighting is spot on. We booked two hours and it flew by.",
        "Approval came through within minutes and the table was ready when we arrived.",
        "Good cues, fair prices and the snack counter is a nice touch.",
        "Brought my father for his birthday. The team looked after us really well.",
      ],
      neutral: [
        "Good tables, but it got a bit noisy on Saturday evening.",
        "Nice place. Had to wait a few minutes past our slot for the previous group to leave.",
        "Prices are fair. Would like more parking nearby.",
      ],
      negative: [
        "Our table was not ready at the start time and nobody told us why.",
        "One cue had a worn tip and the AC was struggling that evening.",
        "Booking was fine but the evening rate felt steep for a weekday.",
      ],
    },
  },
  {
    slug: "respawn-lounge",
    name: "Respawn Lounge",
    description:
      "A gaming lounge in Koramangala with high-refresh gaming PCs and PlayStation 5 consoles you can book by the hour, open until midnight.",
    contactPhone: "+918041000201",
    amenities: ["Air conditioning", "High-speed fibre internet", "Headsets provided", "Snacks and drinks", "Late opening"],
    categories: ["gaming-lounge"],
    owner: { phone: "+919000000012", name: "Neha Kulkarni" },
    plan: "Growth",
    subscription: "trialing",
    policy: {
      pendingHoldMinutes: 20,
      customerCanCancelPending: true,
      customerCanCancelApproved: true,
      cancellationDeadlineMinutes: 60,
      cancellationReasonRequired: false,
    },
    locations: [
      {
        name: "Koramangala",
        slug: "koramangala",
        address: "9, 1st Cross, 6th Block",
        locality: "Koramangala",
        postalCode: "560095",
        phone: "+918041000201",
        hours: [[at(10), DAY]],
        perDay: { weekday: [2, 3], weekend: [3, 5] },
        groups: [
          {
            names: Array.from({ length: 8 }, (_, i) => `PC ${String(i + 1).padStart(2, "0")}`),
            resourceType: "gaming_pc",
            description: "Gaming PC with a 240 Hz monitor, mechanical keyboard and headset.",
            bookingMode: "exclusive",
            capacity: 1,
            priceUnit: "per_hour",
            pricePerPerson: false,
            slotMinutes: 60,
            windows: [[at(10), DAY]],
            advanceDays: 14,
            minNoticeMinutes: 0,
            rules: [
              { type: "base", amount: 10000 },
              { type: "time_of_day", label: "After 6 pm", amount: 15000, startMinute: at(18), endMinute: DAY },
            ],
            demand: { weight: 8, lengths: [45, 35, 20], party: [1, 1], peaks: [[at(17), DAY]], multiChance: 0.14 },
          },
          {
            names: ["PlayStation 1", "PlayStation 2", "PlayStation 3"],
            resourceType: "console",
            description: "PlayStation 5 on a 55-inch screen with two controllers, room for four.",
            bookingMode: "exclusive",
            capacity: 4,
            priceUnit: "per_hour",
            pricePerPerson: false,
            slotMinutes: 60,
            windows: [[at(10), DAY]],
            advanceDays: 14,
            minNoticeMinutes: 0,
            rules: [
              { type: "base", amount: 25000 },
              { type: "time_of_day", label: "After 6 pm", amount: 30000, startMinute: at(18), endMinute: DAY },
            ],
            demand: { weight: 3, lengths: [50, 35, 15], party: [2, 4], peaks: [[at(17), DAY]] },
          },
        ],
      },
    ],
    reviews: {
      positive: [
        "Fast PCs, no lag, and the headsets are actually good. Booked online in under a minute.",
        "Great spot for a group night on the PlayStation. The screen is huge.",
        "Open late, which is rare. We played until close and nobody rushed us.",
        "Confirmation arrived quickly and the PCs were set up when we walked in.",
        "Clean setup and a decent snack menu. Will book again.",
      ],
      neutral: [
        "Good machines but the lounge gets loud after 8 pm.",
        "Fine overall. A few minutes of waiting at check-in.",
        "Prices are okay. Would like a few more game titles on the consoles.",
      ],
      negative: [
        "One controller was drifting and we had to ask twice for a replacement.",
        "Our PC restarted twice during a match. They were apologetic but it spoiled the evening.",
        "Request sat pending for a long time before they replied.",
      ],
    },
  },
  {
    slug: "bluelane-aquatics",
    name: "Bluelane Aquatics",
    description:
      "A heated 25-metre pool in HSR Layout with private lap lanes, open swim and a kids session, run by certified lifeguards.",
    contactPhone: "+918041000301",
    amenities: ["Heated pool", "Certified lifeguards", "Changing rooms", "Showers", "Parking"],
    categories: ["swimming"],
    owner: { phone: "+919000000013", name: "Arjun Bhat" },
    plan: "Starter",
    subscription: "active",
    policy: {
      pendingHoldMinutes: 60,
      customerCanCancelPending: true,
      customerCanCancelApproved: true,
      cancellationDeadlineMinutes: 180,
      cancellationReasonRequired: false,
    },
    locations: [
      {
        name: "HSR Layout",
        slug: "hsr-layout",
        address: "41, 27th Main, Sector 1",
        locality: "HSR Layout",
        postalCode: "560102",
        phone: "+918041000301",
        hours: [
          [at(6), at(10)],
          [at(16), at(21)],
        ],
        perDay: { weekday: [2, 3], weekend: [3, 4] },
        groups: [
          {
            names: ["Lane 1", "Lane 2", "Lane 3", "Lane 4"],
            resourceType: "swim_lane",
            description: "Private lap lane, 45-minute slots, up to four swimmers.",
            bookingMode: "exclusive",
            capacity: 4,
            priceUnit: "per_slot",
            pricePerPerson: false,
            slotMinutes: 45,
            windows: [
              [at(6), at(10)],
              [at(16), at(21)],
            ],
            advanceDays: 21,
            minNoticeMinutes: 60,
            rules: [{ type: "base", amount: 35000 }],
            demand: { weight: 4, lengths: [78, 22, 0], party: [1, 4], peaks: [[at(6), at(8)], [at(17), at(20)]] },
          },
          {
            names: ["Open swim"],
            resourceType: "swim_session",
            description: "Shared pool time, up to 20 swimmers per hour.",
            bookingMode: "shared",
            capacity: 20,
            priceUnit: "per_slot",
            pricePerPerson: true,
            slotMinutes: 60,
            windows: [
              [at(6), at(10)],
              [at(16), at(21)],
            ],
            advanceDays: 21,
            minNoticeMinutes: 60,
            rules: [{ type: "base", amount: 20000 }],
            demand: { weight: 4, lengths: [100, 0, 0], party: [1, 5], peaks: [[at(6), at(8)], [at(17), at(20)]] },
          },
          {
            names: ["Kids session"],
            resourceType: "swim_session",
            description: "Supervised kids session in the shallow end, up to 12 children.",
            bookingMode: "shared",
            capacity: 12,
            priceUnit: "per_slot",
            pricePerPerson: true,
            slotMinutes: 60,
            windows: [
              [at(6), at(10)],
              [at(16), at(21)],
            ],
            advanceDays: 21,
            minNoticeMinutes: 60,
            rules: [{ type: "base", amount: 30000 }],
            demand: { weight: 2, lengths: [100, 0, 0], party: [1, 3], peaks: [[at(16), at(19)]] },
          },
        ],
      },
    ],
    reviews: {
      positive: [
        "Spotless pool and the water temperature is just right. The lap lane was uncrowded.",
        "Our kids loved the kids session and the lifeguards were attentive.",
        "Easy to book a lane before work. Confirmation came quickly.",
        "Well organised. Showers and changing rooms are clean.",
        "Great early morning slots. Will keep booking.",
      ],
      neutral: [
        "Good pool, but open swim felt crowded around 6 pm.",
        "Fine experience. Parking is tight on weekends.",
        "Lane was ready on time. Wish there were more evening slots.",
      ],
      negative: [
        "The lane was shared with another group despite booking it privately.",
        "Water felt cold on a Monday morning.",
        "Waited a while at the desk to check in.",
      ],
    },
  },
];

export const RESPONSES = {
  thanks: [
    "Thank you for the kind words. We look forward to hosting you again.",
    "Glad you enjoyed it. See you soon.",
    "Thanks for the review. It means a lot to the whole team.",
    "Much appreciated. We will pass this on to the team.",
  ],
  apology: [
    "Sorry about this. We have spoken to the team and are fixing it. Please call us next time and we will make it right.",
    "Thank you for telling us. That is not the standard we aim for and we are looking into it.",
    "We apologise for the experience. Please reach out to us directly so we can put this right.",
  ],
};

export const REJECT_REASONS = [
  "Fully booked for a private event at that time.",
  "That slot is held for a regular booking.",
  "Equipment is under maintenance at that time.",
  "We are closed early that day.",
];

export const BUSINESS_CANCEL_REASONS = [
  "Equipment fault. We called to offer another time.",
  "Power outage at the venue.",
  "Private event confirmed for that slot.",
  "Staff shortage. Sorry for the short notice.",
];

export const CUSTOMER_CANCEL_REASONS = ["Plans changed.", "Friends dropped out.", "Running late, will rebook.", "Travel plans changed."];

export const CUSTOMER_NOTES = [
  "Birthday group, please keep the area tidy.",
  "First time here. Could someone show us around?",
  "Will arrive five minutes late.",
  "Need an extra chair or two.",
  "Bringing a friend who is a beginner.",
];

export const INTERNAL_NOTES = [
  "Regular customer. Offered a discount at the counter.",
  "Paid advance by UPI over the phone.",
  "Asked for the quietest corner.",
  "Called to confirm the booking.",
];

export const FIRST_NAMES = [
  "Aarav", "Diya", "Ishaan", "Meera", "Rohan", "Saanvi", "Kabir", "Tara", "Aditya", "Nisha", "Vihaan", "Pooja",
  "Karthik", "Anjali", "Siddharth", "Lakshmi", "Manav", "Riya", "Harsh", "Divya", "Nikhil", "Sneha", "Pranav", "Zoya",
];

export const LAST_NAMES = [
  "Sharma", "Nair", "Reddy", "Iyer", "Gowda", "Menon", "Patil", "Rao", "Kapoor", "Joshi", "Banerjee", "Naidu",
  "Hegde", "Pillai", "Desai", "Bhat", "Kulkarni",
];

/** How many fictional customers to create, besides the demo customer. */
export const CUSTOMER_COUNT = 70;

export const DEMO_LOGINS = {
  superAdmin: { phone: "+919000000001", name: "Krello Admin" },
  manager: { phone: "+919000000021", name: "Kavya Iyer" },
  staff: { phone: "+919000000031", name: "Sanjay Gowda" },
  customer: { phone: "+919000000091", name: "Ananya Rao" },
};
