/**
 * Preference keys, kept apart from the storage implementations.
 *
 * `preferences.ts` and `preferences.web.ts` are resolved per platform, so one
 * cannot import the other: on web, `./preferences` resolves back to the web
 * file itself. The keys are platform-neutral, so they live here and both
 * implementations re-export them.
 */
export const preferenceKeys = {
  /** The ride type last started, so the sheet opens on the right one. */
  vehicleType: "pref.vehicle-type.v1",
  /** Whether the XIAO should be reconnected without being asked. */
  autoConnectXiao: "pref.xiao-auto-connect.v1",
  /**
   * Whether a XIAO has ever been connected on this phone.
   *
   * Auto-connect is gated on this. Scanning asks for Bluetooth permission, and
   * a first launch should not open with a permission dialog for hardware the
   * person may not own.
   */
  xiaoEverConnected: "pref.xiao-ever-connected.v1",
  /**
   * The last XIAO this phone was linked to.
   *
   * A board that has been met before is reached by id instead of scanned for,
   * which is the difference between a link that returns in about a second and
   * one that waits out a fifteen-second scan. Remembering it across launches
   * is what makes opening the app with the sensor already clipped on feel like
   * it never disconnected.
   */
  xiaoDeviceId: "pref.xiao-device-id.v1",
  /** That board's advertised name, so the app can say what it is reconnecting to. */
  xiaoDeviceName: "pref.xiao-device-name.v1",
  /**
   * Whether an account has ever existed on this phone.
   *
   * Set on a successful sign-up or sign-in, and never cleared by signing out:
   * the question it answers is "has this person made an account", not "are
   * they signed in now". That is what decides whether the auth screen opens on
   * sign-up or on log-in.
   */
  accountKnown: "pref.account-known.v1",
} as const;

export type PreferenceKey = (typeof preferenceKeys)[keyof typeof preferenceKeys];
