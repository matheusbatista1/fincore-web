import { z } from "zod";

/**
 * What a browser reports when something breaks: enough to find the bug, and nothing about what
 * the user has recorded. The path carries no query string; there is no cookie, no id, no value.
 */
export const clientErrorSchema = z.object({
  /** Where it was caught: a React error boundary, an uncaught error or an unhandled rejection. */
  source: z.enum(["boundary", "window", "promise"]),
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(4_000).optional(),
  /** Next's digest of a server-side error: the same one the server log carries. */
  digest: z.string().max(100).optional(),
  /** The pathname the user was on. */
  path: z.string().max(200),
});
export type ClientErrorReport = z.infer<typeof clientErrorSchema>;
