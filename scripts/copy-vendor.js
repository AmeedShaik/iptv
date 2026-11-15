// Copies browser-ready third-party files from node_modules into www/assets/vendor
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'www', 'assets', 'vendor');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  ['node_modules/lucide/dist/umd/lucide.min.js', 'lucide.min.js'],
  ['node_modules/hls.js/dist/hls.min.js', 'hls.min.js'], // only used for the browser preview, never on Android
];

for (const [src, dest] of files) {
  const from = path.join(root, src);
  if (!fs.existsSync(from)) {
    console.error(`[copy-vendor] Missing ${src}. Run "npm install" first.`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(outDir, dest));
  console.log(`[copy-vendor] ${dest}`);
}
