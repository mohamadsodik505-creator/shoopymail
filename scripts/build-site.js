const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'public');
const publicPages = ['index.html', 'login.html', 'dashboard.html', 'admin.html'];

fs.mkdirSync(outputDirectory, { recursive: true });

for (const page of publicPages) {
  const source = path.join(root, page);
  if (!fs.existsSync(source)) {
    throw new Error(`Required page is missing: ${page}`);
  }
  fs.copyFileSync(source, path.join(outputDirectory, page));
}

const assetsDirectory = path.join(root, 'assets');
if (fs.existsSync(assetsDirectory)) {
  fs.cpSync(assetsDirectory, path.join(outputDirectory, 'assets'), { recursive: true });
}
