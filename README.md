# mcode

An Android code editor with a web-based editing interface and integrated terminal
support through LunusDroid.

## Requirements

- Android Studio or JDK 11+
- Android SDK 36
- Node.js and npm

## Build

Build and test the Android app (the Gradle build also builds the web editor):

```bash
./gradlew test assembleRelease
```

Run the web editor tests independently:

```bash
cd web
npm ci
npm test
```

The Android APK is written to
`app/build/outputs/apk/release/app-release-unsigned.apk`. It is unsigned and
must be signed with your own release key before distribution or installation.

## Release

Source releases are published on the
[GitHub Releases page](https://github.com/g4b3r-android/mcode/releases).
