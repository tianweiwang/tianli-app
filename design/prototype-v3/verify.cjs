/* Browser acceptance for the v3 local prototype. Uses the existing Playwright runtime. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('H:/connextes/edu-plate/node_modules/playwright');
const BASE = process.env.TIANLI_BASE_URL || 'http://127.0.0.1:4183/';
const OUTPUT = process.env.TIANLI_VERIFY_OUTPUT || path.join(__dirname, 'verification');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const result = {startedAt:new Date().toISOString(),base:BASE,widths:[320,390,430],catalog:[],renderChecks:[],issues:[],interactionChecks:[],screenshots:[]};
const browserErrors = [];
const screenOf = page => new URL(page.url()).searchParams.get('screen');
const safe = text => text.replace(/[<>:"/\\|?*]/g, '-');
let browser, page;

async function shot(name) {
  const out = path.join(OUTPUT, '验收-' + safe(name) + '.png');
  await page.screenshot({path:out});
  result.screenshots.push(out);
}
async function state() { return page.evaluate(() => structuredClone(window.PrototypeRuntime.getState())); }
async function kvText(key) { return page.evaluate(key=>[...document.querySelectorAll('.kv')].find(row=>row.firstElementChild?.textContent.trim()===key)?.lastElementChild?.textContent.trim(),key); }
async function route(id) {
  const resolved=await page.evaluate(id=>window.PrototypeRuntime.resolve?.(id)||id,id);
  await page.evaluate(id => window.PrototypeRuntime.go(id),id);
  assert.ok(screenOf(page)===resolved || (id==='u-sos' && screenOf(page)==='t-sos'),'跨角色查看应进入已注册的目标页面：'+id);
  assert.notEqual(await page.locator('#app').innerText(),'', '跳转后必须渲染内容');
}
async function action(...names) {
  for (const name of names) {
    const node=page.locator(`[data-action="${name}"]`).filter({visible:true}).first();
    if(await node.count()) { await node.click(); return; }
  }
  throw new Error(`当前 ${screenOf(page)} 找不到可操作按钮：${names.join(' / ')}`);
}
async function fill(name,value) {
  const node = page.locator(`[name="${name}"]`);
  assert.ok(await node.count(),`当前 ${screenOf(page)} 缺少真实输入 ${name}`);
  await node.first().fill(value);
}
async function check(name,on = true) {
  const node = page.locator(`[name="${name}"]`);
  assert.ok(await node.count(),`当前 ${screenOf(page)} 缺少真实勾选 ${name}`);
  await node.first().setChecked(on);
}
async function fillFirst(names,value) {
  for (const name of names) if(await page.locator(`[name="${name}"]`).count()) return fill(name,value);
  throw new Error(`当前 ${screenOf(page)} 缺少输入 ${names.join(' / ')}`);
}
async function checkFirst(names,on = true) {
  for (const name of names) if(await page.locator(`[name="${name}"]`).count()) return check(name,on);
  throw new Error(`当前 ${screenOf(page)} 缺少勾选 ${names.join(' / ')}`);
}
async function checkpoint(label,expected) {
  const s = await state();
  for (const [k,v] of Object.entries(expected)) assert.deepEqual(s[k],v,`${label}：${k}`);
  result.interactionChecks.push({name:label,pass:true,screen:screenOf(page),expected});
}
async function runCase(name, fn) {
  try { await fn(); result.interactionChecks.push({name,pass:true}); console.log('PASS ' + name); }
  catch(error) { result.interactionChecks.push({name,pass:false,error:error.message,screen:screenOf(page)}); result.issues.push({type:'interaction',name,error:error.message,screen:screenOf(page)}); await shot('失败-'+name); console.log('FAIL ' + name + ': ' + error.message); }
}
async function reset() {
  await page.goto(new URL('app.html?screen=u-home&demo=1',BASE).href);
  await page.waitForFunction(() => window.PrototypeRuntime && document.body.dataset.ready==='1');
  await page.evaluate(() => window.PrototypeRuntime.scenario('reset'));
}
async function payOrder() {
  await reset();
  await page.evaluate(()=>window.PrototypeRuntime.patch({realname:true,health:true,adult:true,eligible:true,consent:true}));
  await route('u-confirm');await action('pay');
  const s=await state();assert.equal(s.stage,'waiting');assert.equal(s.paid,true);assert.ok(s.paidAt>0,'真实支付动作须记录首次支付时间');
  return s;
}
async function dispatchDeadline() {
  return page.evaluate(()=>window.PrototypeRuntime.getDispatchDeadline());
}
async function appointmentIn(minutes) {
  return page.evaluate(minutes=>{
    const start=Math.floor((window.PrototypeRuntime.now()+minutes*60000)/60000)*60000;
    const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(start));
    const part=type=>parts.find(p=>p.type===type).value;
    const isoDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
    return {start,isoDate,date:part('month')+'月'+part('day')+'日',slot:part('hour')+':'+part('minute')};
  },minutes);
}
async function openSosClosure() {
  await route('s-dispatch');await action('sos-ack');assert.equal(screenOf(page),'s-sos-handling');
  assert.equal(await page.locator('.sheet .check-row input').count(),1,'结案必须有真实的是否继续核实勾选');
}

async function scanCatalog() {
  await page.goto(new URL('app.html?screen=u-home',BASE).href);
  await page.waitForFunction(() => document.body.dataset.ready==='1' && window.PrototypeRuntime);
  result.catalog = await page.evaluate(() => window.SCREENS.map(s=>({id:s.id,role:s.role,title:s.title,state:s.state})));
  const idCounts = result.catalog.reduce((a,s) => (a[s.id]=(a[s.id]||0)+1,a),{});
  for (const [id,n] of Object.entries(idCounts)) if(n>1) result.issues.push({type:'duplicate-id',id,count:n});
  let count=0;
  for (const width of result.widths) {
    await page.setViewportSize({width,height:844});
    for (const meta of result.catalog) {
      const errorStart=browserErrors.length;
      // Use state-gallery mode to verify independent design samples.
      await page.goto(new URL('app.html?screen='+meta.id,BASE).href);
      await page.waitForFunction(() => document.body.dataset.ready==='1');
      const measured=await page.evaluate(() => {
        const app=document.getElementById('app'), appBox=app.getBoundingClientRect();
        const bounds=[], small=[], alignment=[];
        const activeEl = el => { const style=getComputedStyle(el), box=el.getBoundingClientRect();return style.display!=='none' && style.visibility!=='hidden' && box.width>0 && box.height>0; };
        const xoverflow=[document.documentElement,document.body,app,...app.querySelectorAll('.content,.sheet-body,.detail,.card,.group,.action-footer,.payment-footer')].filter(el => el.scrollWidth>el.clientWidth+1).map(el=>({tag:el.tagName,class:el.className,scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
        for(const el of app.querySelectorAll('button,input,textarea,select')) {
          if(!activeEl(el))continue;
          const r=el.getBoundingClientRect(), parent=el.parentElement;
          const p=parent.getBoundingClientRect(), ps=getComputedStyle(parent);
          const left=p.left+(parseFloat(ps.paddingLeft)||0)+(parseFloat(ps.borderLeftWidth)||0);
          const right=p.right-(parseFloat(ps.paddingRight)||0)-(parseFloat(ps.borderRightWidth)||0);
          // Navigation back buttons use an explicit 8px inset. Horizontal filter rails
          // intentionally scroll; each control must still fit within the rail width.
          const navBack=el.matches('.navigation .back');
          let scrollRail=null;
          for(let a=el.parentElement;a&&a!==app;a=a.parentElement)if(['auto','scroll'].includes(getComputedStyle(a).overflowX)&&a.scrollWidth>a.clientWidth+1){scrollRail=a;break;}
          const inRail=scrollRail&&r.width<=scrollRail.clientWidth+1;
          if(!inRail && (r.left<appBox.left-1 || r.right>appBox.right+1 || (!navBack&&(r.left<left-1 || r.right>right+1)))) bounds.push({tag:el.tagName,label:el.innerText||el.name||el.getAttribute('aria-label'),class:el.className,left:r.left,right:r.right,parentLeft:left,parentRight:right});
          if(el.matches('button.button.primary') && r.height<47.5)small.push({label:el.innerText,height:r.height,class:el.className});
          if(el.matches('button.button.primary')) { const c=getComputedStyle(el);if(c.alignItems!=='center'||c.justifyContent!=='center')alignment.push({label:el.innerText,align:c.alignItems,justify:c.justifyContent}); }
        }
        const badTargets=[...app.querySelectorAll('[data-go]')].map(el=>({target:el.dataset.go,label:el.innerText||el.getAttribute('aria-label')})).filter(x=>!S[x.target] && !S[window.PrototypeRuntime.resolve?.(x.target)]);
        const fallbacks=new Set(['back','close-sheet','select-option','authorize-transfer','explain']);
        const unbound=[...app.querySelectorAll('[data-action]')].filter(el=>!window.PrototypeRuntime.actions[el.dataset.action] && !fallbacks.has(el.dataset.action)).map(el=>({action:el.dataset.action,label:el.innerText||el.getAttribute('aria-label')}));
        const placeholders=[...app.querySelectorAll('[data-action="explain"]')].filter(el=>!el.disabled).map(el=>el.innerText||el.getAttribute('aria-label')).filter(Boolean);
        return {empty:!app.innerText.trim(),xoverflow,bounds,small,alignment,badTargets,unbound,placeholders};
      });
      const errors=browserErrors.slice(errorStart);
      const row={id:meta.id,width,...measured,errors};result.renderChecks.push(row);
      for(const key of ['xoverflow','bounds','small','alignment','badTargets','unbound','errors']) for(const detail of measured[key]||errors) result.issues.push({type:key,id:meta.id,width,detail});
      if(measured.empty)result.issues.push({type:'empty',id:meta.id,width});
      count++;if(count%30===0)console.log(`RENDER ${count}/${result.catalog.length*3}`);
    }
  }
  await page.setViewportSize({width:390,height:844});
}

async function interactions() {
  await runCase('预约支付到售后退款完整流程',async()=>{
    await reset();
    await action('choose-relax');
    await page.locator('[data-go="u-tech-picker"]').first().click();
    await page.locator('[name="technician"][value="lin"]').check();
    await action('select-technician');
    assert.equal(screenOf(page),'u-slot');
    await page.getByRole('button',{name:/14:00/}).first().click();
    await action('confirm-slot');
    assert.ok(['u-realname','u-realname-form'].includes(screenOf(page)),'未实名应进入真实实名表单');
    await fillFirst(['legalName','realName'],'张测试');
    await fillFirst(['identityNumber','identityNo'],'31010119900101123X');
    await checkFirst(['identityConsent','identity-consent']);
    await action('submit-realname','verify-identity');
    assert.equal(screenOf(page),'u-recipient');
    await fill('recipientName','王母');await fill('recipientPhone','13900008000');
    await check('recipientAdult');await check('recipientHealth');
    await action('save-recipient');
    assert.equal(screenOf(page),'u-health');
    await checkFirst(['adult','healthAdult']);await checkFirst(['eligible','healthEligible']);
    await action('health-confirm');
    await checkpoint('支付前成人健康告知已确认',{health:true,adult:true,eligible:true});
    assert.match(await page.locator('#app').innerText(),/王母/,'确认订单必须展示刚填写的服务对象');
    assert.match(await page.locator('#app').innerText(),/139\*{4}8000/,'确认订单应使用服务对象手机号而非地址联系人');
    await action('pay');
    await checkpoint('真实提交支付演示',{paid:true,stage:'waiting',finance:'paid'});
    assert.equal((await state()).recipient.name,'王母');assert.equal((await state()).recipient.phone,'13900008000');
    await shot('01-支付成功');
    await route('t-work');await action('accept-order');
    await checkpoint('技师接单',{stage:'accepted'});
    assert.match(await page.locator('#app').innerText(),/王母/,'技师端须查看同一服务对象');
    await action('depart');assert.equal(screenOf(page),'t-location');
    await action('enable-location');await action('depart');
    await checkpoint('授权位置后出发',{stage:'departed',location:true});
    await action('arrive');await checkpoint('到达打卡',{stage:'arrived'});
    await action('start-service');await checkpoint('开始服务',{stage:'serving'});
    await action('request-extend');await checkpoint('加钟锁定待用户支付',{extendPending:true,extension:0});
    await route('u-o-extend');await action('pay-extend');
    await checkpoint('加钟支付后延长',{extendPending:false,extension:1,extendedMinutes:30});
    await route('t-finish');
    const normal=page.getByRole('button',{name:/正常完成/});assert.equal(await normal.isDisabled(),true,'未满时长正常完成必须禁用');
    await action('finish-service');await checkpoint('用户要求提前结束',{stage:'completed'});
    await route('u-o-done');await shot('02-服务完成');
    await action('apply-aftersale').catch(async error=>{const el=page.locator('[data-go="u-aftersale-apply"]');if(!await el.count())throw error;await el.first().click();});
    await fillFirst(['refundAmount','aftersaleRefundAmount'],'98');
    await fillFirst(['aftersaleDescription','problemDescription','aftersaleNote','description'],'服务时长不足，希望退款98元。');
    await action('submit-aftersale');await checkpoint('提交售后暂停分账',{aftersale:'pending',finance:'blocked'});
    await route('s-aftersale');await fillFirst(['refundOffer','refundPlanAmount'],'49.67');
    await fillFirst(['refundPlanReason','refundExplanation','refundReason','refundOfferReason'],'按未服务时长退还49.67元，请用户确认。');
    await action('submit-refund-plan');await checkpoint('门店低于诉求方案等待确认',{aftersale:'confirm',offeredRefund:49.67});
    await route('u-aftersale-confirm');await action('accept-refund-plan');
    await checkpoint('用户确认后执行退款',{finance:'refund-processing',refundAmount:49.67});
    await action('refund-refresh');await checkpoint('原路退款完成',{finance:'refunded',refundAmount:49.67});await shot('03-退款完成');
  });

  await runCase('指定技师改派拒绝全额退款',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('specified'));
    assert.ok(['s-reassign-designated','s-reassign'].includes(screenOf(page)));
    await fill('reassignReason','原指定技师临时请假，申请同店更换。');
    await action('store-reassign-designated');await checkpoint('指定技师待用户确认',{stage:'reassign'});
    await route('u-o-reassign');await action('reject-reassign');
    await checkpoint('拒绝改派全额原路退款',{finance:'refund-processing',refundAmount:298});await shot('04-拒绝改派退款');
  });
  await runCase('门店改约拒绝保持原约',async()=>{
    await reset();await page.evaluate(()=>{window.PrototypeRuntime.patch({paid:true,realname:true,stage:'accepted',finance:'paid'});window.PrototypeRuntime.go('s-reschedule-apply');});
    const before=await state();await fill('storeRescheduleReason','临时停业，建议改为次日服务。');
    await action('store-reschedule-submit');await checkpoint('门店改约待用户确认',{stage:'reschedule'});
    await route('u-o-store-reschedule');await action('reject-store-reschedule');
    const after=await state();assert.equal(after.stage,'accepted');assert.equal(after.slot,before.slot);assert.equal(after.date,before.date);assert.equal(after.changes,before.changes);await shot('05-拒绝门店改约保留原约');
  });
  await runCase('求助3加3分钟无人响应',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('u-sos');await action('sos-send');
    await checkpoint('求助发出',{sos:'sent'});
    await page.evaluate(()=>window.PrototypeRuntime.advance(3));await checkpoint('3分钟无人确认升级',{sos:'escalated'});
    await page.evaluate(()=>window.PrototypeRuntime.advance(3));await checkpoint('6分钟无人确认明确提示',{sos:'unanswered'});
    assert.ok(await page.getByRole('button',{name:/直接拨打 110/}).isVisible());await shot('06-求助无人响应');
  });
  await runCase('提现失败余额恢复且重复查询幂等',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({realname:true,transferAuthorized:true,withdrawOutcome:'failed'}));await route('u-withdraw');
    const before=(await state()).balance;
    const amount=page.locator('[name="withdrawAmount"]');if(await amount.count())await amount.fill('186.40');
    await action('withdraw-submit');const locked=await state();assert.equal(locked.balance,0);assert.ok(locked.withdrawalAmount>0);
    await action('withdraw-query');const failed=await state();assert.equal(failed.withdrawal,'failed');assert.equal(failed.balance,before);
    await page.evaluate(()=>window.PrototypeRuntime.dispatchAction('withdraw-query'));const again=await state();assert.equal(again.balance,before);assert.equal(again.withdrawal,'failed');await shot('07-提现失败幂等恢复');
  });
  await runCase('账号注销被可提现余额阻止',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({stage:'completed',finance:'settled',balance:186.40}));await route('u-delete-account');await check('deleteConsent');await action('delete-account');
    assert.notEqual((await state()).account,'deleted');assert.notEqual(screenOf(page),'u-deleted');assert.match(await page.locator('#app').innerText(),/余额|资金|提现/);await shot('08-注销余额拦截');
  });
  await runCase('未满时长正常完成禁用',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('t-finish');
    assert.equal(await page.getByRole('button',{name:/正常完成/}).isDisabled(),true);await shot('09-未满时长禁止正常完成');
  });
  await runCase('完成后2小时求助过期提交拦截',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'completed',finance:'pending-settlement',finishedAt:Date.now()-121*60000}));
    await route('u-o-done');
    assert.equal(await page.locator('.action-footer [data-go="u-sos"]').count(),0,'完成超过2小时不能保留平台求助入口');
    await route('u-sos');await action('sos-send');
    const s=await state();assert.equal(s.sos,'');assert.equal(s.finance,'pending-settlement');
    assert.match(await page.locator('#app').innerText(),/求助时段已结束|期限已结束/);await shot('10-求助超期拦截');
  });
  await runCase('完成后48小时自助售后过期提交拦截',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'completed',finance:'pending-settlement',finishedAt:Date.now()-49*3600000}));
    await route('u-order-current');assert.equal(screenOf(page),'u-o-settled');
    assert.equal(await page.locator('.action-footer [data-action="apply-aftersale"],.action-footer [data-go="u-aftersale-apply"]').count(),0,'售后期结束不能保留自助入口');
    await route('u-aftersale-apply');await fillFirst(['refundAmount','aftersaleRefundAmount'],'98');
    await fillFirst(['aftersaleDescription','problemDescription','aftersaleNote','description'],'超期页面仍填写完整材料，用于检查提交端再次拦截。');
    await action('submit-aftersale');const s=await state();assert.equal(s.aftersale,'');assert.equal(s.finance,'pending-settlement');
    assert.match(await page.locator('#app').innerText(),/售后期限已结束|售后期.*结束/);await shot('11-售后超期拦截');
  });
  await runCase('完成后7天评价过期提交拦截',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'completed',finance:'settled',finishedAt:Date.now()-8*86400000}));
    await route('u-order-current');assert.equal(screenOf(page),'u-o-settled');
    assert.equal(await page.locator('.action-footer [data-go="u-review"]').count(),0,'完成超过7天不能保留评价入口');
    await route('u-review');await action('review-submit');assert.ok(!(await state()).reviewSubmitted,'过期提交不能写入评价状态');
    assert.match(await page.locator('#app').innerText(),/评价期限已结束/);await shot('12-评价超期拦截');
  });
  await runCase('完成后90天发票过期提交拦截',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'completed',finance:'settled',finishedAt:Date.now()-91*86400000}));
    await route('u-order-current');assert.equal(screenOf(page),'u-o-history');
    assert.equal(await page.locator('.action-footer [data-go="u-invoice-form"]').count(),0,'完成超过90天不能保留新开票入口');
    await route('u-invoice-form');await action('invoice-submit');assert.equal((await state()).invoice,'');
    assert.match(await page.locator('#app').innerText(),/发票申请期限已结束/);await shot('13-开票超期拦截');
  });
  await runCase('已开票订单入口和重复提交保护',async()=>{
    await reset();
    await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'completed',finance:'settled',finishedAt:Date.now(),invoice:'issued',invoiceDetails:{type:'company',title:'已开票原始抬头',tax:'91310000MA1XXXXXXX',email:'invoice@example.com'}}));
    await route('u-o-done');const entry=page.getByRole('button',{name:'开发票',exact:true}).first();
    assert.equal(await entry.getAttribute('data-go'),'u-invoice-issued','已开票入口必须直接查看当前发票');await entry.click();assert.equal(screenOf(page),'u-invoice-issued');
    await route('u-invoice-form');await fill('invoiceTitle','重复申请测试抬头');await action('invoice-submit');
    const s=await state();assert.equal(s.invoice,'issued');assert.equal(s.invoiceDetails.title,'已开票原始抬头');assert.equal(screenOf(page),'u-invoice-issued');
    assert.equal(s.events.filter(e=>e.event==='提交发票申请').length,0,'重复提交不能创建新申请');await shot('14-已开票重复申请保护');
  });
  await runCase('198元订单退款98元摘要动态金额',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({service:'neck',duration:45,price:198,paid:true,realname:true,stage:'completed',finance:'pending-settlement',finishedAt:Date.now()}));
    await route('u-aftersale-apply');await fillFirst(['refundAmount','aftersaleRefundAmount'],'98');
    await fillFirst(['aftersaleDescription','problemDescription','aftersaleNote','description'],'肩颈项目服务不足，申请退款98元。');await action('submit-aftersale');
    await route('s-aftersale');await action('close-sheet');await action('approve-requested-refund');
    const processing=await state();assert.equal(processing.price,198);assert.equal(processing.refundAmount,98);assert.equal(processing.finance,'refund-processing');
    assert.match(await page.locator('.status-hero').innerText(),/98(?:\.00)?/,'退款处理中摘要须显示本次真实退款98元');
    await action('refund-refresh');const received=await state();assert.equal(received.finance,'refunded');assert.equal(received.refundAmount,98);
    const text=await page.locator('#app').innerText();assert.match(text,/¥198(?:\.00)?/);assert.match(text,/¥98(?:\.00)?/);assert.match(text,/¥100(?:\.00)?/);assert.doesNotMatch(text,/¥(?:248\.33|298\.00|49\.67)/,'摘要和明细不能残留298元示例金额');await shot('15-198元退款98');
  });
  await runCase('100元提现摘要和余额动态金额',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({balance:100,realname:true,transferAuthorized:true,withdrawOutcome:'failed'}));await route('u-withdraw');
    assert.match(await page.locator('.money').innerText(),/100(?:\.00)?/);await action('withdraw-submit');
    assert.equal((await state()).withdrawalAmount,100);assert.equal((await state()).balance,0);
    let text=await page.locator('#app').innerText();assert.match(text,/¥100\.00/);assert.doesNotMatch(text,/186\.40/,'处理中不能残留示例提现金额');
    await action('withdraw-query');const s=await state();assert.equal(s.withdrawal,'failed');assert.equal(s.balance,100);
    text=await page.locator('#app').innerText();assert.match(text,/¥100\.00/);assert.doesNotMatch(text,/186\.40/,'失败说明必须展示本次100元恢复金额');await shot('16-100元提现动态金额');
  });
  await runCase('技师求助冻结资金并返回技师订单',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('t-sos');await action('sos-send');
    const sent=await state();assert.equal(sent.sos,'sent');assert.equal(sent.finance,'blocked','未结案求助必须暂停分账');
    await page.getByRole('button',{name:'查看订单',exact:true}).click();
    assert.match(screenOf(page),/^t-/,'技师求助后应返回技师当前订单');
    assert.equal((await state()).sos,'sent');assert.equal((await state()).finance,'blocked');await shot('17-技师求助返回本端');
  });
  await runCase('服务对象浏览健康告知返回保留输入',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({realname:true}));await route('u-recipient');
    await fill('recipientName','王母');await fill('recipientPhone','13900008000');await check('recipientAdult');await check('recipientHealth');
    await page.locator('[data-go="u-health"]').first().click();assert.equal(screenOf(page),'u-health');
    await action('close-sheet');await action('back');assert.equal(screenOf(page),'u-recipient');
    assert.equal(await page.locator('[name="recipientName"]').inputValue(),'王母');assert.equal(await page.locator('[name="recipientPhone"]').inputValue(),'13900008000');
    assert.ok(await page.locator('[name="recipientAdult"]').isChecked());assert.ok(await page.locator('[name="recipientHealth"]').isChecked());
    await action('save-recipient');assert.equal((await state()).recipient.name,'王母');await shot('18-健康告知返回保留服务对象');
  });
  await runCase('改约未确认保留原14点确认后才变16点',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,realname:true,stage:'accepted',finance:'paid',slot:'14:00',date:'10月2日'}));await route('u-o-accepted');
    await action('reschedule');assert.equal(screenOf(page),'u-reschedule');await page.getByRole('button',{name:/^16:00/}).click();
    assert.equal((await state()).slot,'14:00','仅选择拟改时段不能改变正式预约');assert.equal((await state()).proposedSlot,'16:00');
    await action('back');assert.equal((await state()).slot,'14:00');assert.match(await kvText('预约时间'),/14:00/);
    await action('reschedule');await page.getByRole('button',{name:/^16:00/}).click();await action('confirm-reschedule');
    const s=await state();assert.equal(s.slot,'16:00');assert.equal(s.stage,'waiting');assert.equal(s.changes,0);assert.match(await kvText('预约时间'),/16:00/);await shot('19-改约确认后生效');
  });
  await runCase('主单和加钟分别退款147元净开票300元',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,realname:true,health:true,stage:'completed',finance:'pending-settlement',price:298,duration:60,extension:1,extensionPayments:[149],extendedMinutes:30,finishedAt:Date.now()}));
    await route('u-aftersale-apply');await check('refundMain');await fill('refundAmount','98');await check('refundExtension1');await fill('extensionRefund1','49');
    await fill('aftersaleDescription','主订单申请98元，加钟子订单申请49元，分别核实退款。');await action('submit-aftersale');
    let s=await state();assert.equal(s.requestedRefund,147);assert.deepEqual(s.requestedRefundBreakdown,{main:98,extensions:[49]});
    await route('s-aftersale');await action('close-sheet');
    assert.match(await page.locator('[data-action="approve-requested-refund"]').innerText(),/147(?:\.00)?/,'同意退款按钮须展示合计诉求147元');
    assert.match(await kvText('用户诉求'),/147(?:\.00)?/,'门店不能仍展示示例98元诉求');
    await action('approve-requested-refund');s=await state();assert.equal(s.refundAmount,147);assert.deepEqual(s.refundBreakdown,[98,49]);
    assert.match(await kvText('主订单'),/98\.00/);assert.match(await kvText('加钟子订单 1'),/49\.00/);
    await action('refund-refresh');assert.equal((await state()).finance,'refunded');
    await route('u-invoice-form');assert.match(await kvText('开票金额'),/300\.00/,'447元实付减147元退款后净开票300元');
    await action('invoice-submit');assert.equal((await state()).invoice,'pending');assert.match(await kvText('开票金额'),/300\.00/);await shot('20-主单加钟分别退款净开票');
  });
  await runCase('支付倒计时到期自动关闭无需推进',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({realname:true,health:true,adult:true,eligible:true,paid:false,stage:'draft',finance:'unpaid',deadlines:{payment:Date.now()+1500}}));await route('u-confirm');
    assert.ok(await page.locator('[data-countdown="payment"]').count(),'页面须展示来自真实deadline的倒计时');
    await page.waitForFunction(()=>window.PrototypeRuntime.getState().stage==='closed',null,{timeout:6000});
    assert.ok(['u-payment-expired','u-o-closed'].includes(screenOf(page)));assert.equal((await state()).paid,false);
    assert.ok(!(await state()).events.some(e=>/推进演示时间/.test(e.event)),'倒计时应自然到期，不能靠手动advance');
    if(screenOf(page)==='u-payment-expired')await action('retry-payment-query');
    assert.equal(screenOf(page),'u-o-closed');assert.equal((await state()).finance,'unpaid');await shot('21-倒计时自然到期关闭');
  });
  await runCase('2星评价和文字提交后保存',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'completed',finance:'pending-settlement',finishedAt:Date.now()}));await route('u-review');
    await page.getByRole('button',{name:'2星',exact:true}).click();await fill('reviewText','准时结束，沟通仍需改进。');await action('review-submit');
    let s=await state();assert.equal(s.reviewSubmitted,true);assert.equal(s.reviewRating,2);assert.equal(s.reviewText,'准时结束，沟通仍需改进。');assert.equal(screenOf(page),'u-review-result');
    await page.reload();await page.waitForFunction(()=>window.PrototypeRuntime&&document.body.dataset.ready==='1');s=await state();assert.equal(s.reviewRating,2);assert.equal(s.reviewText,'准时结束，沟通仍需改进。');await shot('22-2星文字评价已保存');
  });
  await runCase('198元项目加钟132和出发后取消金额',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({service:'neck',price:198,duration:45,stage:'serving',paid:true,realname:true,health:true,finance:'paid'}));await route('u-o-serving');await action('request-extend');
    assert.equal(screenOf(page),'u-o-extend');assert.match(await page.locator('[data-action="pay-extend"]').innerText(),/132/,'肩颈加钟付款按钮应显示132元且保持正确动作');
    await action('pay-extend');let s=await state();assert.equal(s.extension,1);assert.deepEqual(s.extensionPayments,[132]);assert.equal(s.extendedMinutes,30);await shot('23-198元项目加钟132');
    // Cancellation is a separate order fixture: it occurs before service and has no paid extension.
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({service:'neck',price:198,duration:45,stage:'departed',paid:true,realname:true,health:true,finance:'paid'}));await route('u-o-departed');
    const summary=await page.locator('.overlay .sheet').innerText();assert.match(summary,/39\.60/,'198元出发后取消扣费39.60元');assert.match(summary,/158\.40/,'198元出发后取消退款158.40元');
    await action('cancel-charged');s=await state();assert.equal(s.refundAmount,158.4);assert.equal(s.finance,'refund-processing');assert.equal(Math.round((s.price-s.refundAmount)*100)/100,39.6);
    await action('refund-refresh');assert.equal((await state()).finance,'refunded');assert.match(await page.locator('#app').innerText(),/158\.40/);await shot('24-198元取消扣费退款');
    await reset();await action('choose-neck');await route('u-slot');
    for(const slot of ['21:00','22:00'])assert.match(await page.getByRole('button',{name:new RegExp('^'+slot)}).innerText(),/¥228/,'肩颈夜间时段必须展示文档确定的228元');
    await page.getByRole('button',{name:/^21:00/}).click();assert.equal((await state()).price,228,'选择夜间肩颈项目按228元计算');
    await page.getByRole('button',{name:/^14:00/}).click();assert.equal((await state()).price,198,'切回日间肩颈时段恢复198元');
  });
  await runCase('旧实名和发票入口使用真实表单正确提交',async()=>{
    await reset();await route('u-realname');
    for(const name of ['legalName','identityNumber','legalPhone','identityConsent'])assert.equal(await page.locator(`[name="${name}"]`).count(),1,'旧实名入口缺少真实字段 '+name);
    assert.equal(await page.locator('[data-action="submit-realname"]').count(),1);await fill('legalName','张测试');await fill('identityNumber','31010119900101123X');await check('identityConsent');await action('submit-realname');
    assert.equal((await state()).realname,true);assert.equal(screenOf(page),'u-recipient');
    await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'completed',finance:'pending-settlement',finishedAt:Date.now()}));await route('u-invoice');
    for(const name of ['invoiceType','invoiceTitle','invoiceTax','invoiceEmail'])assert.equal(await page.locator(`[name="${name}"]`).count(),1,'旧发票入口缺少真实字段 '+name);
    assert.equal(await page.locator('[data-action="invoice-submit"]').count(),1);assert.equal(await page.locator('[data-action="submit-aftersale"]').count(),0,'开票不能绑定售后提交');
    await fill('invoiceTitle','旧入口发票测试');await fill('invoiceEmail','invoice-test@example.com');await action('invoice-submit');
    const s=await state();assert.equal(s.invoice,'pending');assert.equal(s.invoiceDetails.title,'旧入口发票测试');assert.equal(s.aftersale,'');assert.equal(screenOf(page),'u-invoice-pending');await shot('25-旧发票入口正确提交');
  });
  await runCase('每日提现3次后阻止余额锁定',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({realname:true,transferAuthorized:true,balance:100,withdrawalDay:new Date().toLocaleDateString('en-CA'),withdrawalCount:3}));await route('u-withdraw');
    await action('withdraw-submit');const s=await state();assert.equal(s.balance,100,'超出次数不能锁定余额');assert.equal(s.withdrawalAmount,0);assert.equal(s.withdrawal,'');assert.equal(s.withdrawalCount,3);assert.equal(screenOf(page),'u-withdraw');
    assert.match(await page.locator('#app').innerText(),/今天已提现3次.*明天/);await shot('26-每日提现上限拦截');
  });
  await runCase('198元爽约确认与结果使用本单扣费退款',async()=>{
    await reset();
    await page.evaluate(()=>window.PrototypeRuntime.patch({service:'neck',price:198,duration:45,paid:true,realname:true,health:true,stage:'arrived',finance:'paid',noshowEligible:true,deadlines:{}}));
    await route('t-noshow-confirm');
    let text=await page.locator('#app').innerText();
    assert.match(text,/扣费\s*¥39\.60/,'技师确认说明须按本单198元计算20%扣费');
    assert.match(text,/退款\s*¥158\.40/,'技师确认说明须按本单198元计算80%退款');
    assert.doesNotMatch(text,/¥(?:59\.60|238\.40)/,'技师确认说明不能残留298元示例金额');
    await check('noshowChecked');await fill('noshowReason','到达已等待16分钟，多次联系仍未接听。');await action('staff-noshow-submit');
    assert.equal((await state()).noshow,'pending');assert.equal((await state()).finance,'paid','核实前不能提前执行扣费退款');
    await route('s-noshow-review');await fill('noshowStoreReason','已核实定位打卡和等待时长，多次联系用户未接通。');await check('noshowVerified');await action('store-noshow-approve');
    const s=await state();assert.equal(s.stage,'cancelled');assert.equal(s.finance,'refund-processing');assert.equal(s.refundAmount,158.4);
    assert.equal(screenOf(page),'s-noshow-result');
    assert.equal(await kvText('扣费'),'¥39.60');assert.match(await kvText('退款'),/¥158\.40/);
    text=await page.locator('#app').innerText();assert.doesNotMatch(text,/¥(?:59\.60|238\.40)/,'店长结果不能残留298元示例金额');
    await shot('27-198元爽约店长结果');
    await route('t-noshow-result');assert.equal(await kvText('用户扣费'),'¥39.60');assert.equal(await kvText('原路退款'),'¥158.40');
    assert.match(await kvText('技师补偿'),/¥19\.80/,'技师补偿为本单扣费的50%');
    await shot('28-198元爽约技师结果');
  });
  await runCase('求助已升级静态画面与运行状态都显示客服介入',async()=>{
    await page.goto(new URL('app.html?screen=u-sos-escalated',BASE).href);
    await page.waitForFunction(()=>window.PrototypeRuntime&&document.body.dataset.ready==='1');
    const card=page.locator('.card').filter({has:page.locator('.card-title', {hasText:'关联订单'})}).first();
    assert.match(await card.locator('.card-title .badge').innerText(),/客服介入/,'导出所用静态画面必须显示求助升级后的客服介入');
    assert.doesNotMatch(await card.locator('.card-title .badge').innerText(),/服务中/);
    await shot('29-静态求助升级客服介入');
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('u-sos');await action('sos-send');await page.evaluate(()=>window.PrototypeRuntime.advance(3));
    const s=await state();assert.equal(s.stage,'service');assert.equal(s.sos,'escalated');assert.equal(s.finance,'blocked');
    assert.equal(screenOf(page),'u-sos-escalated');
    assert.match(await page.locator('.card-title .badge').first().innerText(),/客服介入/,'运行画面须与状态及静态导出一致');
  });
  await runCase('门店派单直接已接单且本轮期限固定',async()=>{
    const paid=await payOrder(),deadline=await dispatchDeadline();
    assert.equal(deadline,paid.dispatchRoundExpiresAt);assert.ok(deadline<=paid.paidAt+30*60000,'首次派单上限不得晚于首次支付后30分钟');
    await page.evaluate(()=>window.PrototypeRuntime.advance(10));
    assert.equal((await state()).stage,'dispatching','技师10分钟未确认必须进入门店派单池');assert.equal(await dispatchDeadline(),deadline);
    await route('s-pick');await action('dispatch-order');
    let s=await state();assert.equal(s.stage,'accepted','门店成功派单直接已接单，不能再多加一次技师确认');assert.equal(s.tech,'陈师傅');
    assert.equal(s.paidAt,paid.paidAt);assert.equal(s.dispatchRoundStartedAt,paid.dispatchRoundStartedAt);assert.equal(await dispatchDeadline(),deadline);
    assert.ok(!s.deadlines.accept,'门店已派单后不应遗留新技师确认倒计时');
    await route('t-work');assert.equal(await page.locator('[data-action="accept-order"]').count(),0,'门店已派单的技师工作台无需二次确认');
    // 复现旧代码的四轮重复派单动作：已成功派出时不可退回待接单或延长同一轮期限。
    for(let round=0;round<4;round++){
      await route('s-pick');await action('dispatch-order');await page.evaluate(()=>window.PrototypeRuntime.advance(10));
      s=await state();assert.equal(s.stage,'accepted','重复派单不能把已接单变成待确认');assert.equal(s.finance,'paid','已成功派出订单不因未派单期限自动退款');
      assert.equal(s.paidAt,paid.paidAt);assert.equal(await dispatchDeadline(),deadline,'连续派单不能重置本轮期限');
    }
    await route('u-order-current');assert.equal(screenOf(page),'u-o-accepted');await shot('30-门店派单直接已接单');
  });
  await runCase('候选拒单与确认超时重试不延长首次30分钟退款上限',async()=>{
    const paid=await payOrder(),deadline=await dispatchDeadline();
    await route('t-work');await action('reject-order');assert.equal((await state()).stage,'dispatching');assert.equal(await dispatchDeadline(),deadline);
    await page.evaluate(()=>window.PrototypeRuntime.advance(10));
    // 同一轮候选重试的等待快照：只更换候选确认状态，不重新支付或创建派单轮次。
    await page.evaluate(()=>{const R=window.PrototypeRuntime,s=R.getState();R.patch({stage:'waiting',tech:'陈师傅',deadlines:{...s.deadlines,accept:R.now()+10*60000}});});
    await route('t-work');await action('reject-order');assert.equal((await state()).stage,'dispatching');assert.equal(await dispatchDeadline(),deadline);
    await page.evaluate(()=>window.PrototypeRuntime.advance(10));
    await page.evaluate(()=>{const R=window.PrototypeRuntime,s=R.getState();R.patch({stage:'waiting',tech:'周师傅',deadlines:{...s.deadlines,accept:R.now()+10*60000}});});
    assert.equal((await state()).paidAt,paid.paidAt);assert.equal(await dispatchDeadline(),deadline);
    await page.evaluate(()=>window.PrototypeRuntime.advance(10));
    const s=await state();assert.equal(s.finance,'refund-processing','累计30分钟仍未成功派出必须自动退款');assert.equal(s.refundAmount,298);
    assert.notEqual(s.stage,'waiting');assert.notEqual(s.stage,'dispatching');assert.equal(s.paidAt,paid.paidAt);assert.equal(await dispatchDeadline(),deadline,'退款不能伪造新的派单截止时间');
    assert.match(s.refundReason,/派单超时/);await shot('31-候选重试30分钟自动退款');
  });
  await runCase('就近改派直接已接单且不重置本轮截止',async()=>{
    const paid=await payOrder(),deadline=await dispatchDeadline();
    await page.evaluate(()=>window.PrototypeRuntime.advance(10));await route('s-reassign-nearby');
    await fill('reassignReason','本轮原候选未接单，门店确认同店陈师傅可履约。');await action('store-reassign-nearby');
    const s=await state();assert.equal(s.stage,'accepted');assert.equal(s.tech,'陈师傅');assert.equal(s.paidAt,paid.paidAt);assert.equal(await dispatchDeadline(),deadline);
    assert.ok(!s.deadlines.accept,'就近门店改派不需要新技师再确认');await shot('32-就近门店改派直接已接单');
  });
  await runCase('指定技师改派同意后直接已接单且待确认不越派单上限',async()=>{
    const paid=await payOrder(),deadline=await dispatchDeadline();
    await page.evaluate(()=>window.PrototypeRuntime.patch({assignment:'specified',stage:'dispatching'}));await route('s-reassign-designated');
    await fill('reassignReason','原指定技师无法服务，同门店陈师傅具备履约条件。');await action('store-reassign-designated');
    let s=await state();assert.equal(s.stage,'reassign');assert.equal(await dispatchDeadline(),deadline);assert.ok(s.deadlines.reassign<=deadline,'指定改派用户确认期限不能越本轮派单上限');
    await route('u-o-reassign');await action('accept-reassign');s=await state();assert.equal(s.stage,'accepted');assert.equal(s.paidAt,paid.paidAt);assert.equal(await dispatchDeadline(),deadline);assert.ok(!s.deadlines.accept);
    await shot('33-指定改派用户同意直接已接单');
    await payOrder();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.advance(25);R.patch({assignment:'specified',stage:'dispatching'});});await route('s-reassign-designated');
    await fill('reassignReason','首次支付已过25分钟，请用户确认该同店技师。');await action('store-reassign-designated');
    s=await state();assert.ok(s.deadlines.reassign<=s.dispatchRoundExpiresAt,'剩5分钟时不能另外给15分钟延长本轮');
    await page.evaluate(()=>window.PrototypeRuntime.advance(5));s=await state();assert.equal(s.finance,'refund-processing');assert.equal(s.refundAmount,298,'确认未完成达到本轮截止应全额退款');
  });
  await runCase('紧急请假只将本技师已接未出发订单移入派单池',async()=>{
    const paid=await payOrder();
    await page.evaluate(()=>window.PrototypeRuntime.patch({stage:'accepted',tech:'林师傅',leave:'pending',leaveDetails:{tech:'林师傅',date:'2026-10-02',type:'urgent'}}));
    const before=await state();await route('s-schedule');await action('approve-leave');const after=await state();
    assert.equal(after.leave,'approved');assert.equal(after.stage,'dispatching');assert.equal(after.tech,'林师傅');assert.equal(after.finance,before.finance);
    assert.equal(after.paidAt,paid.paidAt,'批准请假不能伪造重新支付');assert.equal(after.refundAmount,before.refundAmount);await shot('34-本技师未出发订单请假移池');
  });
  await runCase('紧急请假保护已出发到达服务完成及其他技师订单',async()=>{
    const fixtures=[['departed','林师傅'],['arrived','林师傅'],['serving','林师傅'],['completed','林师傅'],['accepted','陈师傅']];
    for(const [stage,tech]of fixtures){
      await reset();await page.evaluate(({stage,tech})=>window.PrototypeRuntime.patch({paid:true,realname:true,stage,tech,finance:stage==='completed'?'pending-settlement':'paid',finishedAt:stage==='completed'?Date.now():undefined,leave:'pending',leaveDetails:{tech:'林师傅',date:'2026-10-02',type:'urgent'},deadlines:{}}),{stage,tech});
      const before=await state();await route('s-schedule');await action('approve-leave');const after=await state();
      assert.equal(after.leave,'approved');assert.equal(after.stage,before.stage,`请假不能改变 ${tech} 的 ${stage} 订单`);assert.equal(after.tech,before.tech);assert.equal(after.finance,before.finance);
      assert.deepEqual(after.deadlines,before.deadlines,'不受影响订单不能新增派单计时');assert.equal(after.refundAmount,before.refundAmount);
      result.interactionChecks.push({name:`请假保护 ${tech} ${stage}`,pass:true,screen:screenOf(page),expected:{stage,tech,finance:before.finance}});
    }
    await shot('35-其他技师已接单不受请假影响');
  });
  await runCase('求助结案仍有争议保持客服介入和资金暂停',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('u-sos');await action('sos-send');await openSosClosure();
    await fill('sosResult','双方人身安全已确认，订单责任争议尚未解决，由集团继续核实。');await page.locator('.sheet .check-row input').check();await action('sos-close');
    const s=await state();assert.equal(s.sos,'closed');assert.equal(s.sosUnresolved,true);assert.equal(s.stage,'service');assert.equal(s.finance,'blocked');
    assert.equal(screenOf(page),'s-sos-closed');assert.match(await page.locator('.status-hero').innerText(),/争议.*核实|暂停分账/);
    await route('u-order-current');assert.equal(screenOf(page),'u-o-service');await shot('36-求助结案继续核实');
  });
  await runCase('求助无争议结案恢复原服务中和原资金状态',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('u-sos');await action('sos-send');await openSosClosure();
    await fill('sosResult','已确认误触求助，双方同意继续履约，无订单争议。');await page.locator('.sheet .check-row input').uncheck();await action('sos-close');
    const s=await state();assert.equal(s.sos,'closed');assert.equal(s.sosUnresolved,false);assert.equal(s.stage,'serving');assert.equal(s.finance,'paid');
    await route('u-order-current');assert.equal(screenOf(page),'u-o-serving');await shot('37-求助已解恢复服务中');
  });
  await runCase('已完成订单求助结案不回退且保留完成时间',async()=>{
    for(const unresolved of [false,true]){
      await reset();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.patch({paid:true,stage:'completed',finance:'pending-settlement',finishedAt:R.now()-30*60000});});
      const finishedAt=(await state()).finishedAt;await route('u-sos');await action('sos-send');assert.equal((await state()).stage,'completed');await openSosClosure();
      await fill('sosResult',unresolved?'人身安全已确认，完成后订单争议继续核实。':'已完成回访，双方安全且无待核实争议。');await page.locator('.sheet .check-row input').setChecked(unresolved);await action('sos-close');
      const s=await state();assert.equal(s.stage,'completed','安全结案不能把已完成订单回退到服务中或客服介入');assert.equal(s.finishedAt,finishedAt,'安全处理不能重写服务完成时间');
      assert.equal(s.finance,unresolved?'blocked':'pending-settlement');assert.equal(s.sosUnresolved,unresolved);assert.equal(s.sos,'closed');
      await route('u-sos-closed');const linkedOrder=await kvText('关联订单');
      assert.equal(linkedOrder,unresolved?'尾号 0132 · 已完成 · 争议待核实':'尾号 0132 · 已完成','用户求助结案页须显示真实的已完成状态及是否继续核实');
      assert.doesNotMatch(linkedOrder,/服务中|客服介入/,'求助结案的关联订单不能显示已完成之前的静态示例状态');
      result.interactionChecks.push({name:'已完成求助结案 '+(unresolved?'继续核实':'无争议'),pass:true,screen:screenOf(page),expected:{stage:'completed',finance:s.finance,finishedAt}});
    }
    await shot('38-已完成求助结案保留完成时间');
  });
  await runCase('1分钱协商退款分摊无负数且尾差稳定',async()=>{
    await reset();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.patch({paid:true,realname:true,stage:'completed',finance:'pending-settlement',extension:2,extensionPayments:[149,149],extendedMinutes:60,finishedAt:R.now()});});
    await route('u-aftersale-apply');await fill('refundAmount','0.01');await check('refundExtension1');await fill('extensionRefund1','0.01');
    await fill('aftersaleDescription','主单和第一笔加钟各申请1分钱，第二笔加钟不申请退款，用于核对尾差。');await action('submit-aftersale');
    let s=await state();assert.equal(s.requestedRefund,0.02);assert.deepEqual(s.requestedRefundBreakdown,{main:0.01,extensions:[0.01,0]});
    await route('s-aftersale');await fill('refundOffer','0.01');await fillFirst(['refundPlanReason','refundExplanation','refundReason','refundOfferReason'],'总退款1分钱，按申请比例分摊，主单取得并列尾差。');await action('submit-refund-plan');
    await route('u-aftersale-confirm');await action('accept-refund-plan');s=await state();
    assert.equal(s.refundAmount,0.01);assert.deepEqual(s.refundBreakdown,[0.01,0,0]);assert.ok(s.refundBreakdown.every(amount=>amount>=0));
    assert.equal(s.refundBreakdown.reduce((sum,amount)=>sum+Math.round(amount*100),0),1,'各笔退款按分相加必须等于总退款');
    assert.equal(await kvText('主订单'),'¥0.01');assert.equal(await kvText('加钟子订单 1'),'¥0.00');assert.equal(await kvText('加钟子订单 2'),'¥0.00');await shot('39-1分钱分摊不产生负数');
  });
  await runCase('147元诉求协商70元按比例分摊并显示明细',async()=>{
    await reset();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.patch({paid:true,realname:true,stage:'completed',finance:'pending-settlement',price:298,duration:60,extension:1,extensionPayments:[149],extendedMinutes:30,finishedAt:R.now()});});
    await route('u-aftersale-apply');await fill('refundAmount','98');await check('refundExtension1');await fill('extensionRefund1','49');await fill('aftersaleDescription','主单诉求98元，加钟49元，门店协商合计退70元。');await action('submit-aftersale');
    await route('s-aftersale');await fill('refundOffer','70');await fillFirst(['refundPlanReason','refundExplanation','refundReason','refundOfferReason'],'核实后协商合计退70元，按原申请98比49比例分到各笔。');await action('submit-refund-plan');
    await route('u-aftersale-confirm');await action('accept-refund-plan');const s=await state();
    assert.equal(s.refundAmount,70);assert.deepEqual(s.refundBreakdown,[46.67,23.33]);assert.equal(s.refundBreakdown.reduce((sum,amount)=>sum+Math.round(amount*100),0),7000);
    assert.equal(await kvText('主订单'),'¥46.67');assert.equal(await kvText('加钟子订单 1'),'¥23.33');await shot('40-70元协商比例分摊');
  });
  await runCase('正常完成必须服务满主单和已付加钟总时长',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({paid:true,stage:'serving',finance:'paid',duration:60,elapsed:60,extension:1,extensionPayments:[149],extendedMinutes:30}));await route('t-finish');
    assert.equal(await page.getByRole('button',{name:/正常完成/}).isDisabled(),true,'服务60分钟但已购买30分钟加钟时不能正常完成');
    await page.evaluate(()=>window.PrototypeRuntime.patch({elapsed:90}));await route('t-finish');const normal=page.getByRole('button',{name:/正常完成/});
    assert.equal(await normal.isDisabled(),false,'服务满90分钟后应可选择正常完成');await normal.click();await action('finish-service');
    const s=await state();assert.equal(s.stage,'completed');assert.equal(s.finance,'pending-settlement');assert.equal(s.elapsed,90);assert.ok(s.finishedAt>0);await shot('41-含加钟90分钟正常完成');
  });
  await runCase('确认改约开启新轮30分钟且保留首次支付时间',async()=>{
    const paid=await payOrder(),oldDeadline=await dispatchDeadline();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.advance(20);R.patch({stage:'accepted'});});
    await route('u-o-accepted');await action('reschedule');await page.getByRole('button',{name:/^16:00/}).click();await action('confirm-reschedule');
    let s=await state();assert.equal(s.stage,'waiting');assert.equal(s.paidAt,paid.paidAt);assert.ok(s.dispatchRoundStartedAt>paid.paidAt+19*60000);assert.equal(s.dispatchRoundExpiresAt,s.dispatchRoundStartedAt+30*60000);assert.ok(s.dispatchRoundExpiresAt>oldDeadline,'确认新预约后可建立有明确新上限的独立派单轮次');
    const deadline=s.dispatchRoundExpiresAt;await route('s-pick');await action('dispatch-order');s=await state();assert.equal(s.stage,'accepted');assert.equal(s.paidAt,paid.paidAt);assert.equal(await dispatchDeadline(),deadline,'新轮内部的门店补派不能再次延长期限');await shot('42-改约新轮期限固定');
  });
  await runCase('确认改约新轮不得越过预约开始前60分钟',async()=>{
    const paid=await payOrder();await page.evaluate(()=>window.PrototypeRuntime.advance(5));const appointment=await appointmentIn(85);
    await page.evaluate(appointment=>window.PrototypeRuntime.patch({stage:'accepted',proposedDate:appointment.date,proposedSlot:appointment.slot,proposedTech:'林师傅'}),appointment);await route('u-reschedule');await action('confirm-reschedule');
    let s=await state();assert.equal(s.paidAt,paid.paidAt);assert.equal(s.dispatchRoundExpiresAt,appointment.start-60*60000);assert.ok(s.dispatchRoundExpiresAt<s.dispatchRoundStartedAt+30*60000,'临近预约时派单可用时长应少于30分钟');
    const remaining=await page.evaluate(()=>{const R=window.PrototypeRuntime;return (R.getDispatchDeadline()-R.now())/60000;});assert.ok(remaining>0&&remaining<=25);
    await page.evaluate(remaining=>window.PrototypeRuntime.advance(remaining),remaining);s=await state();assert.equal(s.finance,'refund-processing');assert.equal(s.refundAmount,298,'开始前60分钟仍未派出时自动全额退款');await shot('43-改约受开始前60分钟上限约束');
  });
  await runCase('批准请假重新派单保留paidAt且受30分钟与开始前60分钟上限',async()=>{
    const paid=await payOrder(),oldDeadline=await dispatchDeadline();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.advance(20);R.patch({stage:'accepted',leave:'pending',leaveDetails:{tech:'林师傅',date:'2026-10-02',type:'urgent'}});});await route('s-schedule');await action('approve-leave');
    let s=await state();assert.equal(s.stage,'dispatching');assert.equal(s.paidAt,paid.paidAt);assert.equal(s.dispatchRoundExpiresAt,s.dispatchRoundStartedAt+30*60000);assert.ok(s.dispatchRoundExpiresAt>oldDeadline);
    const deadline=s.dispatchRoundExpiresAt;await route('s-pick');await action('dispatch-order');assert.equal((await state()).stage,'accepted');assert.equal(await dispatchDeadline(),deadline,'请假新轮内补派不得继续重置');
    const secondPaid=await payOrder(),appointment=await appointmentIn(85);await page.evaluate(appointment=>window.PrototypeRuntime.patch({stage:'accepted',date:appointment.date,slot:appointment.slot,leave:'pending',leaveDetails:{tech:'林师傅',date:appointment.isoDate,type:'urgent'}}),appointment);await route('s-schedule');await action('approve-leave');
    s=await state();assert.equal(s.paidAt,secondPaid.paidAt);assert.equal(s.stage,'dispatching');assert.equal(s.dispatchRoundExpiresAt,appointment.start-60*60000);assert.ok(s.dispatchRoundExpiresAt<s.dispatchRoundStartedAt+30*60000);await shot('44-请假新轮保留首次支付且受预约上限');
  });
  await runCase('提现失败重提计次重复提交及余额不足不计次',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.patch({realname:true,transferAuthorized:true,balance:100,withdrawOutcome:'failed'}));await route('u-withdraw');await action('withdraw-submit');
    let s=await state();assert.equal(s.withdrawalCount,1);assert.equal(s.balance,0);assert.equal(s.withdrawal,'processing');
    await page.evaluate(()=>window.PrototypeRuntime.dispatchAction('withdraw-submit'));s=await state();assert.equal(s.withdrawalCount,1,'处理中重复点击不能算作新提现');assert.equal(s.balance,0);
    await action('withdraw-query');s=await state();assert.equal(s.withdrawal,'failed');assert.equal(s.balance,100);assert.equal(s.withdrawalCount,1,'渠道失败的那次申请仍占用一次');
    await route('u-withdraw');await action('withdraw-submit');s=await state();assert.equal(s.withdrawalCount,2,'失败后重提创建新申请并占用一次');assert.equal(s.balance,0);await action('withdraw-query');assert.equal((await state()).balance,100);
    await page.evaluate(()=>window.PrototypeRuntime.patch({balance:9}));await route('u-withdraw');await action('withdraw-submit');s=await state();assert.equal(s.withdrawalCount,2,'前置可提现余额不足不计次');assert.equal(s.balance,9);assert.equal(s.withdrawal,'failed');await shot('45-提现失败重提与重复校验计次');
  });
  await runCase('仅反馈问题零金额结案不进入退款渠道',async()=>{
    await reset();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.patch({paid:true,realname:true,stage:'completed',finance:'pending-settlement',finishedAt:R.now()});});await route('u-aftersale-apply');
    await page.getByRole('button',{name:'仅反馈问题',exact:true}).click();await fill('aftersaleDescription','只反馈沟通体验，希望门店改善，不申请退款。');await action('submit-aftersale');
    let s=await state();assert.equal(s.requestedRefund,0);assert.equal(s.aftersale,'pending');assert.equal(s.finance,'blocked');
    await route('s-aftersale');await action('close-sheet');await action('approve-requested-refund');s=await state();
    assert.equal(s.aftersale,'result');assert.equal(s.stage,'completed');assert.equal(s.finance,'pending-settlement','零退款反馈结案恢复原待分账状态');assert.equal(s.refundAmount,0);assert.equal(screenOf(page),'u-aftersale-result');
    assert.equal(s.events.filter(e=>e.event==='申请退款').length,0,'零金额结果不能调用退款逻辑或创建退款事件');assert.ok(!s.refundBreakdown?.some(amount=>amount>0));await shot('46-仅反馈问题不申请零退款');
    assert.doesNotMatch(await page.locator('#app').innerText(),/集团.{0,12}裁决|裁决驳回|本次不支持退款|未发现时长不足|预约时长已完整提供|不予支持/,'仅反馈的门店处理结果不能残留集团裁决驳回的示例记录');
  });
  await runCase('求助期间全额退款完成后安全结案保留退款终态',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('u-sos');await action('sos-send');
    await route('u-aftersale-apply');await fill('refundAmount','298');await fill('aftersaleDescription','服务现场发生安全争议，申请主单全额退款298元。');await action('submit-aftersale');
    await route('s-aftersale');await action('close-sheet');await action('approve-requested-refund');await action('refund-refresh');
    let s=await state();assert.equal(s.stage,'refunded');assert.equal(s.finance,'refunded');assert.equal(s.refundAmount,298);assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),298);
    await openSosClosure();await fill('sosResult','退款渠道已确认完成，人身安全已确认，其他责任事项继续核实。');await page.locator('.sheet .check-row input').check();await action('sos-close');
    s=await state();assert.equal(s.sos,'closed');assert.equal(s.sosUnresolved,true);assert.equal(s.stage,'refunded','继续核实不能回退已经全额退款的履约终态');assert.equal(s.finance,'refunded','已经渠道确认的退款不能改成资金冻结');
    assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),298);await shot('47-求助结案保留已退款终态');
  });
  await runCase('求助期间结束服务再结案恢复待分账并保留完成时间',async()=>{
    await reset();await page.evaluate(()=>window.PrototypeRuntime.scenario('serving'));await route('u-sos');await action('sos-send');await route('t-finish');await action('finish-service');
    let s=await state();assert.equal(s.stage,'completed');assert.equal(s.finance,'blocked');const finishedAt=s.finishedAt;
    await openSosClosure();await fill('sosResult','服务已经结束，回访确认人身安全且双方没有其他订单争议。');await page.locator('.sheet .check-row input').uncheck();await action('sos-close');
    s=await state();assert.equal(s.stage,'completed');assert.equal(s.finishedAt,finishedAt);assert.equal(s.finance,'pending-settlement','求助期间结束的服务在无争议结案后应进入待分账，不能回到旧paid状态');assert.equal(s.sos,'closed');await shot('48-求助期间完成结案待分账');
  });
  await runCase('已接指定改派近开场确认触发派单截止全额退款',async()=>{
    const paid=await payOrder(),appointment=await appointmentIn(30);
    await page.evaluate(appointment=>window.PrototypeRuntime.patch({stage:'accepted',assignment:'specified',date:appointment.date,slot:appointment.slot}),appointment);
    await route('s-reassign-designated');await fill('reassignReason','已接指定技师临时无法履约，预约距现在约30分钟。');await action('store-reassign-designated');assert.equal((await state()).stage,'reassign');
    await route('u-o-reassign');await action('accept-reassign');const s=await state();
    assert.equal(s.finance,'refund-processing');assert.equal(s.stage,'refunded');assert.equal(s.refundAmount,298);assert.equal(s.paidAt,paid.paidAt);assert.match(s.refundReason,/派单超时/,'确认开启新轮时已超过开始前60分钟上限应立即退款');await shot('49-近开场指定改派确认退款');
  });
  await runCase('请假批准重试不延长期限且休假技师不能再次派回',async()=>{
    const paid=await payOrder();await page.evaluate(()=>window.PrototypeRuntime.patch({stage:'accepted',tech:'陈师傅',leave:'pending',leaveDetails:{tech:'陈师傅',date:'2026-10-02',type:'urgent'}}));await route('s-schedule');await action('approve-leave');
    const approved=await state();assert.equal(approved.stage,'dispatching');await page.evaluate(()=>window.PrototypeRuntime.advance(5));await route('s-schedule');await action('approve-leave');
    let s=await state();assert.equal(s.dispatchRoundStartedAt,approved.dispatchRoundStartedAt);assert.equal(s.dispatchRoundExpiresAt,approved.dispatchRoundExpiresAt);assert.equal(s.paidAt,paid.paidAt);assert.equal(s.stage,'dispatching');
    await route('s-pick');const unavailable=page.locator('.sheet .choice').filter({hasText:'陈师傅'}).first();assert.equal(await unavailable.isDisabled(),true,'请假的陈师傅不能再次作为门店派单候选');
    // 模拟旧页面提交：界面禁选之外，动作处理还必须重新核验休假状态。
    await page.evaluate(()=>{document.querySelectorAll('.sheet .choice').forEach(node=>node.classList.remove('selected'));const node=[...document.querySelectorAll('.sheet .choice')].find(node=>node.textContent.includes('陈师傅'));node.disabled=false;node.classList.add('selected');});
    await page.evaluate(()=>window.PrototypeRuntime.dispatchAction('dispatch-order'));s=await state();assert.equal(s.stage,'dispatching');assert.equal(s.tech,'陈师傅');assert.equal(s.dispatchRoundExpiresAt,approved.dispatchRoundExpiresAt);
    await route('s-reassign-nearby');assert.equal(await page.locator('[name="nextTech"][value="chen"]').isDisabled(),true);
    await fill('reassignReason','仅允许未请假的同店技师接替本单。');await page.evaluate(()=>{const chen=document.querySelector('[name="nextTech"][value="chen"]'),zhou=document.querySelector('[name="nextTech"][value="zhou"]');chen.disabled=false;chen.checked=true;zhou.checked=false;});await page.evaluate(()=>window.PrototypeRuntime.dispatchAction('store-reassign-nearby'));
    assert.equal((await state()).stage,'dispatching','直接提交休假候选的改派动作也必须被拦截');
    await route('s-reassign-nearby');await fill('reassignReason','由可用的周师傅接替，请假的陈师傅不参与。');await page.locator('[name="nextTech"][value="zhou"]').check();await action('store-reassign-nearby');s=await state();assert.equal(s.stage,'accepted');assert.equal(s.tech,'周师傅');assert.equal(s.dispatchRoundExpiresAt,approved.dispatchRoundExpiresAt);
    assert.equal(screenOf(page),'s-reassign-result');assert.equal(await kvText('技师'),'周师傅','派单结果须显示实际选择的可用技师');const assignedHero=await page.locator('.status-hero').innerText();
    assert.match(assignedHero,/周师傅/);assert.doesNotMatch(assignedHero,/陈师傅/,'结果摘要不能残留已请假候选的静态示例姓名');await shot('50-请假批准幂等与派单候选拦截');
  });
  await runCase('普通请假保存完整时段且不影响无日期重叠订单',async()=>{
    const paid=await payOrder();await page.evaluate(()=>window.PrototypeRuntime.patch({stage:'accepted'}));await route('t-leave-apply');
    await page.locator('[name="leaveType"]').selectOption('normal');await fill('leaveDate','2026-10-05');await fill('leaveEndDate','2026-10-05');await fill('leaveStart','09:00');await fill('leaveEnd','18:00');await fill('leaveReason','10月5日家中有事，申请当天09至18点普通请假。');await action('staff-leave-submit');
    let s=await state();assert.equal(s.leave,'pending');assert.equal(s.leaveDetails.tech,'林师傅');const detail=JSON.stringify(s.leaveDetails);assert.match(detail,/2026-10-05/);assert.match(detail,/09:00/,'请假申请必须保留开始时间');assert.match(detail,/18:00/,'请假申请必须保留结束时间');
    const before=s;await route('s-schedule');await action('approve-leave');s=await state();assert.equal(s.leave,'approved');assert.equal(s.stage,'accepted','10月5日请假不能影响10月2日已接订单');assert.equal(s.leaveAffectedOrder,false);assert.equal(s.paidAt,paid.paidAt);assert.equal(s.dispatchRoundStartedAt,before.dispatchRoundStartedAt);assert.equal(s.dispatchRoundExpiresAt,before.dispatchRoundExpiresAt);assert.equal(await page.evaluate(()=>window.PrototypeRuntime.techAvailable('林师傅')),true,'非请假时段仍应保留该技师可用状态');await shot('51-普通请假不影响其他日期订单');
  });
  await runCase('重复售后按剩余可退额累计退款且零反馈保留历史',async()=>{
    await reset();await page.evaluate(()=>{const R=window.PrototypeRuntime;R.patch({service:'neck',price:198,duration:45,paid:true,realname:true,stage:'completed',finance:'pending-settlement',finishedAt:R.now()});});
    await route('u-aftersale-apply');await fill('refundAmount','98');await fill('aftersaleDescription','第一次申请退款98元。');await action('submit-aftersale');await route('s-aftersale');await action('close-sheet');await action('approve-requested-refund');
    assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),0);assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundTotal()),98);assert.deepEqual(await page.evaluate(()=>window.PrototypeRuntime.refundableBalances()),[100],'处理中98元也应占用该笔可退余额');
    await action('refund-refresh');assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),98);await page.evaluate(()=>window.PrototypeRuntime.dispatchAction('refund-refresh'));assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),98,'重复渠道刷新不能重复记账');
    await route('u-aftersale-apply');assert.equal(await page.locator('[name="refundAmount"]').getAttribute('max'),'100');await fill('refundAmount','150');await fill('aftersaleDescription','第二次尝试申请150元，应被剩余可退100元上限阻止。');await action('submit-aftersale');let s=await state();assert.notEqual(s.aftersale,'pending');assert.equal(s.finance,'refunded');assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),98);
    await fill('refundAmount','100');await fill('aftersaleDescription','改为申请剩余可退100元。');await action('submit-aftersale');await route('s-aftersale');await action('close-sheet');await action('approve-requested-refund');
    s=await state();assert.equal(s.refundAmount,100,'refundAmount只记录本次退款');assert.equal(s.finance,'refund-processing');assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),98);assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundTotal()),198);assert.deepEqual(await page.evaluate(()=>window.PrototypeRuntime.refundableBalances()),[0]);
    await action('refund-refresh');assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),198);await page.evaluate(()=>window.PrototypeRuntime.dispatchAction('refund-refresh'));assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),198);await route('u-invoice-form');assert.equal(await kvText('开票金额'),'¥0.00','累计198元退款后的净开票金额为0');
    await route('u-aftersale-apply');await page.getByRole('button',{name:'仅反馈问题',exact:true}).click();await fill('aftersaleDescription','退款后只追加反馈，不申请新的退款。');await action('submit-aftersale');await route('s-aftersale');await action('close-sheet');await action('approve-requested-refund');
    s=await state();assert.equal(s.refundAmount,0);assert.equal(s.stage,'refunded');assert.equal(s.finance,'refunded');assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundedTotal()),198,'0金额反馈不能清空已渠道确认累计退款');assert.equal(await page.evaluate(()=>window.PrototypeRuntime.refundTotal()),198);assert.deepEqual(await page.evaluate(()=>window.PrototypeRuntime.refundableBalances()),[0]);
    assert.doesNotMatch(await page.locator('#app').innerText(),/集团.{0,12}裁决|裁决驳回|本次不支持退款|未发现时长不足|预约时长已完整提供|不予支持/);await route('u-invoice-form');assert.equal(await kvText('开票金额'),'¥0.00');await shot('52-累计退款后反馈保留退款历史');
  });
}

(async()=>{
  fs.mkdirSync(OUTPUT,{recursive:true});
  browser=await chromium.launch({headless:true,executablePath:EDGE});
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'zh-CN'});
  page=await context.newPage();
  page.on('pageerror',error=>browserErrors.push({type:'pageerror',message:error.message}));
  page.on('console',message=>{if(message.type()==='error')browserErrors.push({type:'console',message:message.text()});});
  page.setDefaultTimeout(8000);
  if(process.env.TIANLI_VERIFY_ONLY==='interaction'){
    await page.goto(new URL('app.html?screen=u-home&demo=1',BASE).href);
    await page.waitForFunction(()=>window.PrototypeRuntime&&document.body.dataset.ready==='1');
    result.catalog=await page.evaluate(()=>window.SCREENS.map(s=>({id:s.id,role:s.role,title:s.title,state:s.state})));
  }else await scanCatalog();
  if(process.env.TIANLI_VERIFY_ONLY!=='render') await interactions();
  result.finishedAt=new Date().toISOString();
  result.summary={screens:result.catalog.length,renderChecks:result.renderChecks.length,issues:result.issues.length,interactionPass:result.interactionChecks.filter(x=>x.pass).length,interactionFail:result.interactionChecks.filter(x=>!x.pass).length,placeholderScreens:result.renderChecks.filter(x=>x.placeholders.length).length};
  fs.writeFileSync(path.join(OUTPUT,'verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result.summary));
  console.log('REPORT '+path.join(OUTPUT,'verification.json'));
  await browser.close();
  if(result.issues.length)process.exitCode=1;
})().catch(async error=>{
  result.fatal={message:error.message,stack:error.stack};result.finishedAt=new Date().toISOString();
  fs.mkdirSync(OUTPUT,{recursive:true});fs.writeFileSync(path.join(OUTPUT,'verification.json'),JSON.stringify(result,null,2));
  console.error(error.stack);if(browser)await browser.close();process.exitCode=1;
});
