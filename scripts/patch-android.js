// Idempotent patch for the generated Android manifest:
//  - allow cleartext (http://) streams, which many IPTV playlists use
//  - make the app installable on Android TV / Fire TV (no touchscreen required, leanback launcher)
const fs = require('fs');
const path = require('path');

const file = path.resolve(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
if (!fs.existsSync(file)) {
  console.error('[patch-android] android/ not found. Run "npx cap add android" first.');
  process.exit(1);
}
let xml = fs.readFileSync(file, 'utf8');
let changed = false;

if (!xml.includes('android.hardware.touchscreen')) {
  xml = xml.replace(
    '<application',
    '<uses-feature android:name="android.hardware.touchscreen" android:required="false" />\n' +
    '    <uses-feature android:name="android.software.leanback" android:required="false" />\n\n' +
    '    <application'
  );
  changed = true;
}
if (!xml.includes('usesCleartextTraffic')) {
  xml = xml.replace('<application', '<application\n        android:usesCleartextTraffic="true"');
  changed = true;
}
if (!xml.includes('LEANBACK_LAUNCHER')) {
  xml = xml.replace(
    '<category android:name="android.intent.category.LAUNCHER" />',
    '<category android:name="android.intent.category.LAUNCHER" />\n' +
    '                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />'
  );
  changed = true;
}

if (changed) fs.writeFileSync(file, xml);
console.log(changed ? '[patch-android] AndroidManifest.xml patched' : '[patch-android] already patched');
