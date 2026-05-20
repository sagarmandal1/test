# Secure Real-Time Android-to-Web SMS Sync Gateway

A premium, end-to-end secured real-time SMS synchronization system. This repository contains both the Android client application and the Node.js Express/SQLite web dashboard backend.

## 🚀 Key Features

* **🔑 Secure Auth Layer**: End-to-end token verification. Serves incoming API calls only when authenticated via `Authorization: Bearer <key>`.
* **🔒 Passcode Dashboard Lock**: Blurred Glassmorphism passcode drawer on first load, caching token safely in the browser's local storage.
* **📱 Persistent Foreground Gateway**: Android application keeps background threads active 24/7 with material toggles, local transaction logs, and dual-SIM + battery telemetry.
* **✨ Modern Aesthetics**: HSL obsidian dark space palette, responsive layouts, audio alerts, and regex-powered OTP code extraction with copy actions.
* **📥 Bulk Inbox Synchronizer**: Single-click back-synchronization to upload up to 50 previous inbox SMS directly to the dashboard.

## 📁 Repository Structure

* [**`sms-web-server/`**](./sms-web-server): The Express web server, SQLite database system, and public web dashboard interface.
* [**`sms-android-app/`**](./sms-android-app): The complete Android Studio Kotlin project with a foreground SMS receiver daemon.

---

Designed and built by Sagar Mandal.
