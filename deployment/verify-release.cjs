const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('H:/connextes/edu-plate/node_modules/playwright');
const prepared=JSON.parse(fs.readFileSync(path.join(__dirname,'prepared-release.json'),'utf8'));
const base=process.env.TIANLI_PUBLIC_BASE||'http://127.0.0.1:4185/tianli/';
const output=process.env.TIANLI_PUBLIC_BASE?'online-validation.json':'prepared-validation.json';
const report={base,release:prepared.release,versions:[],errors:[],startedAt:new Date().toISOString()};
(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try{
    const context=await browser.newContext({viewport:{width:390,height:844},locale:'zh-CN'}),page=await context.newPage();
    page.on('pageerror',error=>report.errors.push(error.message));
    page.on('response',response=>{if(response.status()>=400&&!response.url().endsWith('/favicon.ico'))report.errors.push(response.status()+' '+response.url());});
    let response=await page.goto(base);assert.equal(response.status(),200);assert.equal(await page.title(),'天俪 · 原型评审');
    for(const version of prepared.versions){
      const entry=new URL(version.version+'/',base).href;
      response=await page.goto(new URL('index.html',entry).href);assert.equal(response.status(),200);
      await page.waitForFunction(()=>window.SCREENS?.length>0);
      const catalog=await page.evaluate(()=>window.SCREENS.map(({id,file})=>({id,file})));assert.equal(catalog.length,version.screens);
      for(const screen of catalog){
        response=await page.goto(new URL('app.html?screen='+encodeURIComponent(screen.id),entry).href);assert.equal(response.status(),200);
        await page.waitForFunction(()=>document.body.dataset.ready==='1');assert.ok((await page.locator('#app').innerText()).trim());
      }
      const png=fs.readdirSync(path.join(prepared.site,version.version,'exports')).filter(file=>file.endsWith('.png'));
      const decoded=await page.evaluate(async({entry,png})=>{
        const results=[];
        for(let i=0;i<png.length;i+=12){
          results.push(...await Promise.all(png.slice(i,i+12).map(file=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve({file,decoded:image.naturalWidth>0});image.onerror=()=>resolve({file,decoded:false});image.src=entry+'exports/'+encodeURIComponent(file);}))))
        }
        return results;
      },{entry,png});assert.equal(decoded.filter(image=>image.decoded).length,version.png);
      response=await page.goto(new URL('demo.html',entry).href);assert.equal(response.status(),200);
      const frame=page.frameLocator('#phone');await frame.locator('#app').waitFor();
      for(const role of ['tech','store','user']){await page.locator(`[data-role="${role}"]`).click();await frame.locator('#app').waitFor();assert.ok((await frame.locator('#app').innerText()).trim());}
      await page.screenshot({path:path.join(path.dirname(prepared.archive),version.version+'-'+(process.env.TIANLI_PUBLIC_BASE?'online':'prepared')+'.png'),fullPage:true});
      report.versions.push({version:version.version,screensRendered:catalog.length,pngDecoded:decoded.length,rolesSwitched:3});
    }
    assert.equal(report.errors.length,0,JSON.stringify(report.errors));
    const manifest=JSON.parse(fs.readFileSync(path.join(prepared.site,'manifest.json'),'utf8'));
    for(const file of manifest.files){const response=await context.request.get(new URL(file.path,base).href);assert.equal(response.status(),200,file.path);assert.equal(crypto.createHash('sha256').update(await response.body()).digest('hex'),file.sha256,file.path);}
    report.filesHashVerified=manifest.files.length;report.success=true;
  }catch(error){report.success=false;report.failure=error.message;process.exitCode=1;}finally{await browser.close();report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(path.dirname(prepared.archive),output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})();
