// Opens the Playwright report (screenshots, video, step-by-step trace) of the NEWEST run.
//   npm run report                 → newest run of any suite
//   npm run report -- hub-e2e      → newest run of that suite (hub-e2e, checkout-e2e, customer-api, unified-api, all)
// Runs live in reports/<suite>/<start time>/html-report (see playwright.config.ts).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const suiteWanted = process.argv[2];
const runs = [];
if (fs.existsSync('reports')) {
  for (const suite of fs.readdirSync('reports')) {
    if (suiteWanted && suite !== suiteWanted) continue;
    const suiteDir = path.join('reports', suite);
    if (!fs.statSync(suiteDir).isDirectory()) continue;
    for (const run of fs.readdirSync(suiteDir)) {
      if (fs.existsSync(path.join(suiteDir, run, 'html-report', 'index.html'))) runs.push({ run, dir: path.join(suiteDir, run, 'html-report') });
    }
  }
}
if (runs.length === 0) {
  console.log(`No report found${suiteWanted ? ` for "${suiteWanted}"` : ''} under reports/. Run some tests first.`);
  process.exit(1);
}
runs.sort((a, b) => (a.run < b.run ? 1 : -1)); // folder names are start times → newest first
console.log(`Opening ${runs[0].dir}`);
spawnSync('npx', ['playwright', 'show-report', runs[0].dir], { stdio: 'inherit', shell: true });
