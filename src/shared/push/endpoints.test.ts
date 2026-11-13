import { describe, expect, it } from "vitest";
import { isPushEndpoint } from "./endpoints";

describe("isPushEndpoint", () => {
  it("accepts the endpoints browsers hand out", () => {
    for (const endpoint of [
      "https://web.push.apple.com/QGuAyLwlxo5XOW9hAXv3cVO0lCnUI-M3lqqbm2Jwo8hHLq",
      "https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF3JUikC4ENAHEeMrd41Zxv3hVZjC9KtT8OvPVGJ",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABl",
      "https://wns2-by3p.notify.windows.com/w/?token=BQYAAAC%2f6x",
      "https://FCM.GOOGLEAPIS.COM/fcm/send/abc",
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(true);
    }
  });

  it("refuses anything that is not an https address of one of them", () => {
    for (const endpoint of [
      "",
      "not a url",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://example.com/push",
      "https://localhost/push",
      "https://169.254.169.254/latest/meta-data",
      // A known name inside another host, or in front of it.
      "https://fcm.googleapis.com.evil.example/fcm/send/abc",
      "https://evil-fcm.googleapis.com.example/x",
      "https://notfcm.googleapis.comx/x",
      "https://evilpush.apple.com/x",
      // Credentials or another port in the address.
      "https://user:secret@fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "javascript:alert(1)",
      "file:///etc/passwd",
    ]) {
      expect(isPushEndpoint(endpoint), endpoint).toBe(false);
    }
  });
});
