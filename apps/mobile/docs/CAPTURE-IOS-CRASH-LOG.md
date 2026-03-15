# Capture iOS crash log for Add Photo (Profile → Photos)

Use this when the app exits to home screen on **Profile → Photos → Add photo** so we can fix from the real crash reason.

## Option A: Xcode Device Logs (recommended)

1. Connect the iPhone via USB.
2. In Xcode: **Window → Devices and Simulators** (⇧⌘2).
3. Select your iPhone in the left sidebar.
4. Click **View Device Logs**.
5. Find the most recent crash for **mobile** or **Vibely** (sort by Date).
6. Double-click to open, or right-click → **Export Log** and save the `.crash` or `.ips` file.
7. Share the file (or paste the **Exception Type**, **Termination Reason**, and **Backtrace** / **Thread 0 Crashed** section).

## Option B: Console.app (live stream)

1. Connect the iPhone via USB.
2. Open **Console.app** (Applications → Utilities).
3. Select your iPhone in the left sidebar.
4. Click **Start** to stream logs.
5. Reproduce: open app → Profile → Photos → tap **Add photo**.
6. When the app exits, stop the stream and search for `mobile`, `Vibely`, `assertion`, `termination`, `ImagePicker`, `PHPhoto`, `NSPhotoLibrary`.
7. Copy the relevant lines (timestamp + message) and share.

## Option C: Crash report from the iPhone

1. After the crash: **Settings → Privacy & Security → Analytics & Improvements → Analytics Data**.
2. Find an entry that starts with **mobile** or your app name and the date/time of the crash.
3. Tap it → Share → save or send the file.

---

**What we need from the log:** The **termination reason** and, if present, the **exception type** and **crashed thread backtrace** (first few frames are enough).
