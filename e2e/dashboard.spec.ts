import { expect, test } from "@playwright/test";
import { expectDemo, expectNoSidewaysScroll, watchForErrors } from "./support";

test.describe("dashboard", () => {
  test("shows the balance and the net-worth chart, real line and forecast", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/demo/dashboard");
    await expectDemo(page);

    await expect(page.getByText("Saldo total disponível")).toBeVisible();
    // The chart is placed and shown; the real days are a solid line, the days to come a dashed one.
    await expect(page.locator('.nw[data-ready="true"]')).toBeVisible();
    await expect(page.locator(".nw-line:not(.is-expected)")).toHaveAttribute("d", /^M/);
    await expect(page.locator(".nw-line.is-expected")).toHaveAttribute("d", /^M/);
    await expect(page.locator(".nw-tick").first()).toBeVisible();

    await expectNoSidewaysScroll(page);
    expect(errors).toEqual([]);
  });

  test("reads one day with the keyboard, from today into the forecast", async ({ page }) => {
    await page.goto("/demo/dashboard");
    await expect(page.locator('.nw[data-ready="true"]')).toBeVisible();

    const day = page.locator(".nw-range");
    await expect(day).toHaveAttribute("aria-valuetext", /^Hoje, /);
    await day.focus();
    await page.keyboard.press("ArrowRight");
    await expect(day).toHaveAttribute("aria-valuetext", /\(previsto\)/);
    await expect(page.locator(".nw-tip")).toContainText("previsto");
    await page.keyboard.press("Escape");
    await expect(page.locator(".nw-tip")).toHaveCount(0);
  });

  test("goes to another month and back without leaving the demo", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/demo/dashboard");
    await expect(page.locator('.nw[data-ready="true"]')).toBeVisible();
    await expect(page.getByText("Mês atual")).toBeVisible();

    await page.getByRole("button", { name: "Mês anterior" }).first().click();
    await expect(page).toHaveURL(/\/demo\/dashboard\?m=\d{4}-\d{2}$/);
    await expect(page.getByRole("link", { name: "Voltar para hoje" })).toBeVisible();

    await page.getByRole("link", { name: "Voltar para hoje" }).click();
    await expect(page).toHaveURL(/\/demo\/dashboard$/);
    await expect(page.getByText("Mês atual")).toBeVisible();

    await expectNoSidewaysScroll(page);
    expect(errors).toEqual([]);
  });
});
