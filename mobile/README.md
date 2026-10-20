# nexGen Android app

This Expo wrapper opens the deployed nexGen application at:

`https://nexgen-ai-chat-ctkdev.vercel.app`

The APK is built with EAS using the `preview` profile so it can be installed directly on an Android device.

The Android application ID configured in `mobile/app.json` is
`com.tsekpochris.nexgen`. Keep that ID stable after the first Play Console
upload; changing it creates a different Android application.

The `public/.well-known/assetlinks.json` file is for a separately generated
PWABuilder/TWA package. If the TWA route is used, replace its package name and
SHA-256 certificate fingerprint with the values from that signed build. The
Expo WebView wrapper does not use Digital Asset Links for navigation.