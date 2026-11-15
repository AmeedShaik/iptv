@echo off
setlocal EnableExtensions EnableDelayedExpansion
title IPTV Dashboard - Local APK Build
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js 22 or newer was not found. Install it from https://nodejs.org/
    pause
    goto :eof
)

rem ---- Java 21 (Android Studio ships one in its "jbr" folder)
if not defined JAVA_HOME (
    where java >nul 2>&1
    if errorlevel 1 (
        if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" (
            set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
        ) else (
            echo [ERROR] Java 21 was not found. Install Android Studio or JDK 21 and set JAVA_HOME.
            pause
            goto :eof
        )
    )
)

rem ---- Android SDK location
if not exist "android\local.properties" (
    if defined ANDROID_HOME (set "SDK=%ANDROID_HOME%") else (set "SDK=%LOCALAPPDATA%\Android\Sdk")
    if not exist "!SDK!" (
        echo [ERROR] Android SDK not found at "!SDK!".
        echo Install Android Studio ^(it installs the SDK^) or set ANDROID_HOME.
        pause
        goto :eof
    )
    set "SDKP=!SDK:\=/!"
    > "android\local.properties" echo sdk.dir=!SDKP!
)

echo [1/4] Installing npm packages...
call npm install --no-audit --no-fund
if errorlevel 1 ( echo [ERROR] npm install failed. & pause & goto :eof )

echo [2/4] Building web assets...
call npm run build:web
if errorlevel 1 ( echo [ERROR] Web build failed. & pause & goto :eof )

echo [3/4] Syncing Capacitor...
call node scripts\patch-android.js
call npx cap sync android
if errorlevel 1 ( echo [ERROR] cap sync failed. & pause & goto :eof )

echo [4/4] Building APK ^(the first build downloads Gradle and takes a few minutes^)...
pushd android
call gradlew.bat assembleDebug
set "RC=!errorlevel!"
popd
if not "!RC!"=="0" ( echo [ERROR] Gradle build failed. Scroll up for the reason. & pause & goto :eof )

set "APK=%~dp0android\app\build\outputs\apk\debug\app-debug.apk"
echo.
echo SUCCESS: !APK!
explorer /select,"!APK!"
pause
endlocal
goto :eof
