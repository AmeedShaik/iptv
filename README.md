# IPTV Dashboard - Android app

The IPTV dashboard packaged with Capacitor. Playlists come straight from the iptv-org/iptv GitHub
repository (no Python server needed), and channels play in Android's native ExoPlayer, so there are no
CORS limits and the local proxy is no longer needed.

## Easiest: build in the cloud (no Android Studio)

1. Create a new GitHub repository and push this folder to it (`git init`, `git add .`, `git commit`, `git push`).
2. Open the repo's **Actions** tab. The **Build APK** workflow runs on every push (or click **Run workflow**).
3. When it finishes (about 5-8 minutes), open the run and download the **iptv-dashboard-debug-apk** artifact.
4. Unzip it and copy `app-debug.apk` to your phone, then install it (allow "Install unknown apps" when asked).

## Or: build on your PC (Windows)

Prerequisites: Node.js 22+, and Android Studio (provides JDK 21 and the Android SDK).
Double-click `build-local.bat`. The APK ends up in `android\app\build\outputs\apk\debug\app-debug.apk`.

You can also open the `android` folder in Android Studio and use Build > Build APK(s).

## Run the web version from GitHub (GitHub Pages)

1. Push this folder to a GitHub repository (branch `main`).
2. In the repo go to **Settings > Pages** and set **Source** to **GitHub Actions**.
3. The **Deploy web version to GitHub Pages** workflow runs on every push. When it finishes, your site is at
   `https://YOUR-USERNAME.github.io/YOUR-REPO/`.

The web version is a preview: it loads playlists fine, but browsers block many streams (CORS, and `http://`
streams on an `https://` page). The Android app plays far more channels.

## Using the app

- The app opens on a picker: choose Countries, Categories or Languages, then tap one (or paste a custom `.m3u` URL under "Custom playlist URL"). The Back button returns to the picker.
- Tap a channel to open it in the fullscreen native player. Back closes it.
- Star channels to save favorites; the star button above the list filters to favorites.
- The refresh button re-downloads the playlist (playlists are cached for 6 hours).

## Project layout

```
www/                      web UI (index.html, assets/js/app.js, assets/css/*)
android/                  generated + patched Capacitor Android project
scripts/patch-android.js  allows http:// streams, adds Android TV support (idempotent)
scripts/copy-vendor.js    copies lucide / hls.js from node_modules
capacitor.config.json     app id, name, plugin settings
build-local.bat           one-click local build (Windows)
.github/workflows/        cloud APK build
```

After editing anything in `www/`, run `npm run sync` to rebuild the CSS and copy the files into the Android project.
To change the app name or id, edit `capacitor.config.json` and `android/app/src/main/res/values/strings.xml`.

## Notes

- This is a debug-signed APK, fine for installing on your own devices. Publishing to the Play Store needs a release keystore.
- Many public streams are offline or geo-blocked at any time. If one fails, try another.
- Opening `www/index.html` through any local web server gives a browser preview (hls.js, subject to CORS).
