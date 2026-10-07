/* v4 预约版浏览器验收。使用本机已有 Playwright 和 Edge。 */
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {chromium}=require('H:/connextes/edu-plate/node_modules/playwright');
const BASE=process.env.TIANLI_V4_BASE_URL||'http://127.0.0.1:4184/';
const OUTPUT=process.env.TIANLI_V4_VERIFY_OUTPUT||path.join(__dirname,'verification');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const FORBIDDEN=/上门|到店|出发|到达|交通费|路程|门牌|轨迹/g;
const result={startedAt:new Date().toISOString(),base:BASE,widths:[320,390,430],catalog:[],renderChecks:[],issues:[],interactionCases:[],interactionChecks:[],screenshots:[],failedResources:[]};
const browserErrors=[];
let browser,page,context;
const runtime=()=>window.BookingRuntime||window.PrototypeRuntime;
const screenOf=page=>new URL(page.url()).searchParams.get('screen');
const state=()=>page.evaluate(()=>structuredClone((window.BookingRuntime||window.PrototypeRuntime).getState()));
const safe=text=>text.replace(/[<>:"/\\|?*\x00-\x1f]/g,'、').replace(/[ .]+$/,'');
async function ready(){await page.waitForFunction(()=>document.body.dataset.ready==='1'&&(window.BookingRuntime||window.PrototypeRuntime));}
async function route(id){
  await page.evaluate(id=>(window.BookingRuntime||window.PrototypeRuntime).go(id),id);
  assert.notEqual((await page.locator('#app').innerText()).trim(),'','跳转后不能是空页面：'+id);
  assert.ok(await page.evaluate(()=>Boolean(window.ScreenRenderers[new URL(location.href).searchParams.get('screen')])),'跳转后须进入已注册页面：'+id);
}
async function action(name,data={}){
  let selector=`[data-action="${name}"]`;
  for(const [key,value]of Object.entries(data))selector+=`[data-${key}="${String(value).replace(/"/g,'\\"')}"]`;
  const button=page.locator(selector).filter({visible:true}).first();
  assert.ok(await button.count(),`当前 ${screenOf(page)} 缺少真实按钮 ${selector}`);
  await button.click();
}
async function fill(name,value){const field=page.locator(`[name="${name}"]`).first();assert.ok(await field.count(),'缺少真实输入：'+name);await field.fill(String(value));}
async function check(name,on=true){const field=page.locator(`[name="${name}"]`).first();assert.ok(await field.count(),'缺少真实勾选：'+name);await field.setChecked(on);}
async function select(name,value){const field=page.locator(`[name="${name}"]`).first();assert.ok(await field.count(),'缺少真实选择：'+name);await field.selectOption(String(value));}
async function kv(key){return page.evaluate(key=>[...document.querySelectorAll('.kv')].find(row=>row.firstElementChild?.textContent.trim()===key)?.lastElementChild?.textContent.trim(),key);}
async function shot(name){const file=path.join(OUTPUT,'验收-'+safe(name)+'.png');await page.screenshot({path:file});result.screenshots.push(file);}
async function checkpoint(name,expected){const s=await state();for(const [key,value]of Object.entries(expected))assert.deepEqual(s[key],value,name+'：'+key);result.interactionChecks.push({name,pass:true,screen:screenOf(page),expected});}
async function runCase(name,fn){
  try{await fn();result.interactionCases.push({name,pass:true});console.log('PASS '+name);}
  catch(error){result.interactionCases.push({name,pass:false,error:error.message,screen:screenOf(page)});result.issues.push({type:'interaction',name,error:error.message,screen:screenOf(page)});await shot('失败-'+name);console.log('FAIL '+name+': '+error.message);}
}
async function reset(){await page.goto(new URL('app.html?screen=u-home&demo=1',BASE).href);await ready();await page.evaluate(()=>(window.BookingRuntime||window.PrototypeRuntime).scenario('reset'));}
async function patch(values){await page.evaluate(values=>(window.BookingRuntime||window.PrototypeRuntime).patch(values),values);}
async function advance(minutes){await page.evaluate(minutes=>(window.BookingRuntime||window.PrototypeRuntime).advance(minutes),minutes);}
async function payFixture(values={}){
  await reset();await patch({identityVerified:true,adult:true,health:true,consent:true,contact:{name:'王测试',phone:'13900008000'},...values});await route('u-confirm');await action('pay');
  const s=await state();assert.equal(s.paid,true);assert.equal(s.stage,'waiting');assert.equal(s.finance,'paid');assert.ok(s.paidAt>0);return s;
}
async function confirmFixture(values={}){const paid=await payFixture(values);await patch({staffTechId:paid.techId});await route('t-appointment-waiting');await action('accept-appointment');assert.equal((await state()).stage,'confirmed');return paid;}
async function appointmentIn(minutes){return page.evaluate(minutes=>{const R=window.BookingRuntime||window.PrototypeRuntime,now=R.now?R.now():Date.now()+R.getState().clockOffsetMs;const start=Math.floor((now+minutes*60000)/60000)*60000,parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(start)),part=type=>parts.find(item=>item.type===type).value;return {start,date:part('year')+'-'+part('month')+'-'+part('day'),slot:part('hour')+':'+part('minute')};},minutes);}
async function reachAppointment(){const minutes=await page.evaluate(()=>{const R=window.BookingRuntime||window.PrototypeRuntime,s=R.getState(),now=R.now?R.now():Date.now()+s.clockOffsetMs;return Math.max(0,(window.BookingData.appointmentStart(s)-now)/60000);});await advance(minutes);}
async function moneyState(){return page.evaluate(()=>{const R=window.BookingRuntime||window.PrototypeRuntime;return {paid:R.paidTotal(),displayedRefund:R.refundTotal(),confirmedRefund:R.refundedTotal(),available:R.refundableBalances()};});}
async function applyRefund(main,extensions=[],description='请核实履约情况及各笔退款金额。'){
  await route('u-aftersale-apply');await check('refundMain');await fill('refundAmount',main);for(const [index,amount]of extensions.entries()){await check('refundExtension'+(index+1));await fill('extensionRefund'+(index+1),amount);}await fill('refundDescription',description);await action('submit-aftersale');
}
async function offerRefund(amount,reason='核实后提出退款方案，请用户确认。'){await route('s-aftersale');await fill('refundOffer',amount);await fill('refundReason',reason);await action('store-refund-offer');await route('u-aftersale-confirm');await action('accept-refund-plan');}
async function scanCatalog(){
  await page.goto(new URL('app.html?screen=u-home',BASE).href);await ready();
  result.catalog=await page.evaluate(()=>window.SCREENS.map(({id,role,group,title,state,caption,file})=>({id,role,group,title,state,caption,file})));
  const ids=new Set();for(const meta of result.catalog){if(ids.has(meta.id))result.issues.push({type:'duplicate-id',id:meta.id});ids.add(meta.id);const forbidden=JSON.stringify(meta).match(FORBIDDEN);if(forbidden)result.issues.push({type:'forbidden-metadata',id:meta.id,terms:[...new Set(forbidden)]});}
  let count=0;
  for(const width of result.widths){
    await page.setViewportSize({width,height:844});
    for(const meta of result.catalog){
      const errorStart=browserErrors.length;await page.goto(new URL('app.html?screen='+encodeURIComponent(meta.id),BASE).href);await ready();await page.evaluate(()=>document.fonts.ready);
      const measured=await page.evaluate(()=>{
        const R=window.BookingRuntime||window.PrototypeRuntime,app=document.getElementById('app'),appBox=app.getBoundingClientRect(),bounds=[],small=[],alignment=[];
        const visible=element=>{const c=getComputedStyle(element),r=element.getBoundingClientRect();return c.display!=='none'&&c.visibility!=='hidden'&&r.width>0&&r.height>0;};
        const xoverflow=[document.documentElement,document.body,app,...app.querySelectorAll('.content,.sheet-body,.detail,.card,.group,.action-footer,.payment-footer')].filter(element=>element.scrollWidth>element.clientWidth+1).map(element=>({tag:element.tagName,class:element.className,scrollWidth:element.scrollWidth,clientWidth:element.clientWidth}));
        for(const element of app.querySelectorAll('button,input,textarea,select')){
          if(!visible(element))continue;const r=element.getBoundingClientRect(),parent=element.parentElement,p=parent.getBoundingClientRect(),ps=getComputedStyle(parent),left=p.left+(parseFloat(ps.paddingLeft)||0)+(parseFloat(ps.borderLeftWidth)||0),right=p.right-(parseFloat(ps.paddingRight)||0)-(parseFloat(ps.borderRightWidth)||0);
          let rail=null;for(let a=parent;a&&a!==app;a=a.parentElement)if(['auto','scroll'].includes(getComputedStyle(a).overflowX)&&a.scrollWidth>a.clientWidth+1){rail=a;break;}
          const railItem=rail&&r.width<=rail.clientWidth+1,navBack=element.matches('.navigation .back');
          if(!railItem&&(r.left<appBox.left-1||r.right>appBox.right+1||(!navBack&&(r.left<left-1||r.right>right+1))))bounds.push({tag:element.tagName,label:element.innerText||element.name||element.getAttribute('aria-label'),class:element.className,left:r.left,right:r.right,parentLeft:left,parentRight:right});
          if(element.matches('button.button.primary')&&r.height<47.5)small.push({label:element.innerText,height:r.height});
          // 选择列表有明确左对齐；紧凑主按钮的完整内容组应居中。
          if(element.matches('button.button.primary')&&!element.closest('.picker-options')){const c=getComputedStyle(element);if(c.alignItems!=='center'||c.justifyContent!=='center')alignment.push({label:element.innerText,align:c.alignItems,justify:c.justifyContent});}
        }
        const title=app.querySelector('.navigation h1'),capsule=app.querySelector('.navigation .capsule');let titleCollision=null;if(title&&capsule){const t=title.getBoundingClientRect(),c=capsule.getBoundingClientRect();if(t.right>c.left+1&&t.bottom>c.top&&t.top<c.bottom)titleCollision={title:title.innerText,titleRight:t.right,capsuleLeft:c.left};}
        const aliases=new Set(['u-order-current','t-order-current']);
        const badTargets=[...app.querySelectorAll('[data-go]')].map(element=>({target:element.dataset.go,label:element.innerText})).filter(item=>!item.target||(!window.ScreenRenderers[item.target]&&!aliases.has(item.target)&&!window.ScreenRenderers[R.resolve?.(item.target)]));
        const unbound=[...app.querySelectorAll('[data-action]')].map(element=>({action:element.dataset.action,label:element.innerText||element.getAttribute('aria-label')})).filter(item=>!item.action||!R.actions[item.action]);
        const unboundButtons=[...app.querySelectorAll('button')].filter(element=>visible(element)&&!element.hasAttribute('data-action')&&!element.hasAttribute('data-go')&&!element.matches('[type="submit"]')).map(element=>element.innerText||element.getAttribute('aria-label'));
        const text=app.innerText;return {empty:!text.trim(),xoverflow,bounds,small,alignment,titleCollision,badTargets,unbound,unboundButtons,forbidden:[...new Set(text.match(/上门|到店|出发|到达|交通费|路程|门牌|轨迹/g)||[])]};
      });
      const errors=browserErrors.slice(errorStart);result.renderChecks.push({id:meta.id,width,...measured,errors});
      for(const key of ['xoverflow','bounds','small','alignment','badTargets','unbound','unboundButtons','forbidden'])for(const detail of measured[key])result.issues.push({type:key,id:meta.id,width,detail});
      if(measured.empty)result.issues.push({type:'empty',id:meta.id,width});if(measured.titleCollision)result.issues.push({type:'titleCollision',id:meta.id,width,detail:measured.titleCollision});for(const error of errors)result.issues.push({type:'browser',id:meta.id,width,error});
      count++;if(count%30===0)console.log(`RENDER ${count}/${result.catalog.length*result.widths.length}`);
    }
  }
  await page.setViewportSize({width:390,height:844});
}
async function interactions(){
  await runCase('真实填写片区门店项目技师联系人实名健康到付款',async()=>{
    await reset();await route('u-region');await action('select-region',{region:'home'});await route('u-stores');await action('select-store',{store:'xingfu'});await route('u-home');await action('select-service',{service:'relax'});await route('u-tech-picker');await action('select-tech',{tech:'nearest'});await route('u-slots');await action('select-slot',{slot:'14:00'});await action('submit-slot');
    assert.equal(screenOf(page),'u-contact');await fill('contactName','王母');await fill('contactPhone','13900008000');await action('submit-contact');assert.equal(screenOf(page),'u-identity');
    await fill('identityName','张测试');await fill('identityNumber','31010119900101123X');await check('identityConsent');await action('verify-identity');assert.equal(screenOf(page),'u-health');await check('adult');await check('health');await action('confirm-health');
    assert.equal(screenOf(page),'u-confirm');assert.match(await page.locator('#app').innerText(),/王母/);assert.match(await page.locator('#app').innerText(),/139\*{4}8000/);await action('pay');await checkpoint('付款后仍等待确认',{paid:true,stage:'waiting',finance:'paid',identityVerified:true,adult:true,health:true});
    const s=await state();assert.deepEqual(s.contact,{name:'王母',phone:'13900008000'});assert.equal(s.price,298);assert.equal(s.storeId,'xingfu');await shot('01-真实预约支付');
  });
  await runCase('拒绝定位后可继续手选片区',async()=>{
    await reset();await route('u-region');await action('locate');await action('deny-location');
    assert.equal(screenOf(page),'u-location-denied');await action('select-region',{region:'silver'});const s=await state();assert.equal(s.regionId,'silver');assert.match(await page.locator('#app').innerText(),/银杏/);await shot('02-定位拒绝手选');
  });
  await runCase('不同定位就近技师改变并按门店项目休假筛选',async()=>{
    await reset();await page.evaluate(()=>{const D=window.BookingData;(window.BookingRuntime||window.PrototypeRuntime).patch({storeId:'xingfu',serviceId:'neck',duration:45,price:198,busyBookings:[],location:{lat:D.tech('lin').lat,lng:D.tech('lin').lng}});});await route('u-tech-picker');await action('select-tech',{tech:'nearest'});assert.equal((await state()).techId,'lin');
    await page.evaluate(()=>{const D=window.BookingData;(window.BookingRuntime||window.PrototypeRuntime).patch({location:{lat:D.tech('chen').lat,lng:D.tech('chen').lng}});});await route('u-tech-picker');await action('select-tech',{tech:'nearest'});assert.equal((await state()).techId,'chen','位置改变应改变就近结果');
    await patch({serviceId:'relax',duration:60,price:298});await route('u-tech-picker');assert.equal(await page.locator('[data-action="select-tech"][data-tech="chen"]').count(),0,'不支持当前项目的技师不得显示为可选');await action('select-tech',{tech:'nearest'});assert.notEqual((await state()).techId,'chen');
    await page.evaluate(()=>{const R=window.BookingRuntime||window.PrototypeRuntime,s=R.getState();R.patch({leaveStatus:'approved',leaveDetails:{techId:s.techId,startDate:s.date,endDate:s.date,start:'00:00',end:'23:59',type:'urgent'}});});const resting=(await state()).techId;await route('u-tech-picker');assert.equal(await page.locator(`[data-action="select-tech"][data-tech="${resting}"]`).count(),0);await action('select-tech',{tech:'nearest'});assert.notEqual((await state()).techId,resting);
    await page.evaluate(()=>{const D=window.BookingData;(window.BookingRuntime||window.PrototypeRuntime).patch({storeId:'silver',serviceId:'relax',location:{lat:D.tech('ma').lat,lng:D.tech('ma').lng}});});await route('u-tech-picker');await action('select-tech',{tech:'nearest'});assert.equal((await state()).techId,'ma');assert.equal(await page.evaluate(()=>window.BookingData.tech((window.BookingRuntime||window.PrototypeRuntime).getState().techId).storeId),'silver');await shot('03-就近匹配随定位变化');
  });
  await runCase('门店安排直接确认且重复操作不重置截止',async()=>{
    const paid=await payFixture();await advance(10);await route('s-pick');const chosen=await page.locator('[name="nextTech"]:checked').inputValue();await action('store-assign');await checkpoint('门店直接确认预约',{stage:'confirmed',finance:'paid'});let s=await state();assert.equal(s.techId,chosen);assert.equal(s.roundDeadline,paid.roundDeadline);assert.equal(s.paidAt,paid.paidAt);
    for(let round=0;round<4;round++){await route('s-pick');assert.equal(await page.locator('[data-action="store-assign"]').isDisabled(),true,'已确认预约不能重复安排');await advance(10);s=await state();assert.equal(s.stage,'confirmed');assert.equal(s.finance,'paid');assert.equal(s.roundDeadline,paid.roundDeadline);assert.equal(s.paidAt,paid.paidAt);}
    await route('t-order-current');assert.equal(screenOf(page),'t-appointment-confirmed');await shot('04-门店直接确认');
  });
  await runCase('30分钟未确认自动全额退款',async()=>{
    const paid=await payFixture();await advance(10);assert.equal((await state()).roundDeadline,paid.roundDeadline);await advance(20);const s=await state();assert.equal(s.finance,'refund-processing');assert.equal(s.refundAmount,s.price);assert.notEqual(s.stage,'waiting');await shot('05-安排超时退款');
  });
  await runCase('指定改派确认前保留原技师拒绝全额退款',async()=>{
    const paid=await confirmFixture({assignment:'specified',techId:'lin'});await route('s-reassign');await select('assignmentMode','specified');await page.locator('[name="nextTech"][value="zhou"]').check();await fill('reassignReason','原指定技师临时无法提供本项目，请用户确认调整。');await action('store-reassign');
    let s=await state();assert.equal(s.stage,'confirmed');assert.equal(s.techId,paid.techId);assert.equal(s.pendingChange.type,'reassign');assert.equal(s.pendingChange.techId,'zhou');await route('u-reassign');await action('reject-reassign');s=await state();assert.equal(s.finance,'refund-processing');assert.equal(s.refundAmount,298);await shot('06-拒绝指定改派');
  });
  await runCase('指定改派同意直接确认新技师',async()=>{
    await confirmFixture({assignment:'specified',techId:'lin'});await route('s-reassign');await select('assignmentMode','specified');await page.locator('[name="nextTech"][value="zhou"]').check();await fill('reassignReason','已确认周师傅可提供本项目，请用户同意更换。');await action('store-reassign');await route('u-reassign');await action('accept-reassign');
    const s=await state();assert.equal(s.stage,'confirmed');assert.equal(s.techId,'zhou');assert.ok(!s.pendingChange);await route('s-reassign-result');assert.match(await kv('当前技师'),/周师傅/);await shot('07-指定改派确认新技师');
  });
  await runCase('改约拟选不覆盖正式预约确认后开启新轮',async()=>{
    const paid=await confirmFixture();await advance(20);await route('u-reschedule');await action('select-slot',{slot:'16:00'});assert.equal((await state()).slot,paid.slot);await action('submit-reschedule');const s=await state();assert.equal(s.slot,'16:00');assert.equal(s.stage,'waiting');assert.equal(s.changesLeft,0);assert.equal(s.paidAt,paid.paidAt);assert.equal(s.roundDeadline,s.roundStartedAt+30*60000);assert.ok(s.roundDeadline>paid.roundDeadline);await shot('08-改约确认生效');
  });
  await runCase('临近开始重新确认受开始前60分钟截止约束',async()=>{
    const paid=await confirmFixture({assignment:'specified'});await route('s-reassign');await select('assignmentMode','specified');await page.locator('[name="nextTech"][value="zhou"]').check();await fill('reassignReason','核验用户确认变更时的临近预约边界。');await action('store-reassign');const appointment=await appointmentIn(30);await patch({date:appointment.date,slot:appointment.slot});await route('u-reassign');await action('accept-reassign');const s=await state();assert.equal(s.paidAt,paid.paidAt);assert.equal(s.roundDeadline,appointment.start-60*60000);assert.ok(s.roundDeadline<s.roundStartedAt+30*60000);assert.equal(s.finance,'refund-processing');assert.equal(s.refundAmount,298);await shot('09-重新确认开始前截止');
  });
  await runCase('门店调整时间待确认保留原预约拒绝不变',async()=>{
    const original=await confirmFixture();await route('s-reschedule');await select('newSlot','16:00');await fill('rescheduleReason','建议协调本日16点项目时间，请用户确认。');await action('store-reschedule');let s=await state();assert.equal(s.slot,original.slot);assert.equal(s.techId,original.techId);assert.equal(s.stage,'confirmed');assert.equal(s.pendingChange.type,'reschedule');await route('u-store-reschedule');await action('reject-store-reschedule');s=await state();assert.equal(s.slot,original.slot);assert.equal(s.date,original.date);assert.equal(s.techId,original.techId);assert.equal(s.stage,'confirmed');await shot('10-拒绝门店改约');
  });
  await runCase('肩颈日间198夜间228价格随时段变化',async()=>{
    await reset();await route('u-home');await action('select-service',{service:'neck'});await route('u-tech-picker');await action('select-tech',{tech:'nearest'});await route('u-slots');
    for(const slot of ['21:00','22:00']){assert.match(await page.locator(`[data-action="select-slot"][data-slot="${slot}"]`).innerText(),/228/);await action('select-slot',{slot});assert.equal((await state()).price,228);}await action('select-slot',{slot:'14:00'});assert.equal((await state()).price,198);await shot('11-肩颈时段价格');
  });
  await runCase('预约时间前禁止开始到时间后开始记录',async()=>{
    await confirmFixture();await route('t-appointment-confirmed');await action('start-appointment');assert.equal((await state()).stage,'confirmed','预约时间前不能开始');await reachAppointment();await route('t-appointment-confirmed');await action('start-appointment');await checkpoint('预约时间到开始计时',{stage:'active',finance:'paid'});await shot('12-按预约时间开始');
  });
  await runCase('正常完成包含已付款加钟总时长',async()=>{
    await confirmFixture();await reachAppointment();await route('t-appointment-confirmed');await action('start-appointment');await action('request-extension');assert.equal((await state()).extensionPayments.length,0);await route('u-order-active');await action('pay-extension');assert.equal((await state()).extensionPayments.length,1);assert.equal((await moneyState()).paid,447);
    await advance(60);await route('t-finish');assert.equal(await page.locator('[data-action="finish-appointment"]').isDisabled(),true,'已付加钟后60分钟不能正常完成');await advance(30);await route('t-finish');assert.equal(await page.locator('[data-action="finish-appointment"]').isDisabled(),false);await fill('finishReason','按约定完成主项目与加钟共90分钟。');await action('finish-appointment');await checkpoint('满主项目加钟后完成',{stage:'completed',finance:'pending-settlement'});await shot('13-满90分钟正常完成');
  });
  await runCase('客服协助冻结资金明确继续后恢复记录',async()=>{
    await confirmFixture();await reachAppointment();await route('t-appointment-confirmed');await action('start-appointment');await route('t-care');await fill('careReason','项目过程中需要门店沟通力度偏好。');await action('request-care');await checkpoint('请求协助冻结资金',{stage:'care',finance:'blocked'});
    await route('s-care');await select('careOutcome','continue');await fill('careResult','已与用户和技师确认，可按原预约继续进行。');await check('continueCare');await action('close-care');await checkpoint('门店记录继续后恢复',{stage:'active',finance:'paid'});await shot('14-客服处理继续预约');
  });
  await runCase('请假只影响本人已确认且重叠预约并禁止重复开轮',async()=>{
    const paid=await confirmFixture({techId:'lin'});await route('t-leave');await select('leaveType','normal');await fill('leaveStartDate',paid.date);await fill('leaveEndDate',paid.date);await fill('leaveStart','13:00');await fill('leaveEnd','17:00');await fill('leaveReason','本预约时段有个人事项，请门店处理。');await action('submit-leave');await route('s-leave-review');await action('approve-leave');let s=await state();assert.equal(s.leaveStatus,'approved');assert.equal(s.stage,'waiting');assert.equal(s.paidAt,paid.paidAt);const deadline=s.roundDeadline;
    await advance(5);await route('s-leave-review');assert.equal(await page.locator('[data-action="approve-leave"]').isDisabled(),true,'已批准申请不能重复批准');s=await state();assert.equal(s.roundDeadline,deadline);await route('s-pick');assert.equal(await page.locator('[name="nextTech"][value="lin"]').isDisabled(),true);await shot('15-批准请假移入安排');
    for(const fixture of [{stage:'active',techId:'lin'},{stage:'completed',techId:'lin'},{stage:'confirmed',techId:'zhou'},{stage:'confirmed',techId:'lin',resourceCommitted:true}]){await reset();const base=await state();await patch({...fixture,paid:true,finance:fixture.stage==='completed'?'pending-settlement':'paid',leaveStatus:'pending',leaveDetails:{techId:'lin',startDate:base.date,endDate:base.date,start:'13:00',end:'17:00',type:'urgent'}});await route('s-leave-review');await action('approve-leave');const after=await state();assert.equal(after.stage,fixture.stage);assert.equal(after.techId,fixture.techId);}
  });
  await runCase('普通请假完整日期保存且不影响其他日期预约',async()=>{
    const paid=await confirmFixture();const otherDate=new Date(paid.date+'T12:00:00+08:00');otherDate.setUTCDate(otherDate.getUTCDate()+3);const iso=otherDate.toISOString().slice(0,10);await route('t-leave');await select('leaveType','normal');await fill('leaveStartDate',iso);await fill('leaveEndDate',iso);await fill('leaveStart','09:00');await fill('leaveEnd','18:00');await fill('leaveReason','三天后的个人安排，不影响当前预约。');await action('submit-leave');await route('s-leave-review');await action('approve-leave');const s=await state();assert.equal(s.stage,'confirmed');assert.equal(s.techId,paid.techId);assert.equal(s.leaveDetails.startDate,iso);assert.equal(s.leaveDetails.endDate,iso);assert.equal(s.leaveDetails.start,'09:00');assert.equal(s.leaveDetails.end,'18:00');await shot('16-普通请假保留无重叠预约');
  });
  await runCase('主项目和加钟申请147元协商70元比例分摊',async()=>{
    await reset();await patch({paid:true,identityVerified:true,stage:'completed',finance:'pending-settlement',price:298,duration:60,extensionPayments:[149],elapsed:90,finishedAt:Date.now()});await applyRefund(98,[49]);await offerRefund(70);let s=await state();assert.equal(s.refundAmount,70);assert.deepEqual(s.refundBreakdown,[46.67,23.33]);assert.equal((await moneyState()).displayedRefund,70);await action('refund-refresh');assert.equal((await moneyState()).confirmedRefund,70);await route('u-invoice');assert.match(await kv('开票金额'),/377\.00/);await shot('17-协商退款按支付分摊');
  });
  await runCase('1分钱尾差稳定且零金额支付分摊无负数',async()=>{
    await reset();await patch({paid:true,identityVerified:true,stage:'completed',finance:'pending-settlement',extensionPayments:[149,149],finishedAt:Date.now()});await applyRefund(0.01,[0.01,0]);await offerRefund(0.01);const s=await state();assert.deepEqual(s.refundBreakdown,[0.01,0,0]);assert.ok(s.refundBreakdown.every(amount=>amount>=0));assert.equal(s.refundBreakdown.reduce((sum,amount)=>sum+Math.round(amount*100),0),1);await shot('18-1分钱尾差分摊');
  });
  await runCase('重复售后按198剩余金额退款且渠道刷新幂等',async()=>{
    await reset();await patch({serviceId:'neck',price:198,duration:45,paid:true,identityVerified:true,stage:'completed',finance:'pending-settlement',finishedAt:Date.now()});await applyRefund(98);await route('s-aftersale');await action('store-refund-approve');assert.equal((await moneyState()).available[0],100);await action('refund-refresh');assert.equal((await moneyState()).confirmedRefund,98);await route('u-refund-processing');await action('refund-refresh');assert.equal((await moneyState()).confirmedRefund,98);
    await route('u-aftersale-apply');assert.equal(Number(await page.locator('[name="refundAmount"]').getAttribute('max')),100);await fill('refundAmount',150);await fill('refundDescription','尝试申请超过剩余100元的金额，必须拦截。');await action('submit-aftersale');assert.equal((await moneyState()).confirmedRefund,98);assert.equal((await state()).finance,'refunded');await fill('refundAmount',100);await fill('refundDescription','申请剩余可退100元。');await action('submit-aftersale');await route('s-aftersale');await action('store-refund-approve');assert.equal((await moneyState()).displayedRefund,198);await action('refund-refresh');await route('u-refund-processing');await action('refund-refresh');assert.equal((await moneyState()).confirmedRefund,198);assert.deepEqual((await moneyState()).available,[0]);await route('u-invoice');assert.match(await kv('开票金额'),/0\.00/);await shot('19-累计退款净开票');
  });
  await runCase('提现失败恢复一次重提计次每天三次上限',async()=>{
    await reset();await patch({identityVerified:true,balance:9,transferAuthorized:true,withdrawalOutcome:'failed'});await route('u-withdraw');await action('withdraw-submit');assert.equal((await state()).withdrawalCount,0,'余额不足不应记提现次数');await patch({balance:100});await route('u-withdraw');await action('withdraw-submit');let s=await state();assert.equal(s.balance,0);assert.equal(s.withdrawalCount,1);await route('u-withdraw');await action('withdraw-submit');assert.equal((await state()).withdrawalCount,1);await action('withdraw-query');s=await state();assert.equal(s.withdrawal,'failed');assert.equal(s.balance,100);await action('withdraw-query');assert.equal((await state()).balance,100);
    for(const expected of [2,3]){await route('u-withdraw');await action('withdraw-submit');assert.equal((await state()).withdrawalCount,expected);await action('withdraw-query');assert.equal((await state()).balance,100);}await route('u-withdraw');await action('withdraw-submit');s=await state();assert.equal(s.withdrawalCount,3);assert.equal(s.balance,100);assert.match(await page.locator('#app').innerText(),/3次|3 次/);await shot('20-提现失败幂等及每日上限');
  });
  await runCase('跨角色查看与刷新保留同笔预约和联系人',async()=>{
    await confirmFixture({contact:{name:'李测试',phone:'13800009000'}});const before=await state();await page.goto(new URL('demo.html',BASE).href);const frame=page.frameLocator('#phone');await frame.locator('body[data-ready="1"]').waitFor();
    for(const role of ['tech','store','user']){await page.locator(`[data-role="${role}"]`).click();await page.waitForFunction(role=>{const R=document.getElementById('phone').contentWindow.BookingRuntime;return role==='tech'?R.getScreen()==='t-work':role==='store'?R.getScreen()==='s-board':R.getScreen()==='u-order-confirmed';},role);const snapshot=await frame.locator('#app').evaluate(()=>structuredClone(window.BookingRuntime.getState()));assert.equal(snapshot.paidAt,before.paidAt);assert.equal(snapshot.techId,before.techId);assert.deepEqual(snapshot.contact,before.contact);}
    await page.reload();await frame.locator('body[data-ready="1"]').waitFor();const after=await frame.locator('#app').evaluate(()=>structuredClone(window.BookingRuntime.getState()));assert.equal(after.paidAt,before.paidAt);assert.equal(after.techId,before.techId);assert.equal(after.stage,'confirmed');assert.deepEqual(after.contact,before.contact);await shot('21-跨角色同单刷新保留');
  });
  await runCase('性别偏好和排班休息及占用时段筛选',async()=>{
    await reset();await patch({serviceId:'neck',duration:45,price:198,slot:'16:00'});await route('u-tech-picker');await select('genderPreference','female');await action('select-tech',{tech:'nearest'});assert.equal((await state()).techId,'chen');await route('u-tech-picker');assert.equal(await page.locator('[data-tech="lin"]').count(),0);await select('genderPreference','male');await action('select-tech',{tech:'nearest'});assert.notEqual((await state()).techId,'chen');
    await patch({assignment:'specified',techId:'chen',genderPreference:'any',slot:'14:00'});await route('u-slots');assert.equal(await page.locator('[data-slot="14:30"]').isDisabled(),true,'已有预约占用必须禁选');assert.equal(await page.locator('[data-slot="16:00"]').isDisabled(),false);await patch({techId:'lin',schedules:{lin:{start:'13:00',end:'17:00',breakStart:'15:00',breakEnd:'16:00'}}});await route('u-slots');for(const slot of ['10:00','14:30','15:00','19:00'])assert.equal(await page.locator(`[data-slot="${slot}"]`).isDisabled(),true,slot+'必须按排班禁选');assert.equal(await page.locator('[data-slot="16:00"]').isDisabled(),false);await shot('22-偏好排班与占用筛选');
    await confirmFixture();await route('t-schedule-edit');await fill('scheduleStart','09:00');await fill('scheduleEnd','23:00');await fill('breakStart','14:00');await fill('breakEnd','15:00');await action('save-schedule');assert.ok(!(await state()).schedules?.lin,'休息不能覆盖已确认预约');assert.match(await page.locator('#app').innerText(),/不能与已有预约冲突/);
  });
  await runCase('绕过日期选项仍禁止提交7天以外或两小时内预约',async()=>{
    await reset();const beyond=await appointmentIn(8*24*60);await patch({date:beyond.date,slot:'14:00'});await route('u-slots');await page.locator('[name="date"]').evaluate((node,value)=>{node.add(new Option(value,value));node.value=value;},beyond.date);await action('submit-slot');assert.equal(screenOf(page),'u-slots');assert.equal((await state()).paymentDeadline,0);assert.match(await page.locator('#app').innerText(),/2小时后至7天内/);
    const near=await appointmentIn(90);await patch({date:near.date,slot:near.slot});await route('u-slots');await page.locator('[name="date"]').evaluate((node,value)=>{if(![...node.options].some(o=>o.value===value))node.add(new Option(value,value));node.value=value;},near.date);await action('submit-slot');assert.equal(screenOf(page),'u-slots');assert.equal((await state()).paymentDeadline,0);await shot('23-提交日期边界校验');
  });
  await runCase('支付保留时限自然到期关闭且不扣款',async()=>{
    await reset();await patch({identityVerified:true,adult:true,health:true});await route('u-confirm');await page.evaluate(()=>{const R=window.BookingRuntime;R.patch({paymentDeadline:R.now()+1500});});await route('u-confirm');assert.ok(await page.locator('[data-countdown="paymentDeadline"]').count());await page.waitForFunction(()=>window.BookingRuntime.getState().stage==='closed',{},{timeout:5000});const s=await state();assert.equal(s.paid,false);assert.equal(s.paidAt,0);assert.equal(s.finance,'unpaid');assert.equal(screenOf(page),'u-payment-expired');await shot('24-支付自然超时');
  });
  await runCase('198预约取消按已产生费用事实显示39.60与158.40',async()=>{
    for(const committed of [false,true]){await confirmFixture({serviceId:'neck',price:198,duration:45,resourceCommitted:committed});await route('u-order-confirmed');await action('cancel');assert.equal(screenOf(page),'u-cancel-confirm');const text=await page.locator('#app').innerText();assert.match(text,committed?/39\.60/:/0\.00/);assert.match(text,committed?/158\.40/:/198\.00/);await action('confirm-cancel');const s=await state();assert.equal(s.refundAmount,committed?158.4:198);assert.equal(s.finance,'refund-processing');}await shot('25-198取消扣费与退款');
  });
  await runCase('退款渠道失败保留原金额明细且重试到账幂等',async()=>{
    await reset();await patch({paid:true,stage:'completed',finance:'pending-settlement',finishedAt:Date.now(),extensionPayments:[149],refundOutcome:'failed'});await applyRefund(98,[49]);await offerRefund(70);const before=await state();await action('refund-refresh');let s=await state();assert.equal(screenOf(page),'u-refund-failed');assert.equal(s.finance,'refund-failed');assert.equal(s.refundAmount,70);assert.deepEqual(s.refundBreakdown,before.refundBreakdown);assert.equal((await moneyState()).confirmedRefund,0);assert.deepEqual((await moneyState()).available,[251.33,125.67]);await patch({careOpen:true});await route('s-care');await select('careOutcome','continue');await fill('careResult','双方确认结束协助，原退款渠道继续重试。');await check('continueCare');await action('close-care');assert.equal((await state()).finance,'refund-failed','协助结案不能覆盖渠道失败状态');await route('u-order-current');assert.equal(screenOf(page),'u-refund-failed');await action('refund-retry');assert.equal((await state()).finance,'refund-processing');assert.deepEqual((await state()).refundBreakdown,before.refundBreakdown);await action('refund-refresh');assert.equal((await moneyState()).confirmedRefund,70);await route('u-refund-failed');await action('refund-retry');assert.equal((await moneyState()).confirmedRefund,70);assert.equal((await state()).finance,'refunded');await shot('26-退款失败原明细重试');
  });
  await runCase('仅反馈问题不新增退款且保留已确认累计退款',async()=>{
    await reset();await patch({serviceId:'neck',price:198,duration:45,paid:true,stage:'refunded',finance:'refunded',finishedAt:Date.now(),refundedByPayment:[198],refundAmount:198,aftersale:'result'});await route('u-aftersale-apply');await check('feedbackOnly');await fill('refundAmount',0);await fill('refundDescription','已经全额退款，仅记录沟通体验问题。');await action('submit-aftersale');assert.equal((await state()).requestedRefund,0);await route('s-aftersale');await action('store-refund-approve');const s=await state();assert.equal(screenOf(page),'u-aftersale-result');assert.equal(s.refundAmount,0);assert.equal(s.stage,'refunded');assert.equal(s.finance,'refunded');assert.deepEqual(s.refundedByPayment,[198]);assert.equal((await moneyState()).confirmedRefund,198);assert.doesNotMatch(await page.locator('#app').innerText(),/申请已驳回|退款处理中|集团裁决/);await shot('27-仅反馈保留累计退款');
  });
  await runCase('未双方确认继续保持客服协助及资金冻结',async()=>{
    await confirmFixture();await reachAppointment();await route('t-appointment-confirmed');await action('start-appointment');await route('t-care');await fill('careReason','等待双方核实预约体验。');await action('request-care');await route('s-care');await fill('careResult','已记录情况，双方尚未确认继续。');await action('close-care');assert.equal(screenOf(page),'s-care','未选择处理方式不能保存');assert.equal((await state()).careOpen,true);await select('careOutcome','continue');await action('close-care');const s=await state();assert.equal(s.stage,'care');assert.equal(s.finance,'blocked');assert.equal(s.careOpen,true);await shot('28-客服未解决冻结');
  });
  await runCase('未免确认授权提现需确认收款且失败仍只计一次',async()=>{
    await reset();await patch({identityVerified:true,balance:100,withdrawalOutcome:'failed'});await route('u-withdraw');await check('transferAuthorized',false);await action('withdraw-submit');let s=await state();assert.equal(s.withdrawal,'confirm');assert.equal(s.withdrawalCount,1);assert.equal(s.balance,0);await action('withdraw-confirm');assert.equal((await state()).withdrawal,'processing');await action('withdraw-query');s=await state();assert.equal(s.withdrawal,'failed');assert.equal(s.balance,100);assert.equal(s.withdrawalCount,1);await shot('29-提现逐笔确认路径');
  });
}
(async()=>{
  fs.mkdirSync(OUTPUT,{recursive:true});browser=await chromium.launch({headless:true,executablePath:EDGE});context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'zh-CN'});page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',error=>browserErrors.push({type:'pageerror',message:error.message}));page.on('console',message=>{if(message.type()==='error')browserErrors.push({type:'console',message:message.text(),location:message.location()});});page.on('response',response=>{if(response.status()>=400)result.failedResources.push({url:response.url(),status:response.status()});});
  if(process.env.TIANLI_V4_VERIFY_ONLY==='interaction'){await page.goto(new URL('app.html?screen=u-home&demo=1',BASE).href);await ready();result.catalog=await page.evaluate(()=>window.SCREENS.map(({id,role,title,state})=>({id,role,title,state})));}else await scanCatalog();
  if(process.env.TIANLI_V4_VERIFY_ONLY!=='render')await interactions();
  result.finishedAt=new Date().toISOString();result.summary={screens:result.catalog.length,renderChecks:result.renderChecks.length,issues:result.issues.length,casePass:result.interactionCases.filter(item=>item.pass).length,caseFail:result.interactionCases.filter(item=>!item.pass).length,stateAssertions:result.interactionChecks.length,browserErrors:browserErrors.length};
  if(browserErrors.length)result.issues.push(...browserErrors.map(error=>({type:'browser',...error})));
  result.summary.issues=result.issues.length;fs.writeFileSync(path.join(OUTPUT,'verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result.summary));console.log('REPORT '+path.join(OUTPUT,'verification.json'));await browser.close();if(result.issues.length)process.exitCode=1;
})().catch(async error=>{result.fatal={message:error.message,stack:error.stack};result.finishedAt=new Date().toISOString();fs.mkdirSync(OUTPUT,{recursive:true});fs.writeFileSync(path.join(OUTPUT,'verification.json'),JSON.stringify(result,null,2));console.error(error.stack);if(browser)await browser.close();process.exitCode=1;});
