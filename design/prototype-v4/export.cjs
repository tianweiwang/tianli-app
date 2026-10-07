/* v4 预约版：单页扁平导出，逐一检查总览图片解码及目录清单。 */
'use strict';
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require(path.join(process.argv[2]||'H:/connextes/edu-plate/node_modules','playwright'));
const ROOT=__dirname;
const OUTPUT=path.resolve(ROOT,'exports');
const BASE=process.env.TIANLI_V4_BASE_URL||'http://127.0.0.1:4184/';
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FORBIDDEN=/上门|到店|出发|到达|交通费|路程|门牌|轨迹/g;
const url=file=>new URL(file,BASE).href;
const safeName=name=>typeof name==='string'&&name===path.basename(name)&&!/[\\/<>:"|?*\x00-\x1f\x7f]/.test(name)&&!/[ .]$/.test(name);
function outputFile(name){
  if(!safeName(name))throw new Error('非法导出文件名：'+name);
  const target=path.resolve(OUTPUT,name);
  if(path.dirname(target).toLowerCase()!==OUTPUT.toLowerCase())throw new Error('导出目标不在 exports 根目录：'+target);
  return target;
}
function inventory(){
  const entries=fs.readdirSync(OUTPUT,{withFileTypes:true});
  return {directories:entries.filter(entry=>entry.isDirectory()).map(entry=>entry.name),pngFiles:entries.filter(entry=>entry.isFile()&&entry.name.toLowerCase().endsWith('.png')).map(entry=>entry.name)};
}
(async()=>{
  let browser;
  const result={startedAt:new Date().toISOString(),base:BASE,screens:0,groups:0,outputDirectory:OUTPUT,pageImageCount:0,overviewImageCount:0,actualPngCount:0,directories:[],errors:[],report:[],overviews:[]};
  try{
    browser=await chromium.launch({headless:true,executablePath:EDGE});
    const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,locale:'zh-CN'});
    page.on('pageerror',error=>result.errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')result.errors.push(message.text());});
    await page.goto(url('index.html'));
    await page.waitForFunction(()=>Array.isArray(window.SCREENS)&&window.SCREENS.length&&Array.isArray(window.SCREEN_GROUPS));
    const {screens,groups}=await page.evaluate(()=>({screens:window.SCREENS,groups:window.SCREEN_GROUPS}));
    if(!groups.length)throw new Error('页面分组未加载');
    const filenames=screens.map(screen=>screen.file);
    if(new Set(screens.map(screen=>screen.id)).size!==screens.length)throw new Error('页面 ID 重复');
    if(new Set(filenames.map(file=>file.toLowerCase())).size!==filenames.length)throw new Error('导出文件名重复');
    filenames.forEach(outputFile);
    const forbiddenMeta=screens.flatMap(screen=>{const matches=JSON.stringify(screen).match(FORBIDDEN);return matches?[screen.id+'：'+[...new Set(matches)].join('、')]:[];});
    if(forbiddenMeta.length)throw new Error('预约版目录存在旧业务文案：'+forbiddenMeta.join('；'));
    fs.mkdirSync(OUTPUT,{recursive:true});
    if(fs.lstatSync(OUTPUT).isSymbolicLink())throw new Error('exports 必须是项目内的实体目录');
    const before=inventory();
    if(before.directories.length)throw new Error('exports 存在不明子目录，请先核验：'+before.directories.join('、'));
    // 仅清理已核验目录第一层的 PNG，保留其他文件及不明目录。
    for(const file of before.pngFiles)fs.unlinkSync(outputFile(file));
    for(const screen of screens){
      await page.goto(url('app.html')+'?screen='+encodeURIComponent(screen.id));
      await page.waitForFunction(()=>document.body.dataset.ready==='1');
      await page.evaluate(()=>document.fonts.ready);
      const metrics=await page.evaluate(()=>{
        const content=document.querySelector('.content'),sheet=document.querySelector('.sheet-body');
        return {hiddenBelow:content?content.scrollHeight-content.clientHeight:0,sheetHidden:sheet?sheet.scrollHeight-sheet.clientHeight:0,xOverflow:document.documentElement.scrollWidth-innerWidth,visibleText:document.getElementById('app')?.innerText||''};
      });
      if(!metrics.visibleText.trim())throw new Error('空页面：'+screen.id);
      const forbidden=metrics.visibleText.match(FORBIDDEN);
      if(forbidden)throw new Error('预约版页面存在旧业务文案：'+screen.id+' '+[...new Set(forbidden)].join('、'));
      if(metrics.xOverflow>1)throw new Error('导出页面横向溢出：'+screen.id+' '+metrics.xOverflow+'px');
      delete metrics.visibleText;
      await page.screenshot({path:outputFile(screen.file)});
      result.report.push({no:screen.no,id:screen.id,file:screen.file,group:screen.group,...metrics});
    }
    result.screens=result.pageImageCount=result.report.length;
    const overview=await browser.newPage({viewport:{width:1720,height:900},deviceScaleFactor:1,locale:'zh-CN'});
    overview.on('pageerror',error=>result.errors.push(error.message));
    for(const [index,group]of groups.entries()){
      await overview.goto(url('index.html')+'?capture=1&group='+encodeURIComponent(group));
      await overview.evaluate(()=>document.fonts.ready);
      await overview.waitForFunction(()=>[...document.images].every(image=>image.complete));
      const images=await overview.evaluate(()=>[...document.images].map(image=>({file:decodeURIComponent(image.getAttribute('src')||''),naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight})));
      const expected=screens.filter(screen=>screen.group===group).length,missing=images.filter(image=>image.naturalWidth<=0||image.naturalHeight<=0);
      if(images.length!==expected||missing.length)throw new Error(`总览缺图：${group}，预期 ${expected}、实际 ${images.length}，未解码 ${missing.map(image=>image.file).join('、')}`);
      const file=await overview.evaluate(({index,group})=>window.SAFE_EXPORT_NAME(`00-总览-${String(index+1).padStart(2,'0')}-${group}.png`),{index,group});
      await overview.screenshot({path:outputFile(file),fullPage:true});
      result.overviews.push({group,file,imageCount:images.length,imagesDecoded:true});
    }
    result.groups=result.overviewImageCount=result.overviews.length;
    const after=inventory();result.directories=after.directories;result.actualPngCount=after.pngFiles.length;
    const expectedFiles=[...filenames,...result.overviews.map(group=>group.file)],missingFiles=expectedFiles.filter(file=>!after.pngFiles.includes(file));
    if(after.directories.length||after.pngFiles.length!==expectedFiles.length||missingFiles.length)throw new Error(`导出目录异常：PNG ${after.pngFiles.length}/${expectedFiles.length}，子目录 ${after.directories.length}，缺失 ${missingFiles.join('、')}`);
    if(result.errors.length)throw new Error('导出期间出现页面错误：'+result.errors.join('；'));
    result.success=true;
    console.log(`导出成功：${result.pageImageCount} 张单页、${result.overviewImageCount} 张总览；PNG ${result.actualPngCount}；子目录 0`);
  }catch(error){
    result.success=false;result.failure=error.message;process.exitCode=1;console.error(error.message);
    if(fs.existsSync(OUTPUT)){const current=inventory();result.directories=current.directories;result.actualPngCount=current.pngFiles.length;}
  }finally{
    if(browser)await browser.close();result.finishedAt=new Date().toISOString();
    fs.writeFileSync(path.join(ROOT,'export-report.json'),JSON.stringify(result,null,2));
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
