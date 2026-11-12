import { expect, type Page } from "@playwright/test";

/**
 * Collects what breaks on a page while a test drives it: uncaught errors and unhandled rejections.
 * A test ends by expecting the list to be empty.
 */
export function watchForErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

/** The page must never scroll sideways: on a phone, that is a broken layout. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const [content, screen] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(content, "the page is wider than the screen").toBeLessThanOrEqual(screen);
}

/** Every demo screen says it is one. */
export async function expectDemo(page: Page): Promise<void> {
  await expect(page.locator(".demo-bar")).toContainText("Demonstração");
}
