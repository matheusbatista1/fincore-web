import { notFound } from "next/navigation";

/**
 * Whether the demo area (`/demo`) is switched on: the real screens over made-up data, with no
 * sign-in and nothing to write to. `FINCORE_DEMO=1` turns it on — for the browser tests and for
 * showing the app; it stays unset everywhere else.
 *
 * Read straight from the process (not through the validated `env`): the demo must work where no
 * other variable is set, and this one is neither a secret nor required.
 */
export const demoEnabled = (): boolean => process.env.FINCORE_DEMO === "1";

/**
 * The first line of every demo layout AND page: with the demo off, the route does not exist.
 * (A layout and its page render side by side, so the layout's check alone would not stop the page
 * from doing its work.)
 */
export function requireDemo(): void {
  if (!demoEnabled()) notFound();
}
