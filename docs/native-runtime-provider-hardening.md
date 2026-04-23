# Native runtime and provider hardening notes

## Push provider boundary

- OneSignal owns remote push delivery, foreground display decisions, and click/deep-link lifecycle.
- OneSignal native permission APIs also own OS permission/status reads and permission prompting.
- `expo-notifications` is no longer linked in the mobile runtime.
- Do not add `Notifications.setNotificationHandler`, `addNotificationReceivedListener`, or `addNotificationResponseReceivedListener` while OneSignal is the active delivery provider.

## iOS React SwiftUI duplicate class loading

The generated iOS workspace was observed linking both:

- `React.framework` from `React-Core-prebuilt`
- static `RCTSwiftUI` / `RCTSwiftUIWrapper`

That combination can load the React SwiftUI classes twice at runtime.

### Durable tracked fix (source-controlled)

The mobile app now enforces this in tracked config via Expo plugin:

- `apps/mobile/plugins/withIosBuildReactNativeFromSource.js`
- wired from `apps/mobile/app.config.js`

The plugin writes:

```json
{
  "ios.buildReactNativeFromSource": "true"
}
```

into generated `apps/mobile/ios/Podfile.properties.json` during prebuild, so the setting survives every regen.

### Local rebuild steps after config change

1. Regenerate iOS native project from mobile root:

   ```sh
   npx expo prebuild --platform ios --clean
   ```

2. Reinstall pods from `apps/mobile/ios`:

   ```sh
   rm -rf Pods Podfile.lock
   pod install
   ```

3. Clean Xcode derived data before device validation.

4. Confirm generated `Pods-Vibely.*.xcconfig` no longer links prebuilt `React.framework` with static `RCTSwiftUI` libs in the same runtime path.

## iOS runtime hygiene (UIScene)

- Added tracked Info.plist config in `apps/mobile/app.json`:
  - `UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes = false`
- Goal: explicit UIScene manifest baseline for iOS runtime hygiene without broad iOS project refactors.

## Push delegate ownership (native)

- Confirmed current source keeps OneSignal as the only remote push click/foreground lifecycle owner:
  - `apps/mobile/components/NotificationDeepLinkHandler.tsx` uses `OneSignal.Notifications.addEventListener(...)`.
- Confirmed no competing `expo-notifications` delegate/event ownership (`setNotificationHandler`, response listeners, etc.) in mobile runtime code.
- Removed the `expo-notifications` package and reinstalled iOS pods so `UNUserNotificationCenter` delegation stays single-owner under OneSignal.

## Web service-worker warning

- Repo-owned worker files are thin OneSignal delegates only:
  - `public/OneSignalSDK.sw.js`
  - `public/OneSignalSDKWorker.js`
- No repo-owned late `message` handler registration was found in worker bootstrap code.
- Any remaining warning about `message` handler registration timing is currently attributed to third-party OneSignal worker internals and is not safely patchable in this repo.

## External/manual separation

- RevenueCat / App Store Connect product approval remains external/manual and is not a repo code-trackable fix.
