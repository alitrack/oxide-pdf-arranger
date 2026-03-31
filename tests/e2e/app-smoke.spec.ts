import { expect, test } from "@playwright/test";

test("renders the workspace shell and empty state", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("Oxide PDF Arranger")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Backend-ready workspace for page arrangement." }),
  ).toBeVisible();
  await expect(page.getByText("No document loaded yet.")).toBeVisible();
});
