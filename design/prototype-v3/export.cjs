// Windows："C:\Program Files\nodejs\node.exe" export.cjs <playwright 所在 node_modules 目录>
// 单页扁平导出 390×844 @2x；总览逐图检查解码结果，缺图或目录异常会使导出失败。
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require(path.join(process.argv[2] || 'H:\\connextes\\edu-plate\\node_modules', 'playwright'));
const root = __dirname;
const out = path.resolve(root, 'exports');
const url = f => 'file:///' + path.join(root, f).replace(/\\/g, '/');
const safeName = name => typeof name === 'string' && name === path.basename(name) && !/[\\/<>:"|?*\x00-\x1f\x7f]/.test(name) && !/[ .]$/.test(name);
function outputFile(name) {
  if (!safeName(name)) throw new Error('非法导出文件名：' + name);
  const target = path.resolve(out, name);
  if (path.dirname(target).toLowerCase() !== out.toLowerCase()) throw new Error('导出目标不在 exports 根目录：' + target);
  return target;
}
function inventory() {
  const entries = fs.readdirSync(out, {withFileTypes: true});
  return {directories: entries.filter(e => e.isDirectory()).map(e => e.name), pngFiles: entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.png')).map(e => e.name)};
}
(async () => {
  let browser;
  const result = {screens: 0, groups: 0, outputDirectory: out, pageImageCount: 0, overviewImageCount: 0, actualPngCount: 0, directories: [], errors: [], report: [], overviews: []};
  try {
    browser = await chromium.launch({channel: 'msedge', headless: true});
    const page = await browser.newPage({viewport: {width: 390, height: 844}, deviceScaleFactor: 2});
    page.on('pageerror', e => result.errors.push(e.message));
    await page.goto(url('index.html'));
    const {screens, groups} = await page.evaluate(() => ({screens: window.SCREENS, groups: window.SCREEN_GROUPS}));
    if (!Array.isArray(screens) || !screens.length || !Array.isArray(groups) || !groups.length) throw new Error('页面目录或分组未加载');
    const filenames = screens.map(s => s.file);
    if (new Set(filenames.map(f => f.toLowerCase())).size !== filenames.length) throw new Error('导出文件名重复');
    filenames.forEach(outputFile);
    fs.mkdirSync(out, {recursive: true});
    if (fs.lstatSync(out).isSymbolicLink()) throw new Error('exports 必须是项目内的实体目录');
    const before = inventory();
    if (before.directories.length) throw new Error('exports 存在子目录，请先核验并清理历史导出目录：' + before.directories.join('、'));
    // 只清理 exports 第一层的已有 PNG；不删除其他文件或不明目录。
    for (const filename of before.pngFiles) fs.unlinkSync(outputFile(filename));
    for (const s of screens) {
      await page.goto(url('app.html') + '?screen=' + encodeURIComponent(s.id));
      await page.waitForFunction(() => document.body.dataset.ready === '1');
      await page.evaluate(() => document.fonts.ready);
      const metrics = await page.evaluate(() => {
        const content = document.querySelector('.content');
        const sheet = document.querySelector('.sheet-body');
        return {hiddenBelow: content ? content.scrollHeight - content.clientHeight : 0, sheetHidden: sheet ? sheet.scrollHeight - sheet.clientHeight : 0, xOverflow: document.documentElement.scrollWidth - innerWidth};
      });
      await page.screenshot({path: outputFile(s.file)});
      result.report.push({no: s.no, id: s.id, file: s.file, group: s.group, ...metrics});
    }
    result.screens = result.pageImageCount = result.report.length;
    // 图片 complete 在 404 时也为 true，必须确认 naturalWidth/naturalHeight 均大于零。
    const sheetPage = await browser.newPage({viewport: {width: 1720, height: 900}, deviceScaleFactor: 1});
    sheetPage.on('pageerror', e => result.errors.push(e.message));
    for (const [i, group] of groups.entries()) {
      await sheetPage.goto(url('index.html') + '?capture=1&group=' + encodeURIComponent(group));
      await sheetPage.evaluate(() => document.fonts.ready);
      await sheetPage.waitForFunction(() => [...document.images].every(img => img.complete));
      const images = await sheetPage.evaluate(() => [...document.images].map(img => ({file: decodeURIComponent(img.getAttribute('src')), naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight})));
      const expected = screens.filter(s => s.group === group).length;
      const missing = images.filter(img => img.naturalWidth <= 0 || img.naturalHeight <= 0);
      if (images.length !== expected || missing.length) throw new Error(`总览缺图：${group}；预期 ${expected} 张、实际 ${images.length} 张；未解码：${missing.map(img => img.file).join('、')}`);
      const name = await sheetPage.evaluate(({index, group}) => window.SAFE_EXPORT_NAME(`00-总览-${String(index + 1).padStart(2, '0')}-${group}.png`), {index: i, group});
      await sheetPage.screenshot({path: outputFile(name), fullPage: true});
      result.overviews.push({group, file: name, imageCount: images.length, imagesDecoded: true});
    }
    result.groups = result.overviewImageCount = result.overviews.length;
    const after = inventory();
    result.directories = after.directories;
    result.actualPngCount = after.pngFiles.length;
    const expectedTotal = screens.length + groups.length;
    const expectedFiles = [...filenames, ...result.overviews.map(g => g.file)];
    const missingFiles = expectedFiles.filter(name => !after.pngFiles.includes(name));
    if (after.directories.length || after.pngFiles.length !== expectedTotal || missingFiles.length) throw new Error(`导出目录检查失败：PNG ${after.pngFiles.length}/${expectedTotal}，子目录 ${after.directories.length}，缺失 ${missingFiles.join('、')}`);
    if (result.errors.length) throw new Error('导出期间出现页面错误：' + result.errors.join('；'));
    result.success = true;
    console.log(`导出成功：${result.pageImageCount} 张页面、${result.overviewImageCount} 张总览；PNG ${result.actualPngCount}；子目录 ${result.directories.length}`);
    for (const r of result.report.filter(r => r.hiddenBelow > 0 || r.sheetHidden > 0 || r.xOverflow > 0)) console.log(`${r.no} ${r.id}: below=${r.hiddenBelow} sheet=${r.sheetHidden} x=${r.xOverflow}`);
  } catch (error) {
    result.success = false;
    result.failure = error.message;
    if (fs.existsSync(out)) {
      const current = inventory();
      result.directories = current.directories;
      result.actualPngCount = current.pngFiles.length;
    }
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    fs.writeFileSync(path.join(root, 'export-report.json'), JSON.stringify(result, null, 1));
  }
})();
