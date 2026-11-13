import { expect, test } from "@playwright/test";
import { expectDemo, expectNoSidewaysScroll, watchForErrors } from "./support";

test.describe("dashboard", () => {
  test("shows the balance and the net-worth chart, real line and forecast", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/demo/dashboard");
    await expectDemo(page);

    await expect(page.getByText("Saldo total disponível")).toBeVisible();
    // Three accounts, one of them set aside: it is out of the available balance and shows as invested.
    await expect(page.getByText("em 2 contas")).toBeVisible();
    await page.getByRole("button", { name: "O que conta como investido" }).click();
    await expect(page.getByRole("tooltip")).toContainText("fora do saldo disponível");
    await page.keyboard.press("Escape");
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

  test("shows what was changed in a transaction, from its detail", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/demo/dashboard");
    await expect(page.locator('.nw[data-ready="true"]')).toBeVisible();

    const detail = page.getByRole("dialog");
    const showHistory = detail.getByRole("button", { name: "Ver histórico de alterações" });

    // A fatura payment is a line of the statement, not a transaction of its own: no history to ask for.
    await page.locator(".lrow", { hasText: "Pagamento de fatura" }).first().click();
    await expect(detail).toContainText("Detalhe da transação");
    await expect(showHistory).toHaveCount(0);
    await detail.getByRole("button", { name: "Fechar" }).last().click();
    await expect(detail).toHaveCount(0);

    // A transaction opens its detail with the history closed until asked for.
    await page.locator(".lrow", { hasText: "Aluguel" }).first().click();
    await expect(detail).toContainText("Aluguel");
    await expect(detail.locator(".tx-hist")).toHaveCount(0);

    await showHistory.click();
    const history = detail.locator(".tx-hist");
    await expect(history.locator(".tx-hist-entry")).toHaveCount(2);
    await expect(history.locator(".tx-hist-entry").first()).toContainText("Editado");
    await expect(history.locator(".tx-hist-entry").first()).toContainText("Valor");
    await expect(history.locator(".tx-hist-entry").last()).toContainText("Criado");
    await expectNoSidewaysScroll(page);

    await history.getByRole("button", { name: "Ocultar" }).click();
    await expect(detail.locator(".tx-hist")).toHaveCount(0);
    expect(errors).toEqual([]);
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
