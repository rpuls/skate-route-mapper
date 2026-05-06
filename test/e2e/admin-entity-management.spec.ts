import { expect, test } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "admin@example.com";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "local-dev-admin-password";

test("admin can create and delete a ride entity record", async ({ page }) => {
  const rideId = `e2e-ride-${Date.now()}`;

  await page.goto("/");
  await page.getByLabel("Email").fill(adminEmail);
  await page.getByLabel("Password").fill(adminPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(`${adminEmail} is signed in.`)).toBeVisible();

  await page.getByRole("button", { exact: true, name: "Entities" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Entity management" })).toBeVisible();

  await page.getByRole("tab", { name: "Rides" }).click();
  await expect(page.getByRole("heading", { name: "Rides" })).toBeVisible();

  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.getByRole("heading", { name: "Create ride" })).toBeVisible();
  const createRideDialog = page.getByRole("dialog", { name: "Create ride" });
  const enumControls = createRideDialog.getByRole("combobox");

  await createRideDialog.getByRole("textbox", { exact: true, name: "Id" }).fill(rideId);
  await createRideDialog.getByLabel("Started At").fill("2026-05-06T10:30");
  await enumControls.nth(0).click();
  await page.getByRole("option", { name: "skates" }).click();
  await enumControls.nth(1).click();
  await page.getByRole("option", { name: "phone" }).click();
  await page.getByRole("button", { name: "Create" }).click();

  await expect(page.getByRole("cell", { name: rideId })).toBeVisible();

  await page.getByRole("cell", { name: rideId }).click();
  await expect(page.getByRole("heading", { name: "Edit ride" })).toBeVisible();

  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain(rideId);
    await dialog.accept();
  });

  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("cell", { name: rideId })).toHaveCount(0);
});
