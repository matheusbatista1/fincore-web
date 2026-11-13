/**
 * A device that asked to be notified (aviso no celular): what its browser handed out when the
 * person turned the notifications on there. One per device and browser; a person can have several.
 */
export interface PushDevice {
  readonly id: string;
  /** Where the browser's push service takes messages for this device. */
  readonly endpoint: string;
  /**
   * The device's public key and shared secret, as the browser gave them (base64url). A push with
   * content would be encrypted with them; the app sends none today and keeps them for that day.
   */
  readonly p256dh: string;
  readonly auth: string;
}
