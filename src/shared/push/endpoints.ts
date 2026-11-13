/**
 * The push services a browser can hand out an endpoint of: Apple (Safari, and every browser on
 * iOS), Google (Chrome and the Chromium family), Mozilla (Firefox) and Microsoft (Edge on Windows).
 *
 * The server sends a notification by POSTing to the endpoint the browser gave it. That address
 * comes from the client, so it is only ever accepted when it is an https URL of one of these hosts:
 * a made-up endpoint must not be able to point the server at another machine.
 */
const PUSH_SERVICE_HOSTS = [
  "push.apple.com",
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
] as const;

/** Whether `value` is the address of a known push service: https, default port, no credentials. */
export function isPushEndpoint(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username !== "" || url.password !== "") {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}
