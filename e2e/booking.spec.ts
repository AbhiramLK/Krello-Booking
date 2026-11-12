import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The whole booking loop in a real browser, against a freshly seeded database:
 * a customer asks for a slot, the slot is held for everyone else, the venue
 * approves it, and the venue records a part payment.
 */

/** A phone number no earlier run, seed row or test has used. */
const freshPhone = () => `98${String(Date.now()).slice(-8)}`;

/** Reads the code from the demo-mode notice (the console OTP provider shows it on screen). */
async function demoCode(page: Page): Promise<string> {
  const notice = page.getByText(/Demo mode: your code is/);
  await expect(notice).toBeVisible();
  const code = (await notice.innerText()).match(/\d{6}/)?.[0];
  if (!code) throw new Error("The demo notice shows no 6-digit code.");
  return code;
}

/** The 6-digit boxes accept the whole code at once, which verifies it. */
async function enterCode(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 6").fill(code);
}

async function signInAs(page: Page, phone: string, landing: RegExp) {
  await page.goto("/login");
  await page.getByLabel("Mobile number").fill(phone);
  await page.getByRole("button", { name: "Send code" }).click();
  await enterCode(page, await demoCode(page));
  await expect(page).toHaveURL(landing);
}

/** Opens a venue page on tomorrow's slots. */
async function openTomorrow(page: Page, slug: string) {
  await page.goto(`/${slug}`);
  await page.getByRole("button", { name: /^Tomorrow, / }).click();
}

/** A slot button on the public grid, found by its table and time range. */
const slotAt = (page: Page, table: string, range: string): Locator =>
  page.getByRole("button", { name: new RegExp(`^${table}, ${range.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });

test("a customer's request is held, approved by the venue and part-paid", async ({ page, browser, baseURL }) => {
  const guestName = `Playwright Guest ${Date.now().toString().slice(-6)}`;
  let statusUrl = "";
  let range = "";
  let bookingPath = "";

  await test.step("1. search for snooker and open Cue Masters", async () => {
    await page.goto("/");
    await page.getByLabel("What do you want to book").fill("snooker");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page).toHaveURL(/\/search\?.*q=snooker/);
    await page.locator('a[href="/cue-masters"]').first().click();
    await expect(page).toHaveURL(/\/cue-masters$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Cue Masters");
  });

  await test.step("2. pick tomorrow's first open Table 2 slot and send a verified request", async () => {
    await page.getByRole("button", { name: /^Tomorrow, / }).click();
    // Open slots carry a price; held and booked ones say so instead.
    const firstOpen = page.getByRole("button", { name: /^Table 2, .*, ₹[\d,]+/ }).first();
    await expect(firstOpen).toBeVisible();
    const label = (await firstOpen.getAttribute("aria-label"))!;
    range = label.split(", ")[1]!;
    await firstOpen.click();
    await page.getByRole("button", { name: "Continue" }).click();

    await page.getByLabel("Name", { exact: true }).fill(guestName);
    await page.getByLabel("Mobile number").fill(freshPhone());
    await page.getByRole("button", { name: "Verify phone to continue" }).click();
    await enterCode(page, await demoCode(page));
    await page.waitForURL(/\/booking\//);
    statusUrl = page.url();
  });

  await test.step("3. the status page says the request is awaiting the venue", async () => {
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Awaiting venue response");
  });

  const visitor = await browser.newContext({ baseURL });
  const other = await visitor.newPage();
  await test.step("4. in another browser the same slot reads On hold", async () => {
    await openTomorrow(other, "cue-masters");
    await expect(slotAt(other, "Table 2", range)).toContainText("On hold");
  });

  const ownerContext = await browser.newContext({ baseURL });
  const owner = await ownerContext.newPage();
  await test.step("5. the owner signs in and approves the request", async () => {
    await signInAs(owner, "9000000011", /\/dashboard/);
    await owner.getByRole("link", { name: /^Requests/ }).click();
    await expect(owner).toHaveURL(/\/dashboard\/requests/);
    const card = owner.getByRole("article", { name: guestName });
    await expect(card).toBeVisible();
    bookingPath = (await card.getByRole("link", { name: /^Details/ }).getAttribute("href"))!;
    await card.getByRole("button", { name: /^Approve/ }).click();
    await expect(owner.getByText("Request approved")).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  await test.step("6. the status page now reads Confirmed and the public slot reads Booked", async () => {
    await page.goto(statusUrl);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Confirmed");
    await openTomorrow(other, "cue-masters");
    await expect(slotAt(other, "Table 2", range)).toContainText("Booked");
  });

  await test.step("7. the owner records ₹100 cash: Partly paid, still Confirmed", async () => {
    await owner.goto(bookingPath);
    await expect(owner.getByRole("heading", { level: 1 })).toHaveText(guestName);

    const amount = owner.getByLabel("Amount (₹)");
    await amount.fill("100");
    await owner.getByLabel("Paid by").selectOption("cash");
    await owner.getByRole("button", { name: "Record payment" }).click();

    await expect(owner.getByText("Payment recorded")).toBeVisible();
    // The two badges in the page header: booking status and payment status are separate.
    const header = owner.locator("article");
    await expect(header.locator('[data-payment-status="partially_paid"]')).toHaveText("Partly paid");
    await expect(header.locator('[data-status="approved"]')).toHaveText("Confirmed");
    await expect(owner.getByRole("list", { name: "Payment ledger" })).toContainText("₹100");
  });

  await visitor.close();
  await ownerContext.close();
});
