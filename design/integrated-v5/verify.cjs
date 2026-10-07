const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = __dirname;
const output = path.join(root, 'verification');
fs.mkdirSync(output, { recursive: true });
const sources = fs.readdirSync(root).filter(name => /\.(mjs|cjs)$/.test(name));
const syntax = sources.map(file => {
  const run = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  return { file, passed: run.status === 0, diagnostics: (run.stdout || '') + (run.stderr || '') };
});
const testFiles = sources.filter(file => file.endsWith('.test.mjs')).sort();
const tests = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...testFiles], { cwd: root, encoding: 'utf8' });
const text = (tests.stdout || '') + (tests.stderr || '');
fs.writeFileSync(path.join(output, 'test-output.txt'), text);
const count = field => Number(text.match(new RegExp('^# ' + field + ' (\\d+)$', 'm'))?.[1] || 0);
const browserReports = ['customer-browser.json', 'staff-browser.json', 'return-dispute-browser.json', 'integration-browser.json', 'restored-booking-browser.json', 'restored-staff-browser.json', 'management-browser.json', 'repair-browser.md', 'repair-media-browser.json', 'reaudit-repair/browser.md'];
browserReports.push('pilot-batch1/browser.md', 'pilot-batch1/goods-browser.md');
browserReports.push('pilot-batch2/browser.md', 'pilot-batch2/chrome-files.md');
browserReports.push('pilot-batch3/browser.md');
browserReports.push('pilot-batch4/browser.md', 'pilot-batch5/browser.md');
browserReports.push('pilot-batch6/browser.md', 'pilot-batch7/browser.md');
browserReports.push('pilot-batch8/browser.md');
browserReports.push('pilot-batch9/browser.md', 'pilot-batch9/files-browser.md', 'pilot-batch9/source-scope.md');
browserReports.push('pilot-batch10-files/browser.md', 'pilot-batch10-reports/browser.md', 'pilot-batch10-commerce-invoices/browser.md');
browserReports.push('pilot-batch10-escalation/browser.md', 'pilot-batch10-goods-remaining/browser.md', 'pilot-batch10-service-finance-extras/browser.md');
const report = {
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform },
  passed: syntax.every(x => x.passed) && tests.status === 0 && count('tests') > 0 && count('fail') === 0,
  syntax,
  rules: { command: 'node --test --test-reporter=tap ' + testFiles.join(' '), tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'), exitCode: tests.status },
  browserEvidence: browserReports.map(file => ({ file, exists: fs.existsSync(path.join(output, file)), note: 'Independent recorded UI run; this script does not rerun browser interactions.' })),
  hashes: Object.fromEntries([...sources, 'index.html', ...fs.readdirSync(root).filter(file => file.endsWith('.css')), 'package.json'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')])),
  boundaries: ['Local demo only', 'Browser evidence is separate from rule-test totals', 'No backend, payment provider, real identity, WeChat review or production acceptance']
};
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: report.passed, syntax: syntax.length, rules: report.rules, report: 'verification/report.json' }, null, 2));
process.exitCode = report.passed ? 0 : 1;
