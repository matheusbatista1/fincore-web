import { expect, type Page, test } from "@playwright/test";
import { expectDemo, expectNoSidewaysScroll, watchForErrors } from "./support";

/** Hands the demo's own statement file to the screen, the way a person would after downloading it. */
async function chooseDemoStatement(page: Page): Promise<void> {
  await page.goto("/demo/reconcile");
  await expectDemo(page);
  const link = page.locator("#demo-statement");
  const href = (await link.getAttribute("href")) ?? "";
  const csv = decodeURIComponent(href.slice(href.indexOf(",") + 1));
  expect(csv).toContain("Data;Descrição;Valor");
  await page.locator('.rc-drop input[type="file"]').setInputFiles({
    name: (await link.getAttribute("download")) ?? "extrato-demo.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });
  await expect(page.locator(".rc-verdict")).toBeVisible();
}

const section = (page: Page, title: string) =>
  page.locator(".card", { has: page.getByRole("heading", { name: title, exact: true }) });

test.describe("conferir extrato", () => {
  test("says what the statement has that the app does not, and the other way round", async ({ page }) => {
    const errors = watchForErrors(page);
    await chooseDemoStatement(page);

    await expect(page.locator(".rc-verdict h3")).toHaveText(
      "3 linhas do banco não estão no app · 1 lançamento seu não está no extrato",
    );
    // What is missing in the app: two fees and a yield.
    const missing = section(page, "Falta lançar no app");
    await expect(missing.locator(".rc-row")).toHaveCount(3);
    await expect(missing).toContainText("TARIFA PACOTE SERVICOS");
    await expect(missing).toContainText("RENDIMENTO CDB");
    // What the bank does not have: the tank paid in cash.
    const extra = section(page, "No app, mas não no extrato");
    await expect(extra.locator(".rc-row")).toHaveCount(1);
    await expect(extra).toContainText("Combustível");
    // The three tolls the app books as one entry.
    const joined = section(page, "Juntei para você");
    await expect(joined).toContainText("3 linhas do banco = 1 lançamento seu");
    await expect(joined).toContainText("Pedágios do mês");
    // The purchase and its refund.
    await expect(section(page, "Linhas do banco que se anulam").locator(".rc-row")).toHaveCount(2);
    await expect(page.locator(".rc-details > summary")).toContainText("Conferem");

    await expectNoSidewaysScroll(page);
    expect(errors).toEqual([]);
  });

  test("books a missing line: the form opens already filled", async ({ page }) => {
    await chooseDemoStatement(page);
    const yieldRow = section(page, "Falta lançar no app").locator(".rc-row", { hasText: "RENDIMENTO CDB" });
    await yieldRow.getByRole("button", { name: "Lançar" }).click();

    const form = page.getByRole("dialog");
    await expect(form.getByRole("heading", { name: "Novo lançamento" })).toBeVisible();
    // Money that came in: an income, of that amount, called what the bank calls it.
    await expect(form.getByRole("button", { name: /Adicionar receita/ })).toBeVisible();
    await expect(form.getByRole("textbox", { name: "Valor" })).toHaveValue("R$ 3,21");
    await expect(form.locator('input[value="RENDIMENTO CDB"]')).toBeVisible();
  });

  test("joins two lines into one entry worth their sum", async ({ page }) => {
    await chooseDemoStatement(page);
    const fees = section(page, "Falta lançar no app").locator(".rc-row", {
      hasText: "TARIFA PACOTE SERVICOS",
    });
    await fees.nth(0).getByRole("checkbox").check();
    await fees.nth(1).getByRole("checkbox").check();
    const bar = page.locator(".rc-join");
    await expect(bar).toContainText("2 linhas");
    await bar.getByRole("button", { name: "Juntar em 1 lançamento" }).click();

    const form = page.getByRole("dialog");
    await expect(form.getByRole("button", { name: /Adicionar despesa/ })).toBeVisible();
    await expect(form.getByRole("textbox", { name: "Valor" })).toHaveValue("R$ 25,80");
    await expect(form.locator('input[value="TARIFA PACOTE SERVICOS"]')).toBeVisible();
  });

  test("compares the balance the bank shows with the app's", async ({ page }) => {
    await chooseDemoStatement(page);
    // Typing the app's own balance: the two agree.
    const app = (await page.locator(".rc-balance .rc-sub strong").textContent()) ?? "";
    await page.locator("#rc-balance").fill(app.replace("R$", "").trim());
    await expect(page.locator(".rc-balance-say")).toHaveText("O saldo bate com o do banco.");
    await page.locator("#rc-balance").fill("não é um valor");
    await expect(page.locator(".rc-balance")).toContainText("Não entendi esse valor.");
  });
});
