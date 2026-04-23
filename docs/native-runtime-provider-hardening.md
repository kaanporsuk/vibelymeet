# Native runtime and provider hardening notes

## Push provider boundary

- OneSignal owns remote push delivery, foreground display decisions, and click/deep-link lifecycle.
- `expo-notifications` is used only for OS permission/status utility calls.
- Do not add `Notifications.setNotificationHandler`, `addNotificationReceivedListener`, or `addNotificationResponseReceivedListener` while OneSignal is the active delivery provider.

## iOS React SwiftUI duplicate class loading

The generated iOS workspace was observed linking both:

- `React.framework` from `React-Core-prebuilt`
- static `RCTSwiftUI` / `RCTSwiftUIWrapper`

That combination can load the React SwiftUI classes twice at runtime. The generated `apps/mobile/ios` tree is ignored by git, so the durable repo change in this PR is the diagnosis and rebuild delta rather than a committed Podfile diff.

### Rebuild delta

1. In the generated iOS project, set `apps/mobile/ios/Podfile.properties.json`:

   ```json
   {
     "expo.jsEngine": "hermes",
     "EX_DEV_CLIENT_NETWORK_INSPECTOR": "true",
     "ios.buildReactNativeFromSource": "true"
   }
   ```

2. Reinstall pods from `apps/mobile/ios`:

   ```sh
   rm -rf Pods Podfile.lock
   pod install
   ```

3. Confirm `Pods/Target Support Files/Pods-Vibely/Pods-Vibely.release.xcconfig` no longer links the prebuilt React framework alongside static `RCTSwiftUI` libraries.

4. Clean Xcode derived data before the next native rebuild.

For a tracked long-term fix, move the property into the mobile prebuild/config generation path before the next regenerated iOS commit.
