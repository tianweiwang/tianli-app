import { resolveAccountActor, assertAccountCommand, canAccountCommand, canAccountView, STAFF_JOBS } from './staff-accounts.mjs';
import { workTaskView } from './work-tasks.mjs';
import { nativeTakeoverAvailability } from './work-native-takeover.mjs';
import { workTaskSummary } from './work-ui.mjs';
import { createTaskReturnContext, taskReturnTarget } from './task-navigation.mjs';
import { accountUiView, accountEntryLink, accountExitTarget, accountExitActions, accountWorkLoginProjection, accountEnterActor, accountSessionErrorView } from './accounts-ui.mjs';
import { privacyProfile, privacyUseClosed, assertPrivacyCommand } from './privacy.mjs';
import { assertClosedRightsDraft } from './privacy-closed-rights.mjs';
import { seed, reduce, money, upgradeGoods, upgradeFinanceState } from './engine.mjs';
import { customerView } from './customer.mjs';
import { staffView } from './staff.mjs';
import { bookingOptions, upgradeBookings } from './booking.mjs';
import { createBookingDraft, patchBookingDraft, bookingDraftPayload, repeatBookingDraft } from './booking-draft.mjs';
import { upgradeManagement, canManageView, assertJob, JOBS, technicianImportPreview } from './management.mjs';
import { saveMedia, readMedia, mediaMarkup, hydrateMedia, showMedia } from './media.mjs';
import { createAppUploadRuntime } from './app-upload.mjs';
import { createAppSessionRuntime } from './app-session.mjs';
import { createAppSessionScopes } from './app-session-scope.mjs';
import { createPrivacyCleanupStorage } from './privacy-cleanup-storage.mjs';
import { lifecycleFingerprint as sessionHash } from './organization-lifecycle-projection.mjs';
import { upgradeInvoices } from './service-invoices.mjs';
import { saveInvoiceFile, readInvoiceFile, hydrateInvoiceFiles, clearInvoiceFileUrls } from './invoice-files.mjs';
import { prepareServiceExtraEvidence } from './service-extra-file-validation.mjs';
import { prepareServicePromotionEvidence } from './service-promotion-file-validation.mjs';
import { prepareServiceFinanceCompositionEvidence } from './service-finance-composition-review.mjs';
import { prepareCareEvidence } from './care-file-validation.mjs';
import { saveCareUpload, parseCareFormEvidence } from './care-upload.mjs';
import { prepareQualificationEvidence } from './qualification-file-validation.mjs';
import { saveQualificationUpload, parseQualificationFormEvidence } from './qualification-upload.mjs';
import { qualityPolicyFormPayload, qualityPolicyScopeQuery, syncQualityPolicyForm } from './quality-policy-form.mjs';
const KEY = 'tianli-integrated-v5', ACTOR_KEY = KEY + '-actor';
const initialActor = { role: 'user', userId: 'u1', storeId: 'xingfu', techId: 'lin' };
let state, actor, pending = false, viewError = '', sensitiveResult = null;
let qualityDraftPending=0;
let activeTaskContext = null;
let transitionSource=null;
const preparedBookingDrafts=new Map();
const TASK_CONTEXT_PREFIX = KEY + '-task-return:';
async function clearTaskContext() {
  activeTaskContext = null;
  for (const key of Object.keys(sessionStorage).filter(k => k.startsWith(TASK_CONTEXT_PREFIX))) {try{await removeSession(key,sessionStorage.getItem(key));}catch{/* Unknown old task remains pending. */}}
  const next = { ...(history.state || {}) }; delete next.tianliTaskToken; history.replaceState(next, '');
}
function currentTaskContext() {
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(TASK_CONTEXT_PREFIX + history.state?.tianliTaskToken) || 'null'); } catch {}
  const context = [saved,activeTaskContext].find(c=>c && taskReturnTarget(state,actor,c,location.hash));
  if (!context) { activeTaskContext = null; return null; }
  activeTaskContext = context;
  history.replaceState({ ...(history.state || {}), tianliTaskToken: context.token }, '');
  return context;
}
const actorScope = () => [actor.accountId || '', actor.sessionId || '', actor.grantId || ''].join(':');
const canView = (a, path) => canAccountView(a, path) && (!a.sessionId || a.job !== 'account-admin' ? canManageView(a, path) : true);
const assertCommand = (a, command) => { if(!canAccountCommand(a,command))throw new Error('当前工作岗位无权执行此操作。'); if (!command.startsWith('account.')) assertJob(a, command); };
const draftKey = userId => KEY + '-booking-draft:' + userId;
const makeRequestId = userId => 'booking-' + userId + '-' + crypto.randomUUID();
let bookingPaymentResult = sessionStorage.getItem(KEY + '-booking-result') || 'success';
function getDraft(userId = actor.userId || initialActor.userId) {
  if(viewError)throw new Error(viewError);
  if(privacyUseClosed(state,userId))throw new Error('账号使用已关闭，新预约草稿不可创建；请从既有权益查询原记录。');
  const draft=preparedBookingDrafts.get(userId);if(!draft)throw Error('原预约草稿尚未完成读取，请稍后重试。');return draft;
}
async function prepareDraft(userId=actor.userId){
  const key=draftKey(userId),raw=sessionStorage.getItem(key);let saved=null;
  const cached=preparedBookingDrafts.get(userId);if(cached&&JSON.stringify(cached)===raw&&cached.privacyVersion===privacyProfile(state,userId).version)return cached;
  if(raw!==null){const restored=await appSession.restoreScoped([key]);saved=JSON.parse(restored.result[key]);if(!saved?.requestId)throw Error('原预约草稿损坏，原值保留待核。');}
  const draft=saved?{...createBookingDraft(state,userId,saved.requestId),...saved,userId}:createBookingDraft(state,userId,makeRequestId(userId));
  if((draft.privacyVersion??0)!==privacyProfile(state,userId).version){draft.privacyVersion=privacyProfile(state,userId).version;draft.identityConsent=false;draft.identityVerified=false;}
  if(raw!==JSON.stringify(draft))await saveDraft(draft,userId);else preparedBookingDrafts.set(userId,draft);return draft;
}
async function saveDraft(draft, userId = actor.userId) { if(viewError)throw new Error(viewError);await writeSession(draftKey(userId),JSON.stringify(draft));preparedBookingDrafts.set(userId,draft);return draft; }
async function updateDraft(patch, userId = actor.userId) { const draft = getDraft(userId); return saveDraft(patchBookingDraft(state, draft, patch, patch.restart ? makeRequestId(userId) : draft.requestId), userId); }
async function updateBookingField(field) {
  load();
  if(viewError){await render();toast(viewError,true);return;}
  if(privacyUseClosed(state,actor.userId)){await render();toast('账号使用已关闭，预约草稿不可更改。',true);return;}
  let draft;try{draft=await updateDraft({ [field.dataset.bookingField]: field.type === 'checkbox' ? field.checked : field.value });}catch(error){toast('预约草稿同步未完成，请保留内容后重试：'+error.message,true);return false;}
  // Editing the recipient or care text invalidates consent visibly as well as in storage.
  for (const input of document.querySelectorAll('input[type="checkbox"][data-booking-field]')) input.checked = !!draft[input.dataset.bookingField];
  return true;
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short', hour12: false }).format(new Date(value)) : '—';
const roles = { user: '用户端', tech: '技师端', manager: '店长端', store: '门店后台', group: '集团后台' };
function load() {
  try { const raw = localStorage.getItem(KEY); state = raw ? JSON.parse(raw) : seed(); if (state.schema !== 5) throw new Error('演示数据版本不兼容，请从演示设置重置。'); upgradeManagement(state); upgradeBookings(state); upgradeGoods(state); upgradeInvoices(state); upgradeFinanceState(state); viewError = ''; }
  catch (error) { viewError = '演示数据读取失败：' + error.message; state = seed(); }
}
try { actor = { ...initialActor, ...JSON.parse(sessionStorage.getItem(ACTOR_KEY) || '{}') }; } catch { actor = { ...initialActor }; }
load();
if (!viewError && localStorage.getItem(KEY)===null) localStorage.setItem(KEY, JSON.stringify(state));
const sessionScopes=createAppSessionScopes({key:KEY,currentContext:()=>({state:appSession.load(),actor,originScope:location.origin})});
const appSession=createAppSessionRuntime({key:KEY,storage:localStorage,sessionStorage,locks:navigator.locks,currentContext:()=>({actor,originScope:location.origin,viewError}),scopeForDraft:sessionScopes.scopeForDraft,
  listStoredRefs:library=>createPrivacyCleanupStorage({indexedDB,originScope:location.origin}).listStoredRefs(library),technicalTransition:context=>{if(!transitionSource)throw Error('原身份过渡来源缺失。');return transitionSource(context);}});
const currentSessionContext=()=>JSON.stringify(actor)+location.hash;
async function writeSession(key,value,producer){
  const original=currentSessionContext();if(producer)sessionScopes.produce(key,value,producer);
  return appSession.mutate('write',session=>{if(original!==currentSessionContext())throw Error('页面或身份已变化，原草稿保留。');session.setItem(key,value);},{planned:[{key,value:String(value)}]});
}
async function removeSession(key,expected){
  return appSession.mutate('remove',session=>{if(expected!==undefined&&session.getItem(key)!==expected)return false;session.removeItem(key);return true;});
}
async function recoverCompletedSessions(){
  for(const key of Object.keys(sessionStorage)){
    const value=sessionStorage.getItem(key);let known=false;try{known=sessionScopes.completion(key,value);}catch{}
    if(known)try{await removeSession(key,value);}catch{toast('业务已完成，原草稿同步待重试',true);}
  }
}
async function resetDemoSession(){
  await appSession.flush();
  const run=()=>{
    const original=localStorage.getItem(KEY);let previous;try{previous=JSON.parse(original);}catch{}
    const next=seed(),native=Object.keys(sessionStorage).map(key=>({key,value:sessionStorage.getItem(key)})),remove=[];
    for(const item of native){
      if(next.users.some(user=>item.key===draftKey(user.id)))try{const value=JSON.parse(item.value);if(item.key===draftKey(value.userId)&&typeof value.requestId==='string')remove.push(item);}catch{}
      else if(item.key.startsWith(TASK_CONTEXT_PREFIX))try{sessionScopes.scopeForDraft({state:previous,actor,key:item.key,value:item.value,operation:'technical-transition'});remove.push(item);}catch{}
    }
    if(previous?.schema===5){
      next.privacyUploadReservations=(previous.privacyUploadReservations||[]).map(row=>({...row,usable:false}));
      next.privacyUploadTabs=(previous.privacyUploadTabs||[]).map(row=>({...row,version:row.version+1,status:'pending',ackRevision:null,inheritedUnknown:true,operation:{kind:'demo-reset',status:'pending'},transitions:[...(row.transitions||[]),{version:row.version+1,status:'pending',at:next.now,code:'demo_reset'}]}));
      next.privacyUploadTabRevisions=previous.privacyUploadTabRevisions||[];
      next.privacyUploadProtocolSources=(previous.privacyUploadProtocolSources||[]).map(row=>({...row,status:'pending'}));
    }
    next.privacyUploadResetSources=[...(previous?.privacyUploadResetSources||[]),{id:crypto.randomUUID(),status:'pending',sourceDigest:sessionHash(original),keyDigests:native.map(item=>({keyDigest:sessionHash(item.key),valueDigest:sessionHash(item.value)})),at:next.now}];
    const raw=JSON.stringify(next);if(localStorage.getItem(KEY)!==original)throw Error('原演示账本已变化，请重新核对重置范围。');
    localStorage.setItem(KEY,raw);if(localStorage.getItem(KEY)!==raw)throw Error('演示重置账本回读未完成，原来源保留待核。');
    for(const item of remove){if(sessionStorage.getItem(item.key)!==item.value)throw Error('重置期间原草稿已变化；已完成部分保留待核。');sessionStorage.removeItem(item.key);}
    const actorValue=JSON.stringify(initialActor);sessionStorage.setItem(ACTOR_KEY,actorValue);
    for(let i=0;i<2;i++)if(sessionStorage.getItem(ACTOR_KEY)!==actorValue||remove.some(item=>sessionStorage.getItem(item.key)!==null)||localStorage.getItem(KEY)!==raw)throw Error('演示重置实际回读未完成；已完成部分保留待核。');
    preparedBookingDrafts.clear();restoredSessions.clear();actor={...initialActor};state=next;viewError='';if(history.state?.tianliTaskToken)history.replaceState({},'');
  };
  return appSession.reliable()?navigator.locks.request(KEY,run):run();
}
async function changeActor(target,path,kind='route-actor',originalSource){
  const raw={...actor},origin=currentSessionContext(),tasks=Object.keys(sessionStorage).filter(key=>key.startsWith(TASK_CONTEXT_PREFIX)).flatMap(key=>{const value=sessionStorage.getItem(key);try{sessionScopes.scopeForDraft({state:appSession.load(),actor:raw,key,value,operation:'technical-transition'});return[{key,valueDigest:sessionHash(value)}];}catch{return[];}});
  return appSession.enqueue(()=>appSession.withMutation(async cap=>{
    const verify=()=>{if(currentSessionContext()!==origin)throw Error('原身份或页面已变化，请重新进入。');const latest=cap.load();let actual=originalSource?.(latest)||{actor:target,path};
      if(!originalSource){if(raw.sessionId||raw.accountId||raw.grantId||target.sessionId||target.accountId||target.grantId)throw Error('工作身份不能通过演示切换重建。');try{resolveAccountActor(latest,target);}catch(error){const stores=latest.stores.filter(row=>row.id===target.storeId);if(!['store','manager'].includes(target.role)||stores.length!==1||!(stores[0].lifecycleStatus==='closed'||stores[0].closedAt!=null))throw error;}}
      const next={...initialActor,...actual.actor};return{kind,source:{kind:kind==='route-actor'?'demo-route':'staff-session',id:raw.sessionId||sessionHash(raw)},sourceToken:{raw,target:next,path:actual.path,stores:latest.stores.filter(row=>[raw.storeId,next.storeId].includes(row.id)),session:latest.staffSessions?.find(row=>row.id===(raw.sessionId||next.sessionId))},actorValue:JSON.stringify(next),path:actual.path,tasks,...(actual.login?{login:actual.login}:{})};};
    transitionSource=verify;try{const result=cap.coordinated?await cap.tabs.transition(kind):await cap.uncoordinated(session=>{const actual=verify();for(const task of tasks)if(sessionHash(session.getItem(task.key))===task.valueDigest)session.removeItem(task.key);session.setItem(ACTOR_KEY,actual.actorValue);return{actor:JSON.parse(actual.actorValue),path:actual.path};});actor=result.actor;sensitiveResult=null;activeTaskContext=null;const next={...(history.state||{})};delete next.tianliTaskToken;history.replaceState(next,'');return result;}finally{transitionSource=null;}
  }));
}
async function prepareRoute(){
  const url=new URL(location.hash.slice(1)||'/user/home',location.origin),requested=url.pathname.split('/').filter(Boolean)[0];
  if(roles[requested]&&requested!==actor.role&&!actor.sessionId&&!actor.accountId&&!actor.grantId)await changeActor({...actor,role:requested},url.pathname);
  else if(sessionStorage.getItem(ACTOR_KEY)!==JSON.stringify(actor)){try{resolveAccountActor(state,actor);await writeSession(ACTOR_KEY,JSON.stringify(actor));}catch{/* Original invalid-session screen remains available. */}}
}
const appUploads=createAppUploadRuntime({key:KEY,storage:localStorage,locks:navigator.locks,
  sessionRuntime:appSession,
  currentContext:()=>({actor,originScope:location.origin,route:location.hash,viewError}),
  saveFile:saveInvoiceFile,readFile:readInvoiceFile,saveImage:saveMedia,readImage:readMedia});
// Only original known public leaves are eligible. Old draft values and unknown
// inline sources stay untouched; upload coverage and cleanup remain pending.
if(!viewError){
  try{await appUploads.migratePublicInline();}catch{/* Preserve unknown migration sources; ordinary load below owns read-error UI. */}
  load();
}
const ui = {
  esc, money, date,
  nativeWorkTakeoverAvailability:task=>nativeTakeoverAvailability(state,actor,task),
  button: (label, command, payload = {}, cls = 'primary') => `<button type="button" class="${esc(cls)}" data-command="${esc(command)}" data-payload="${esc(JSON.stringify(payload))}">${esc(label)}</button>`,
  link: (label, path, cls = '') => `<a class="${esc(cls)}" href="#${path.startsWith('/') ? path : '/' + path}">${label}</a>`,
  field: (label, name, value = '', type = 'text', attrs = '') => `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(type)}" value="${esc(value)}" ${attrs}></label>`,
  select: (label, name, options, value) => `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}">${options.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>`,
  tag: (label, tone = '') => `<span class="tag ${esc(tone)}">${esc(label)}</span>`,
  empty: (label, detail = '') => `<section class="panel empty"><h2>${esc(label)}</h2><p>${esc(detail)}</p></section>`
};
function parsedRoute() {
  const url = new URL((location.hash.slice(1) || '/user/home'), location.origin);
  const parts = url.pathname.split('/').filter(Boolean);
  if (roles[parts[0]]) { const requestedRole = parts.shift(); if(requestedRole!==actor.role)return ['access-denied']; }
  ui.query = url.searchParams;
  return parts.length ? parts : [actor.role === 'user' ? 'home' : 'dashboard'];
}
const navs = {
  user: [['home', '首页', 'house'], ['bookings', '预约', 'calendar-days'], ['mall', '商城', 'shopping-bag'], ['me', '我的', 'user']],
  tech: [['dashboard', '工作台', 'layout-dashboard'], ['bookings', '我的预约', 'calendar-days'], ['schedule', '排班与请假', 'calendar-clock'], ['safety', '求助记录', 'shield-check']],
  manager: [['dashboard', '看板', 'layout-dashboard'], ['bookings', '预约安排', 'calendar-days'], ['schedule', '请假审批', 'users'], ['goods', '商品推广', 'shopping-bag'], ['bills', '佣金账单', 'receipt-text']],
  store: [['dashboard', '工作台', 'layout-dashboard'], ['bookings', '预约与派单', 'calendar-days'], ['schedule', '排班与请假', 'users'], ['safety', '客服与安全', 'shield-check'], ['goods', '推广订单', 'shopping-bag'], ['bills', '商品佣金', 'receipt-text'], ['recoveries', '佣金追回', 'landmark']],
  group: [['dashboard', '工作台', 'layout-dashboard'], ['bookings', '预约订单', 'calendar-days'], ['safety', '客服与安全', 'shield-check'], ['goods', '商品订单', 'package'], ['returns', '商品售后', 'rotate-ccw'], ['inventory', '商品库存', 'boxes'], ['bills', '门店结算', 'receipt-text'], ['recoveries', '佣金追回', 'landmark']]
};
navs.group.splice(5, 0, ['catalog', '商品管理', 'shopping-bag'], ['categories', '商品分类', 'list']);
navs.group.push(['services', '预约项目', 'list-checks'], ['stores', '门店资料', 'store'], ['technicians', '技师档案', 'users'], ['rules', '预约规则', 'settings'], ['management-log', '操作日志', 'history']);
navs.store.push(['services', '预约项目', 'list-checks'], ['stores', '本店资料', 'store'], ['technicians', '技师档案', 'users']);
for(const role of ['group','store']) navs[role].push(['service-promotion','服务推广','users']);
navs.store.splice(1, 0, ['operations', '经营待办', 'list-checks'], ['busy', '店内忙碌', 'calendar-clock']);
navs.group.splice(1, 0, ['operations', '预约待办', 'list-checks'], ['busy', '忙碌核实', 'calendar-clock']);
navs.store.splice(1, 0, ['tasks', '统一待办', 'list-checks']);
navs.group.splice(1, 0, ['tasks', '统一待办', 'list-checks']);
navs.group.push(['work-escalations','事项升级与接管','list-checks']);
navs.store.push(['work-escalations','事项升级与接管','list-checks']);
navs.group.push(['reports', '经营查询与报表', 'chart-no-axes-combined']);
navs.store.push(['reports', '经营查询与报表', 'chart-no-axes-combined']);
navs.store.push(['invoices', '服务发票', 'file-text']);
navs.group.push(['invoices', '服务发票', 'file-text'], ['accounts', '账号与权限', 'users'], ['privacy', '隐私办理', 'shield-check']);
navs.group.push(['commodity-invoices','商品发票','file-text'],['fee-invoices','集团服务费月票','file-text'],['commerce-invoice-rules','集团开票配置','settings']);
navs.group.push(['goods-logistics','商品物流规则','settings']);
navs.store.push(['fee-invoices','集团服务费月票','file-text']);
navs.group.push(['fulfilment','履约与安全离开','shield-check']);
navs.store.push(['fulfilment','履约与安全离开','shield-check']);
navs.tech.push(['fulfilment','内部履约记录','list-checks']);
navs.store.splice(4, 0, ['service-finance', '服务财务', 'landmark']);
navs.group.splice(4, 0, ['service-finance', '服务财务', 'landmark']);
navs.store.push(['qualifications', '服务准入', 'shield-check']);
navs.group.push(['qualifications', '服务准入', 'shield-check']);
navs.store.push(['care', '投诉与回访', 'messages-square'], ['reviews', '评价与申诉', 'star']);
navs.group.push(['care', '投诉与回访', 'messages-square'], ['reviews', '评价与申诉', 'star']);
navs.store.push(['penalties','一般警告与申诉','shield-check']);
navs.group.push(['penalties','一般警告与申诉','shield-check']);
navs.group.push(['quality-policies','质量规则','settings']);
function nav(route, cls) {
  const entries=actor.role==='user'&&privacyUseClosed(state,actor.userId)?[['rights','既有权益','receipt-text'],['privacy','关闭回执','shield-check']]:navs[actor.role];
  return `<nav class="${cls}" aria-label="${roles[actor.role]}导航">${entries.filter(([path]) => canView(actor, path)).map(([path, name, icon]) => `<a href="#/${actor.role}/${path}" ${route[0] === path ? 'aria-current="page"' : ''}><i data-lucide="${icon}"></i><span>${name}</span></a>`).join('')}</nav>`;
}
function settings() {
  return `<details class="demo-settings"><summary>演示设置</summary><div class="settings-body"><p>本地模拟 · 参数版本 ${esc(state.settings.version)}。商品名称与图片取自旧 Demo，价格、费率为演示样例。</p><dl class="kv-grid"><div><dt>来源有效期</dt><dd>24小时</dd></div><div><dt>佣金等待期</dt><dd>收货后7天</dd></div><div><dt>演示商品佣金</dt><dd>10% / 20%</dd></div><div><dt>配送与运费</dt><dd>江苏省 / ¥10.00</dd></div></dl><p class="muted">上述参数待业务定稿；会员储值、补贴、代理、检测和直播留待后续范围确认。</p><form data-command="clock.advance" class="clock-form">${ui.select('推进业务时间', 'minutes', [{ value: 10, label: '10分钟' }, { value: 30, label: '30分钟' }, { value: 60, label: '1小时' }, { value: 180, label: '3小时' }, { value: 1440, label: '1天' }, { value: 10080, label: '7天' }], 30)}<button class="secondary">推进时间</button></form>${ui.button('重置本版演示数据', 'ui.reset', {}, 'danger secondary')}<p class="small muted">重置只影响当前浏览器中的整合版。所有付款、退款和物流均为模拟。</p></div></details>`;
}
async function render() {
  clearInvoiceFileUrls();
  if(viewError){
    ui.bookingDraft=null;ui.sensitiveContact=null;sensitiveResult=null;
    document.getElementById('app').innerHTML=`<main class="desktop-surface"><section class="panel"><h1>演示数据暂时无法读取</h1><p class="notice warning" role="alert">${esc(viewError)}</p><p>当前存档与未提交草稿保留。请核对存档或恢复可读取的数据后刷新页面。</p></section></main>`;
    return;
  }
  try{await prepareRoute();}catch(error){toast(error.message,true);}
  let sessionError = '';
  let route,loginEntry=null;
  if(actor.sessionId){
    try { actor = resolveAccountActor(state, actor); } catch (error) { sessionError = error.message; }
    route=parsedRoute();
  } else {
    route=parsedRoute();
    try {const target=new URL(location.hash.slice(1)||'/user/home',location.origin);loginEntry=target.origin===location.origin&&target.pathname==='/store/work-login'?accountWorkLoginProjection(state,actor,route):null;if(!loginEntry)actor=resolveAccountActor(state,actor);}catch(error){sessionError=error.message;}
  }
  if (sessionError) { clearInvoiceFileUrls(); document.getElementById('app').innerHTML = `<section class="surface desktop-surface"><main>${accountSessionErrorView(state,actor,sessionError)}</main></section>`; return; }
  if(loginEntry){
    ui.bookingDraft=null;ui.sensitiveContact=null;sensitiveResult=null;
    document.getElementById('app').innerHTML=`<section class="surface desktop-surface"><main>${accountUiView(state,actor,route,ui)}</main></section>`;
    window.lucide?.createIcons();return;
  }
  await recoverCompletedSessions();
  const closedUser=actor.role==='user'&&privacyUseClosed(state,actor.userId);
  if(actor.role==='user'&&!closedUser){try{await prepareDraft();}catch(error){toast(error.message,true);ui.bookingDraft=null;return;}}
  if (actor.role === 'user' && !closedUser && route[0] === 'booking' && route.length === 1 && (ui.query.has('store') || ui.query.has('service') || ui.query.has('tech'))) {
    const patch = {};
    if (getDraft().submittedId) patch.restart = true;
    if (ui.query.has('store')) patch.storeId = ui.query.get('store');
    if (ui.query.has('service')) patch.serviceId = ui.query.get('service');
    if (ui.query.has('tech')) { patch.techId = ui.query.get('tech'); patch.mode = 'specified'; }
    await updateDraft(patch);
    history.replaceState(null, '', location.pathname + '#/user/booking/' + (patch.techId ? 'slots' : 'service'));
    route = parsedRoute();
  }
  if(closedUser&&sessionStorage.getItem(draftKey(actor.userId))!==null)try{await removeSession(draftKey(actor.userId));preparedBookingDrafts.delete(actor.userId);}catch{/* Keep unverified original draft pending. */}
  ui.bookingDraft=actor.role==='user'&&!closedUser?getDraft():null;
  ui.sensitiveContact = sensitiveResult?.context === JSON.stringify(actor) + location.hash ? sensitiveResult.value : null;
  const mobile = ['user', 'tech', 'manager'].includes(actor.role);
  const user = state.users.find(u => u.id === actor.userId), store = state.stores.find(x => x.id === actor.storeId), tech = state.techs.find(x => x.id === actor.techId);
  const identity = actor.sessionId ? `${actor.accountName} · ${STAFF_JOBS[actor.job]?.label || actor.job}` : actor.role === 'user' ? user?.name : actor.role === 'tech' ? tech?.name : actor.role === 'group' ? '集团运营 / 仓储 / 财务' : store?.name;
  let content;
  try { content = route[0] === 'work-login' ? accountUiView(state, actor, route, ui) : route[0] === 'access-denied' ? ui.empty('当前工作授权无权切换此身份', '请使用已授权菜单，或退出工作会话后进入自由演示。') : actor.role === 'user' ? customerView(state, actor, route, ui) : staffView(state, actor, route, ui); }
  catch (error) { console.error(error); content = ui.empty('页面暂时无法显示', error.message); }
  if (['dashboard','home'].includes(route[0]) && canView(actor,'tasks')) content = workTaskSummary(state, actor, ui) + content;
  const taskContext = currentTaskContext();
  if (taskContext) content = `<section class="panel"><div class="actions">${ui.button('返回待办列表','ui.task-return',{},'secondary')}</div><p class="small muted">办理完成后可返回原筛选列表查看进度。</p></section>` + content;
  document.getElementById('app').innerHTML = mediaMarkup(`<header class="demo-bar"><a href="#/${actor.sessionId ? actor.role + '/dashboard' : 'user/home'}" class="brand"><span class="brand-mark">天</span><strong>天俪</strong><span>整合演示 v0.5</span></a><div class="role-tabs" aria-label="切换演示身份">${Object.entries(actor.sessionId ? {} : roles).map(([role, title]) => `<button data-role="${role}" class="${role === actor.role ? 'selected' : ''}">${title}</button>`).join('')}</div>${accountEntryLink(actor)}<a href="#/${actor.role}/guide" class="guide-link">演示说明</a></header><div class="context-bar"><label>${actor.role === 'user' ? '当前用户 <select data-identity="userId">' + state.users.map(u => `<option value="${u.id}" ${u.id === actor.userId ? 'selected' : ''}>${esc(u.name)}</option>`).join('') + '</select>' : actor.role === 'tech' ? '当前技师 <select data-identity="techId">' + state.techs.map(t => `<option value="${t.id}" ${t.id === actor.techId ? 'selected' : ''}>${esc(t.name)} · ${esc(state.stores.find(x => x.id === t.storeId)?.name)}</option>`).join('') + '</select>' : ['store', 'manager'].includes(actor.role) ? '当前门店 <select data-identity="storeId">' + state.stores.map(t => `<option value="${t.id}" ${t.id === actor.storeId ? 'selected' : ''}>${esc(t.name)}</option>`).join('') + '</select>' : '集团统一经营'}</label><time>${date(state.now)}</time>${settings()}</div>${viewError ? `<div class="global-error" role="alert">${esc(viewError)}</div>` : ''}<div class="workspace ${mobile ? 'mobile-workspace' : 'desktop-workspace'}">${mobile ? '' : `<aside class="sidebar"><p class="sidebar-title">${roles[actor.role]}</p>${nav(route, 'side-nav')}</aside>`}<section class="surface ${mobile ? 'phone-surface' : 'desktop-surface'}"><header class="surface-bar"><span>${esc(identity)}</span><span class="status-dot">${actor.role === 'user' ? '天俪预约与商城' : roles[actor.role]}</span></header><main>${route[0] === 'guide' ? guide() : content}</main>${mobile ? nav(route, 'mobile-nav') : ''}</section>${mobile ? `<aside class="review-note"><span class="eyebrow">本轮演示</span><h2>同一笔订单<br>各端连续处理</h2><p>先从用户端创建订单，再切换工作角色。各端读取相同业务记录，刷新后继续。</p><ol><li>通过门店推荐入口选购</li><li>预约另一家门店的项目</li><li>集团发货，用户确认收货</li><li>门店核对佣金，集团付款</li></ol><p class="small">演示工具位于页面顶部；支付、物流结果在对应订单内操作。</p></aside>` : ''}</div>`);
  if(closedUser)document.querySelector('.demo-settings')?.remove();
  else document.querySelector('.settings-body')?.insertAdjacentHTML('beforeend', `<label class="field"><span>预约支付演示结果</span><select data-booking-result aria-label="预约支付演示结果">${[{value:'success',label:'支付成功'},{value:'failed',label:'支付失败'},{value:'processing',label:'结果确认中'}].map(option => `<option value="${option.value}" ${bookingPaymentResult === option.value ? 'selected' : ''}>${option.label}</option>`).join('')}</select></label><p class="small muted">从确认页正常付款；此处仅控制本地演示结果，不连接支付渠道。</p>`);
  window.lucide?.createIcons();
  if (actor.sessionId) {
    document.querySelector('.context-bar>label').innerHTML = `<span>岗位演示：${esc(actor.accountName)} · ${esc(STAFF_JOBS[actor.job]?.label || STAFF_JOBS[actor.job]?.name || actor.job)}${actor.storeId ? ' · '+esc(state.stores.find(x=>x.id===actor.storeId)?.name || actor.storeId) : ''}</span>`;
    document.querySelector('.demo-settings')?.remove();
    document.querySelector('.role-tabs')?.remove();
  } else if (actor.role === 'group') {
    const context = document.querySelector('.context-bar>label');
    context.innerHTML = `演示岗位 <select class="management-job" data-identity="job" aria-label="集团演示岗位">${Object.entries(JOBS).map(([value,label])=>`<option value="${value}" ${(actor.job || 'all') === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`;
  }
  document.querySelectorAll('main [data-command]').forEach(node => { if (node.dataset.command.startsWith('ui.')) return; try { assertCommand(actor, node.dataset.command); } catch { node.remove(); } });
  await restoreManagementDrafts();
  document.querySelectorAll('form[data-command="quality.policy-publish"]').forEach(syncQualityPolicyForm);
  refreshInvoiceForms();
  document.querySelectorAll('[data-care-upload-region]').forEach(region=>refreshCareUploadForm(region.closest('form')));
  document.querySelectorAll('[data-qualification-upload]').forEach(input=>refreshEvidenceUploadForm(input.closest('form'),'qualification'));
  hydrateMedia();
  const fileContext = JSON.stringify(actor) + location.hash;
  hydrateInvoiceFiles(state, actor, document, () => { try { return fileContext === JSON.stringify(actor) + location.hash && JSON.stringify(resolveAccountActor(state, actor)) === JSON.stringify(actor); } catch { return false; } },()=>({state,actor}));
}
function refreshInvoiceForms() {
  document.querySelectorAll('form[data-command^="invoice."],form[data-command^="commerce-invoice."]').forEach(form => {
    const kind = form.elements.namedItem('kind'), taxId = form.elements.namedItem('taxId');
    if (kind && taxId) { taxId.required = kind.value === 'company'; taxId.disabled = kind.value !== 'company'; }
    const note = form.querySelector('[data-invoice-upload-status]');
    if (note && form.elements.namedItem('fileName')?.value) note.textContent = '已选择：' + form.elements.namedItem('fileName').value;
  });
}
function managementKey(form) { return KEY + '-management:' + [actorScope(), actor.role, actor.job || '', actor.storeId || '', form.dataset.managementForm].join(':'); }
async function promotionRequest(form,payload){
  const key=KEY+'-request:'+JSON.stringify([actorScope(),form.dataset.command,payload.id||'',payload.promoterId||'',payload.personKind||'',payload.personId||'',payload.promoterType||'',payload.version??0,payload.balanceToken||'',payload.sourceToken||'',payload.action||'',payload.outcome||'',payload.decision||'',payload.status||'']);
  await prepareRequest(form,payload,key);
  return payload;
}
function uploadPayload(form){
  const payload={...JSON.parse(form.dataset.payload||'{}'),...Object.fromEntries(new FormData(form))};
  if(form.dataset.command==='service-promotion.agreement-publish'){
    if(!payload.requestId)throw Error('原协议请求编号尚未准备，请稍后重试。');
  }
  return payload;
}
async function prepareUploadPayload(form){
  if(form.dataset.command==='service-promotion.agreement-publish') {const payload={...JSON.parse(form.dataset.payload||'{}'),...Object.fromEntries(new FormData(form))};await promotionRequest(form,payload);const base=JSON.parse(form.dataset.payload||'{}');base.requestId=payload.requestId;form.dataset.payload=JSON.stringify(base);}
  return uploadPayload(form);
}
async function saveFormUpload(form,file,field){
  const key=managementKey(form);
  uploadPayload(form);
  const currentGeneration=()=>field==='file'?form.dataset.invoiceGeneration:field==='evidenceRefs'?form.dataset.careGeneration||form.dataset.qualificationGeneration:form.elements.namedItem(field)?.dataset.imageGeneration;
  const generation=currentGeneration();
  return appUploads.save(form,file,{command:form.dataset.command,field,formKey:key,payload:()=>uploadPayload(form),active:operation=>form.isConnected&&managementKey(form)===key&&(['attach','cancel'].includes(operation)||currentGeneration()===generation)});
}
function uploadDraftMetadata(form){
  const current=appUploads.metadata(form);
  // Old-instance entries remain evidence, never input to runtime capabilities.
  return [...(form._priorUploadSelections||[]),...current];
}
function assertUploadDraftReady(form,payload){
  const selected=appUploads.metadata(form).filter(item=>!item.released&&item.published);
  const has=(ref,field)=>selected.some(item=>item.ref===ref&&item.field===field&&['saved','attached'].includes(item.status));
  if(payload.file&&!has(payload.file.ref,'file'))throw new Error('该附件来自旧草稿或未核验选择，请保留原资料并重新选择附件。');
  const evidenceField=['finance.composition-confirm','finance.composition-reconcile'].includes(form.dataset.command)?'file':'evidenceRefs';
  if(Array.isArray(payload.evidenceRefs)&&payload.evidenceRefs.some(file=>!has(file.ref,evidenceField)))throw new Error('凭证选择尚未在本页完整核验，请重新选择；旧文件仍保留待核。');
  if(form.dataset.command==='manage.product-save'){
    const original=state.products.find(row=>row.id===payload.id);
    for(const [field,value] of [['image',payload.image],...(form._submittedGalleryFields||[]).map((value,i)=>['gallery'+i,value])]){
      const existing=field==='image'?original?.image:original?.gallery?.[Number(field.slice(7))];
      if(typeof value==='string'&&/^(media:|data:image\/)/.test(value)&&value!==existing&&!has(value,field))throw new Error('该图片来自旧草稿或未核验选择，请从当前商品重新选择。');
    }
  }
}
function refreshCareUploadForm(form) { refreshEvidenceUploadForm(form,'care'); }
function refreshEvidenceUploadForm(form,domain) {
  const input=form?.elements.namedItem('evidenceRefs'),list=form?.querySelector(`[data-${domain}-selected-files]`),note=form?.querySelector(`[data-${domain}-upload-status]`),clear=form?.querySelector(`[data-${domain}-clear]`);
  if(!input||!list)return;
  try{
    const files=(domain==='care'?parseCareFormEvidence:parseQualificationFormEvidence)(input.value);
    list.innerHTML=files.map(file=>`<li>${esc(file.name)} · ${esc((file.size/1024).toFixed(1))} KiB</li>`).join('');
    if(note)note.textContent=files.length?(domain==='care'?`本次已选择${files.length}张图片，提交后保存在原案件。`:`本次已选择${files.length}份凭证，提交后保存在原资格记录。`):(domain==='care'?'PNG / JPEG，每张最大5 MiB。案件与全部补充合计最多6张。':'PDF / PNG / JPEG，每份最大5 MiB。附件可选，文字依据仍须填写。');
    if(clear)clear.disabled=!files.length||Number(form.dataset.invoicePending||0)>0;
  }catch(error){if(note)note.textContent=error.message;if(clear)clear.disabled=false;}
}
async function rememberManagement(form, key = managementKey(form)) {
  if(form.dataset.command==='account.enter')return;
  if(actor.role==='user'){
    load();if(viewError)return;
    if(privacyUseClosed(state,actor.userId)){
      try{
        const payload={...JSON.parse(form.dataset.payload||'{}'),...Object.fromEntries(new FormData(form))};
        if(form.dataset.command==='booking.refund-request')payload.requests=[...form.querySelectorAll('[name]')].filter(field=>field.name.startsWith('refundAmount:')).map(field=>({paymentId:field.name.slice(13)}));
        if(!assertClosedRightsDraft(state,resolveAccountActor(state,actor),form.dataset.command,payload))return;
      }
      catch{return;}
    }
  }
  const values = [...form.querySelectorAll('[name]')].filter(x => x.type !== 'file').map(x => ({ name: x.name, value: x.value, checked: x.checked, type: x.type, ...(x.tagName==='SELECT'&&x.hasAttribute('multiple')?{selectedValues:[...x.selectedOptions].map(option=>option.value)}:{}) }));
  const payload={...JSON.parse(form.dataset.payload||'{}'),...Object.fromEntries(values.map(field=>[field.name,field.value]))};
  const quality=['quality.policy-publish','quality.policy-withdraw'].includes(form.dataset.command),generation=quality?(form._qualityDraftGeneration=(form._qualityDraftGeneration||0)+1):null;
  const note=quality?form.querySelector('.management-draft-note'):null;
  if(quality){qualityDraftPending++;if(note){note.textContent='正在保存草稿，请稍候…';note.classList.remove?.('warning');}}
  try {
    await writeSession(key,JSON.stringify({ values, payload: form.dataset.payload, uploadSelections:uploadDraftMetadata(form) }),{kind:'management-draft',command:form.dataset.command,formId:form.dataset.managementForm,payload});
    if(note&&form.isConnected&&generation===form._qualityDraftGeneration){note.textContent='草稿已保存，刷新后可继续填写。';note.classList.toggle('warning',false);}
    return true;
  }
  catch(error) {if(note&&form.isConnected&&generation===form._qualityDraftGeneration){note.textContent='草稿尚未保存，请保留当前内容后重试。';note.classList.toggle('warning',true);}toast('草稿同步未完成，原内容保留：'+error.message, true);return false;}
  finally {if(quality)qualityDraftPending--;}
}
const restoredSessions=new Map();
async function restoreManagementDrafts() {
  for(const form of document.querySelectorAll('[data-management-form]')) {
    if(form.dataset.command==='account.enter')continue;
    try {
      const key=managementKey(form),raw=sessionStorage.getItem(key);if(raw===null)continue;
      const draft=JSON.parse(raw),prior=JSON.parse(draft.payload||'{}'),current=JSON.parse(form.dataset.payload||'{}');
      for(const name of ['id','bookingId','techId','storeId','productId','accountId','grantId','caseId'])if(current[name]!=null&&current[name]!==prior[name])throw Error('旧草稿不是当前原表单来源。');
      const payload={...prior,...Object.fromEntries(draft.values.map(field=>[field.name,field.value]))};sessionScopes.produce(key,raw,{kind:'management-draft',command:form.dataset.command,formId:form.dataset.managementForm,payload});
      const scope=sessionScopes.scopeForDraft({state:appSession.load(),actor,key,value:raw}),token=sessionHash({scope,actor,raw});
      let restored=restoredSessions.get(key);if(restored?.token!==token){const proof=await appSession.restoreScoped([key]);restored={token,receipt:proof.receipt};restoredSessions.set(key,restored);}
      form._priorUploadSelections=Array.isArray(draft.uploadSelections)?draft.uploadSelections:[];
      draft.values.forEach(x => {
        const fields = [...form.querySelectorAll('[name]')].filter(f => f.name === x.name),field = x.type === 'checkbox' ? fields.find(f => f.value === x.value) : fields[0];
        if (!field) return;
        if(field.tagName==='SELECT'&&field.hasAttribute('multiple')&&Array.isArray(x.selectedValues)) {
          const options=[...field.querySelectorAll('option')];
          if(x.selectedValues.some(value=>typeof value!=='string'||!options.some(option=>option.value===value))||new Set(x.selectedValues).size!==x.selectedValues.length)throw Error('多选草稿的选项已变化，请重新核对。');
          for(const option of options)option.selected=x.selectedValues.includes(option.value);
        } else field.value=x.value;
        if(x.type==='checkbox')field.checked=x.checked;
      });
      form.dataset.payload = draft.payload;
      if(appUploads.rebind(form,{formKey:key,payload:()=>uploadPayload(form),active:()=>form.isConnected&&managementKey(form)===key},form._priorUploadSelections)){
        const restored=appUploads.metadata(form);form._priorUploadSelections=form._priorUploadSelections.filter(item=>!restored.some(current=>current.id===item.id&&current.instanceId===item.instanceId));
      }
      else if(form._priorUploadSelections.some(item=>item.published&&!item.released)){
        try{await appUploads.resume(form,{command:form.dataset.command,formKey:key,payload:()=>uploadPayload(form),active:()=>form.isConnected&&managementKey(form)===key},form._priorUploadSelections,restored.receipt);const current=appUploads.metadata(form);form._priorUploadSelections=form._priorUploadSelections.filter(item=>!current.some(now=>now.id===item.id));await rememberManagement(form,key);}catch(error){form._uploadRestoreError=error.message;}
      }
      const escalation=form.dataset.command.startsWith('work-escalation.');
      const quality=['quality.policy-publish','quality.policy-withdraw'].includes(form.dataset.command);
      const priorLive=quality?prior.sourceToken:escalation?[prior.version,prior.sourceToken,prior.ownerToken,prior.assignmentVersion].join(':'):prior.version;
      const stale = (quality?prior.sourceToken:prior.version) != null && String(priorLive) !== form.dataset.liveVersion;
      const note = form.querySelector('.management-draft-note');if(note){ note.textContent = form._uploadRestoreError|| (stale ? quality?'规则版本已变化，请保留草稿内容，重新打开当前版本核对。':escalation?'原事项或责任已变化；当前保留的是旧草稿。请记录差异，放弃本页草稿后按最新版重新核对。':`资料已更新至v${form.dataset.liveVersion}；当前保留的是v${prior.version}草稿。请记录差异，放弃本页草稿后按最新版重新编辑。` : '已恢复本标签页的未保存内容。'); note.classList.toggle('warning', stale||!!form._uploadRestoreError);}
      form.querySelectorAll('[data-image-preview]').forEach(img => showMedia(img, form.elements.namedItem(img.dataset.imagePreview)?.value));
    } catch { toast('管理草稿无法恢复，可使用“放弃本页草稿”后重新填写。', true); }
  }
}
async function prepareRequest(form,payload,key,prefix=''){
  payload.requestId=sessionStorage.getItem(key)||prefix+crypto.randomUUID();form.dataset.businessRequestKey=key;
  if(form.dataset.command==='account.enter'){
    const target=new URL(location.hash.slice(1),location.origin),raw={...actor};let special=false;
    try{special=!!accountWorkLoginProjection(appSession.load(),raw,target.pathname==='/store/work-login'?['work-login']:[]);}catch{}
    if(special){await appSession.enqueue(()=>appSession.withMutation(async cap=>{
      const source=()=>{const latest=cap.load();if(JSON.stringify(actor)!==JSON.stringify(raw)||target.pathname!==new URL(location.hash.slice(1),location.origin).pathname)throw Error('原岗位登录来源已变化。');accountEnterActor(latest,raw,target.pathname,payload);const account=latest.staffAccounts.find(row=>row.id===payload.accountId);return{kind:'account-entry-draft',source:{kind:'staff-account',id:account.id},sourceToken:{account,store:latest.stores.find(row=>row.id===raw.storeId)},actorValue:JSON.stringify(raw),path:target.pathname,tasks:[],login:{accountId:payload.accountId,grantId:payload.grantId,requestId:payload.requestId}};};
      transitionSource=source;try{if(cap.coordinated)await cap.tabs.transition('account-entry-draft');else await cap.uncoordinated(s=>{source();s.setItem(key,payload.requestId);});}finally{transitionSource=null;}
    }));return payload;}
  }
  await writeSession(key,payload.requestId,{kind:'request-key',command:form.dataset.command,formId:form.dataset.managementForm,payload});return payload;
}
function guide() {
  return `<header class="page-head"><h1>连续演示说明</h1></header><section class="panel"><h2>预约与商品各走一条账</h2><p>预约收款归实际服务门店。商品由集团销售发货，推荐门店获得商品佣金。两者互不改变归属。</p><ol class="guide-steps"><li>用户进入商城，可从首页的门店推荐入口建立来源；两款商品各一件加运费，样例实付310元。</li><li>另选一家服务门店创建预约、付款。切技师确认或店长派单，再到预约时间开始、满时长完成。</li><li>回购物车确认推广来源与收货地址，提交订单并支付。</li><li>集团后台打开同一商品订单，填写物流发货。用户在本人订单确认收货。</li><li>演示设置推进7天。集团生成门店账单，切对应门店核对，集团发起付款并查询结果。</li><li>用户申请部分退货，集团受理、用户寄回、集团验收并退款。若佣金已付，会生成门店追回记录。</li></ol></section><section class="panel"><h2>首阶段边界</h2><p>五视图使用当前浏览器的同一份本地业务数据。真实登录权限、支付、物流、微信接入尚未实施；数据不跨设备。</p><p>会员、积分、补贴、代理、检测、直播尚未纳入。预约地点、取消争议依据和服务首单政策仍待确认；这里的流程演示不能替代正式业务验收。</p></section>`;
}
function toast(message, error = false) { const node = document.getElementById('toast'); node.textContent = message; node.className = 'visible' + (error ? ' error' : ''); clearTimeout(toast.timer); toast.timer = setTimeout(() => node.className = '', 4500); }
function qualityConfirmationSummary(form, payload) {
  const lines = [];
  if (payload.scope) {
    const names = (ids, rows) => ids === null ? '全部' : ids.map(id => rows.find(row => row.id === id)?.name || rows.find(row => row.id === id)?.title || id).join('、');
    lines.push('规则范围：' + (payload.scope.subject === 'tech' ? '技师' : '用户') + '；门店：' + names(payload.scope.storeIds, state.stores || []) + '；服务项目：' + names(payload.scope.serviceIds, state.services || []));
    lines.push('当前版本：' + payload.expectedVersion);
    lines.push('新版本完整规则：' + payload.rules.map(rule => rule.id).join('、'));
  }
  for (const field of form.querySelectorAll('input:not([type=hidden]):not([type=file]),select')) {
    if (!field.name || field.disabled || field.type === 'checkbox' && !field.checked) continue;
    const label = field.closest('.field')?.querySelector('span')?.textContent.trim() || field.name;
    if (field.type === 'checkbox') lines.push('成立依据：' + label);
    else lines.push(label + '：' + (field.tagName === 'SELECT' ? [...field.selectedOptions].map(option => option.textContent.trim()).join('、') : field.value));
  }
  return lines.join('\n');
}
function confirmManagement(message, title = '核对经营变更') {
  return new Promise(resolve => {
    const overlay = document.createElement('div'); overlay.className = 'management-confirm-backdrop';
    overlay.innerHTML = `<section class="management-confirm" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2><p>${esc(message).replace(/\n/g, '<br>')}</p><div class="actions"><button type="button" class="secondary" data-confirm-choice="cancel">返回修改</button><button type="button" class="primary" data-confirm-choice="accept">确认提交</button></div></section>`;
    document.body.append(overlay); const focus = document.activeElement;
    const close = accepted => { overlay.remove(); focus?.focus(); resolve(accepted); };
    overlay.addEventListener('click', event => { const button = event.target.closest('[data-confirm-choice]'); if (button) close(button.dataset.confirmChoice === 'accept'); });
    overlay.addEventListener('keydown', event => { if (event.key === 'Escape') close(false); if(event.key === 'Tab'){const buttons=overlay.querySelectorAll('button');if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons[1].focus();}else if(!event.shiftKey&&document.activeElement===buttons[1]){event.preventDefault();buttons[0].focus();}} });
    overlay.querySelector('button').focus();
  });
}
function yuan(value) { if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw new Error('金额最多填写两位小数。'); const [a, b = ''] = String(value).split('.'); const cents = Number(a) * 100 + Number(b.padEnd(2, '0')); if (!Number.isSafeInteger(cents)) throw new Error('金额过大。'); return cents; }
async function execute(type, payload, element) {
  if (pending) return;
  await appSession.flush();
  if(actor.role==='user'&&type.startsWith('ui.')){load();if(viewError){await render();toast(viewError,true);return;}}
  if(actor.role==='user'&&privacyUseClosed(state,actor.userId)&&type.startsWith('ui.')&&!['ui.account-exit','ui.filter','ui.management-discard'].includes(type)) {
    toast('账号使用已关闭，请从既有权益进入原记录办理。',true);return;
  }
  if (type === 'ui.account-exit') {
    const session = { ...actor }; pending = true;
    try {
      const leave = () => {
        load(); if (viewError) throw new Error(viewError);
        // Revoked sessions may leave locally without rewriting account data.
        try { resolveAccountActor(state, session); } catch { return; }
        const next = reduce(state, session, 'account.leave');
        localStorage.setItem(KEY, JSON.stringify(next)); state = next;
      };
      if (navigator.locks) await navigator.locks.request(KEY, leave); else leave();
      const target=await changeActor(null,null,'account-exit',latest=>accountExitTarget(latest,session,payload?.destination));location.hash=target.path;await render();
    } catch (error) { toast(error.message, true); } finally { pending = false; }
    return;
  }
  if (actor.sessionId) { try { load(); actor = resolveAccountActor(state, actor); if (type.startsWith('ui.') && !['ui.filter', 'ui.management-discard','ui.task-open','ui.task-return'].includes(type)) throw new Error('工作账号不能使用自由演示身份工具。'); } catch (error) { await render(); toast(error.message, true); return; } }
  if (type === 'ui.task-open' || type === 'ui.task-return') {
    try {
      load(); if(viewError) throw new Error(viewError);
      actor = resolveAccountActor(state, actor);
      if(type === 'ui.task-open') {
        const task = workTaskView(state, actor).tasks.find(t=>t.id===payload.taskKey);
        if(!task) throw new Error('事项已变化或不在当前授权范围内，请刷新列表。');
        const context = createTaskReturnContext(state, actor, {taskKey:task.id,listHash:location.hash,task,token:crypto.randomUUID()});
        await writeSession(TASK_CONTEXT_PREFIX + context.token, JSON.stringify(context));
        activeTaskContext = context; location.hash = task.route;
      } else {
        const context = currentTaskContext(), target = taskReturnTarget(state,actor,context,location.hash);
        if(!target) throw new Error('返回上下文已失效，请从当前后台重新进入统一待办。');
        activeTaskContext = null; location.hash = target;
      }
      await render();
    } catch(error) {await render();toast(error.message,true);}
    return;
  }
  if (type === 'ui.booking-repeat') {
    const repeatActor = { ...actor }, repeatRoute = location.hash, current = JSON.stringify(getDraft());
    try {
      if (actor.role !== 'user') throw new Error('仅预约人可再次预约。');
      const existing = getDraft();
      if (!existing.submittedId && (existing.startAt || existing.techId || existing.healthConsent) && !await confirmManagement('当前还有未提交的预约草稿。继续后将替换为这笔历史预约的门店和项目，重新选择时间并核对信息。', '确认再次预约')) return;
      if (location.hash !== repeatRoute || actor.role !== repeatActor.role || actor.userId !== repeatActor.userId || JSON.stringify(getDraft()) !== current) throw new Error('预约草稿或当前身份已改变，请重新操作。');
      load(); if (viewError) throw new Error(viewError);
      const repeat = repeatBookingDraft(state, actor.userId, payload.id, makeRequestId(actor.userId));
      await saveDraft(repeat.draft); location.hash = repeat.next; await render(); toast(repeat.message);
    } catch (error) { toast(error.message, true); }
    return;
  }
  if (type === 'ui.management-discard') {
    const form = element.closest('[data-management-form]'); if (!form) return;
    const key = managementKey(form), origin = JSON.stringify(actor) + location.hash, saved = sessionStorage.getItem(key);
    if (!await confirmManagement('放弃此表单尚未保存的内容，并重新加载最新资料？')) return;
    if (!form.isConnected || origin !== JSON.stringify(actor) + location.hash || saved !== sessionStorage.getItem(key)) { toast('页面、身份或草稿已变化，未清除原草稿，请在当前页面重新操作。', true); return; }
    try{await appUploads.release(form,null,'abandon-draft');}catch(error){await rememberManagement(form,key);toast(error.message,true);return;}
    await removeSession(key,saved); await render(); return;
  }
  if (type === 'ui.tech-import-preview') {
    const form=element.closest('form'), fields=Object.fromEntries(new FormData(form)), preview=technicianImportPreview(state,fields.storeId,fields.content);
    form.querySelector('[data-import-preview]').innerHTML=preview.errors.length?`<p class="notice warning">${preview.errors.map(esc).join('<br>')}</p>`:`<p class="notice success">校验通过：${preview.rows.length}位技师，导入后均为待审核。</p><div class="table-wrap"><table><thead><tr><th>行</th><th>姓名</th><th>手机号</th><th>项目</th></tr></thead><tbody>${preview.rows.map(r=>`<tr><td>${r.line}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td>${r.serviceIds.map(esc).join('、')}</td></tr>`).join('')}</tbody></table></div>`; return;
  }
  if (type === 'ui.booking') {
    await updateDraft({ ...payload, ...payload.patch });
    if (payload.next && location.hash !== '#' + payload.next) location.hash = payload.next;
    else await render();
    return;
  }
  if (type === 'ui.filter') { const path = payload.path || `/${actor.role}/mall`; delete payload.path; if(path===`/${actor.role}/reports`&&payload.previousType!=null){if(payload.previousType!==payload.type)delete payload.status;delete payload.previousType;} const q = new URLSearchParams(Object.entries(payload).filter(([, v]) => v !== '')); location.hash = path + (q.size ? '?' + q : ''); return; }
  if (type === 'ui.reset') {
    if (!window.confirm('重置整合版的本地订单、购物车和账单？旧版本不受影响。')) return;
    try{await resetDemoSession();location.hash='/user/home';await render();toast('整合版演示数据已重置，旧附件来源仍保留待核');}catch(error){toast(error.message,true);}return;
  }
  if (/^(account\.|privacy\.|sensitive\.|work\.|work-escalation\.|report\.|fulfilment\.|commerce-invoice\.|goods-logistics\.|service-extra\.|bill\.(dispute-lines|split|offset-))/.test(type) && !payload.requestId) payload.requestId = element?.dataset.requestId || crypto.randomUUID();
  if (/^(account\.|privacy\.|sensitive\.|work\.|work-escalation\.|report\.|fulfilment\.|commerce-invoice\.|goods-logistics\.|service-extra\.|bill\.(dispute-lines|split|offset-))/.test(type) && element) element.dataset.requestId = payload.requestId;
  const submitBooking = type === 'ui.booking-submit', payBooking = type === 'ui.booking-pay', queryBooking = type === 'ui.booking-query';
  const paymentOutcome = bookingPaymentResult;
  const expectation = { techId: payload.expectedTechId, priceCents: payload.expectedPriceCents };
  let submittedDraft, submittedDraftStored;
  try {
    if (submitBooking) { submittedDraft = getDraft(); submittedDraftStored = sessionStorage.getItem(draftKey(actor.userId)); payload = bookingDraftPayload(submittedDraft); type = 'booking.create'; }
    if (payBooking || queryBooking) { payload = { id: payload.id, outcome: queryBooking && paymentOutcome === 'processing' ? 'success' : paymentOutcome }; type = queryBooking ? 'booking.payment-query' : 'booking.pay'; }
  } catch (error) { toast(error.message, true); return; }
  pending = true;
  const managementDraftKey = element?.matches?.('[data-management-form]') ? managementKey(element) : null;
  const submittedManagementDraft = managementDraftKey ? sessionStorage.getItem(managementDraftKey) : null;
  const commandActor = { ...actor }, commandRoute = location.hash;
  let commandResult;
  try {
    const transaction = async cap => {
      load(); if (viewError) throw new Error(viewError);
      let domainActor=commandActor;
      if ((type.startsWith('invoice.') || type.startsWith('commerce-invoice.')) && payload.file) await readInvoiceFile(payload.file);
      const extraEvidence = await prepareServiceExtraEvidence(state,commandActor,type,payload,{readFile:readInvoiceFile});
      const promotionEvidence = await prepareServicePromotionEvidence(state,commandActor,type,payload,{readFile:readInvoiceFile});
      const careEvidence = await prepareCareEvidence(state,commandActor,type,payload,{readFile:readInvoiceFile,currentContext:()=>{
        load();if(viewError)throw new Error(viewError);
        if(commandRoute!==location.hash||JSON.stringify(actor)!==JSON.stringify(commandActor))throw new Error('页面或身份已改变，请从当前原案件重新提交。');
        return {state,actor};
      }});
      const qualificationEvidence = await prepareQualificationEvidence(state,commandActor,type,payload,{readFile:readInvoiceFile,currentContext:()=>{
        load();if(viewError)throw new Error(viewError);
        if(commandRoute!==location.hash||JSON.stringify(actor)!==JSON.stringify(commandActor))throw new Error('页面或身份已改变，请从当前原资格记录重新提交。');
        return {state,actor};
      }});
      const compositionPrepared = ['finance.composition-confirm','finance.composition-reconcile'].includes(type) ? await prepareServiceFinanceCompositionEvidence(state,commandActor,type,payload,{readFile:readInvoiceFile,getState:()=>{
        load();if(viewError)throw new Error(viewError);
        if(commandRoute!==location.hash||JSON.stringify(actor)!==JSON.stringify(commandActor))throw new Error('页面或身份已改变，请从原资金明细重新核对。');
        return state;
      }}) : null;
      const runtimeEvidence = {evidenceRefs:[...extraEvidence.evidenceRefs,...promotionEvidence.evidenceRefs,...careEvidence.evidenceRefs,...qualificationEvidence.evidenceRefs,...(compositionPrepared?.evidenceRefs||[])],compositionPrepared};
      if (submitBooking) {
        const choice = bookingOptions(state, payload);
        if (!choice.valid) throw new Error(choice.error || '预约安排已变化，请重新选择可用时段。');
        if ((expectation.techId && expectation.techId !== choice.selectedTechId) || (expectation.priceCents != null && Number(expectation.priceCents) !== choice.priceCents)) throw new Error('可约技师或价格已变化，请重新核对预约。');
      }
      if(type==='account.enter'){
        load();if(viewError)throw new Error(viewError);
        if(commandRoute!==location.hash||JSON.stringify(actor)!==JSON.stringify(commandActor))throw new Error('登录页面或原门店身份已改变，请从当前岗位入口重新选择。');
        const target=new URL(commandRoute.replace(/^#/,''),location.origin),path=target.origin===location.origin?target.pathname:'';
        domainActor=accountEnterActor(state,commandActor,path,payload);
      }
      const uploadBefore=JSON.parse(localStorage.getItem(KEY));
      if(element?.matches?.('[data-management-form]'))assertUploadDraftReady(element,payload);
      let next = reduce(state, domainActor, type, payload, result => { commandResult = result; },runtimeEvidence);
      if(type==='account.enter'&&domainActor.role!==commandActor.role){
        const entered=resolveAccountActor(next,commandResult);
        if(entered.role!=='store'||entered.storeId!==commandActor.storeId||entered.accountId!==payload.accountId||entered.grantId!==payload.grantId||entered.lifecyclePurpose!=='lifecycle-settlement')throw new Error('原事项岗位返回来源不一致，请重新核对。');
      }
      if (submitBooking) {
        const booking = next.bookings.find(item => item.userId === commandActor.userId && item.requestId === payload.requestId);
        next = reduce(next, commandActor, 'booking.pay', { id: booking.id, outcome: paymentOutcome });
      }
      if(element?.matches?.('[data-management-form]'))appUploads.stage(element,uploadBefore,next,payload,commandResult,{command:type,galleryFields:element._submittedGalleryFields});
      const completionKeys=[...new Set([managementDraftKey,type==='goods.case'?element?.dataset.caseRequestKey:null,element?.dataset.businessRequestKey].filter(Boolean))].map(key=>({key,value:sessionStorage.getItem(key)}));
      if(type!=='account.enter')sessionScopes.stageCompletion(uploadBefore,next,appSession.identity(),completionKeys,payload.requestId);
      cap.commit(next,{expectedStateToken:sessionHash(uploadBefore)}); state = next;
    };
    await appSession.withMutation(transaction);
    const managementUnchanged = !managementDraftKey || sessionStorage.getItem(managementDraftKey) === submittedManagementDraft;
    let sessionPending='';
    const completedDrafts=[...new Set([managementUnchanged?managementDraftKey:null,type==='goods.case'?element?.dataset.caseRequestKey:null,element?.dataset.businessRequestKey].filter(Boolean))].map(key=>({key,value:sessionStorage.getItem(key)}));
    for(const {key,value} of completedDrafts)try{sessionScopes.complete(key,value,appSession.identity());}catch(error){sessionPending=error.message;}
    for(const {key,value} of completedDrafts)try{await removeSession(key,value);}catch(error){sessionPending=error.message;}
    const draftUnchanged = !submitBooking || sessionStorage.getItem(draftKey(commandActor.userId)) === submittedDraftStored;
    const sameContext = draftUnchanged && managementUnchanged && location.hash === commandRoute && ['role', 'job', 'userId', 'storeId', 'techId', 'accountId', 'sessionId', 'grantId'].every(key => actor[key] === commandActor[key]);
    if (sameContext) {
      if (type === 'account.enter') {const target=await changeActor(null,null,'account-enter',latest=>{const next=resolveAccountActor(latest,{...initialActor,...commandResult});return{actor:next,path:'/'+next.role+'/dashboard',...(!commandActor.sessionId&&!commandActor.accountId&&!commandActor.grantId&&commandActor.role==='store'&&next.lifecyclePurpose==='lifecycle-settlement'?{login:payload}:{})};});location.hash=target.path;sessionPending='';}
      if (type === 'sensitive.reveal') sensitiveResult = { context: JSON.stringify(actor) + location.hash, value: commandResult };
      if (type === 'privacy.withdraw') { const draft = getDraft(commandActor.userId); await saveDraft({ ...draft, identityConsent:false, identityVerified:false, privacyVersion:privacyProfile(state,commandActor.userId).version },commandActor.userId); }
      if (type === 'privacy.close')try{await removeSession(draftKey(state.privacyClosures.find(c=>c.id===payload.id)?.userId));}catch(error){sessionPending=error.message;}
      if (type === 'goods.submit') { const o = state.goods.find(o => o.userId === commandActor.userId && o.requestId === payload.requestId); location.hash = '/user/goods/' + o.id; }
      else if (type === 'booking.create') { const o = state.bookings.find(o => o.userId === commandActor.userId && o.requestId === payload.requestId); location.hash = '/user/booking/' + o.id + (submitBooking ? '/payment' : ''); }
      else if (payBooking || queryBooking) location.hash = '/user/booking/' + payload.id + '/payment';
      else if (type === 'bill.create') location.hash = '/group/bills/' + state.bills.at(-1).id;
      else if (['commerce-invoice.apply-goods','commerce-invoice.apply-fee','commerce-invoice.reapply'].includes(type) && commandResult?.id) {
        const created=state.commerceInvoices.find(x=>x.id===commandResult.id);
        if(created) location.hash=`/${commandActor.role}/${created.category==='goods'?'commodity-invoices':'fee-invoices'}/${created.id}`;
      }
      else if (['invoice.apply', 'invoice.reapply'].includes(type)) {
        const created = state.serviceInvoices.find(inv => inv.requestId === payload.requestId) || state.serviceInvoices.filter(inv => inv.userId === commandActor.userId && inv.bookingId === (payload.bookingId || state.serviceInvoices.find(x => x.id === payload.id)?.bookingId)).at(-1);
        location.hash = '/user/invoices' + (created ? '/' + created.id : '');
      }
      else if (type === 'manage.product-save') location.hash = '/group/catalog/' + (payload.id || state.products.at(-1).id);
      else if (element?.dataset.next) location.hash = element.dataset.next;
    }
    if (submitBooking) {
      const o = state.bookings.find(item => item.userId === commandActor.userId && item.requestId === payload.requestId);
      const currentDraft = draftUnchanged ? submittedDraft : getDraft(commandActor.userId);
      if (draftUnchanged) await saveDraft({ ...currentDraft, privacyVersion: privacyProfile(state,commandActor.userId).version, submittedId: o.id }, commandActor.userId);
      else if (currentDraft.requestId === submittedDraft.requestId) await saveDraft({ ...currentDraft, submittedId: null, requestId: makeRequestId(commandActor.userId) }, commandActor.userId);
    }
    await render();
    if(sessionPending){toast('业务已完成，草稿同步待重试：'+sessionPending,true);return;}
    if (type === 'report.export' && commandResult && sameContext) {
      const href=URL.createObjectURL(new Blob([commandResult.content],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');
      link.href=href;link.download=commandResult.filename;link.hidden=true;document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(href),60000);
      toast('导出文件已生成，浏览器已收到下载请求');
    } else toast('操作已完成，各端已同步');
  } catch (error) { toast(error.message, true); } finally { pending = false; }
}
document.addEventListener('click', async event => {
  const clearEvidence=event.target.closest('button[data-care-clear],button[data-qualification-clear]');
  if(clearEvidence){
    event.preventDefault();const form=clearEvidence.closest('form');if(clearEvidence.disabled||Number(form.dataset.invoicePending||0)>0)return;
    const domain=clearEvidence.hasAttribute('data-care-clear')?'care':'qualification';
    try{await appUploads.release(form,'evidenceRefs','clear-selection');form.elements.namedItem('evidenceRefs').value='[]';const input=form.querySelector(`[data-${domain}-upload]`);if(input)input.value='';refreshEvidenceUploadForm(form,domain);await rememberManagement(form);}catch(error){await rememberManagement(form);toast(error.message,true);}return;
  }
  const role = event.target.closest('[data-role]');
  if (role && !actor.sessionId) {try{const next={...actor,role:role.dataset.role};if(next.role==='group'&&!next.job)next.job='all';const target=await changeActor(next,'/'+next.role+'/'+(next.role==='user'?'home':'dashboard'));location.hash=target.path;}catch(error){toast(error.message,true);}return;}
  const btn = event.target.closest('button[data-command]'); if (!btn || btn.disabled) return;
  event.preventDefault(); try { await execute(btn.dataset.command, JSON.parse(btn.dataset.payload || '{}'), btn); } catch (error) { toast(error.message, true); }
});
document.addEventListener('submit', async event => {
  const form = event.target.closest('form[data-command]'); if (!form) return;
  event.preventDefault(); if (!form.reportValidity()) return;
  if (Number(form.dataset.imagePending || 0) > 0) { toast('图片正在读取，请等待预览出现后再保存。',true); return; }
  if (Number(form.dataset.invoicePending || 0) > 0) { toast('附件正在保存，请完成后再提交。',true); return; }
  try {
    let payload = { ...JSON.parse(form.dataset.payload || '{}'), ...Object.fromEntries(new FormData(form)) };
    const requests = [];
    let frozenQualityConfirmation = null;
    if(form.hasAttribute('data-quality-policy-scope')) {
      const data=new FormData(form);
      payload={path:'/group/quality-policies',...qualityPolicyScopeQuery({...payload,storeIds:data.getAll('storeIds'),serviceIds:data.getAll('serviceIds')})};
    }
    if(['quality.policy-publish','quality.policy-withdraw'].includes(form.dataset.command)) {
      if(form.dataset.command==='quality.policy-publish') {
        const data=new FormData(form);
        payload.sourceKinds=data.getAll('sourceKinds');payload.retrainingServiceIds=data.getAll('retrainingServiceIds');
      }
      payload=qualityPolicyFormPayload(form.dataset.command,payload);
      frozenQualityConfirmation=qualityConfirmationSummary(form,payload);
    }
    if(['care.case-create','care.case-statement'].includes(form.dataset.command)&&payload.evidenceRefs!==undefined)payload.evidenceRefs=parseCareFormEvidence(payload.evidenceRefs);
    if(form.dataset.command.startsWith('qualification.')&&payload.evidenceRefs!==undefined)payload.evidenceRefs=parseQualificationFormEvidence(payload.evidenceRefs);
    if (['bill.dispute-lines','bill.split'].includes(form.dataset.command)) payload.orderIds = new FormData(form).getAll('orderIds');
    if(['work.assign','work-escalation.raise'].includes(form.dataset.command)) { [payload.accountId,payload.grantId] = JSON.parse(payload.target || '[]'); delete payload.target; }
    if (form.dataset.command === 'ui.booking') for (const input of form.querySelectorAll('input[type="checkbox"][data-booking-field]')) payload[input.name] = input.checked;
    const submitContext=JSON.stringify(actor)+location.hash;
    if (form.dataset.command.startsWith('invoice.') || form.dataset.command.startsWith('commerce-invoice.') || form.dataset.command.startsWith('service-extra.') || form.dataset.command.startsWith('service-promotion.') || form.dataset.command==='finance.recovery-receive' || ['finance.composition-confirm','finance.composition-reconcile'].includes(form.dataset.command)) {
      if (payload.fileRef) payload.file = { ref: payload.fileRef, name: payload.fileName, type: payload.fileType, size: Number(payload.fileSize) };
      for (const key of ['fileRef','fileName','fileType','fileSize','invoiceUpload']) delete payload[key];
    }
    for (const [key, value] of Object.entries(payload)) {
      if (key === 'amountYuan' || key === 'shippingYuan') { payload[key === 'amountYuan' ? 'amountCents' : 'shippingCents'] = yuan(value || '0'); delete payload[key]; }
      if (key.startsWith('refundAmount:')) { if (value && Number(value) > 0) requests.push({ paymentId: key.slice(13), amountCents: yuan(value) }); delete payload[key]; }
    }
    for (const field of form.querySelectorAll('[data-unit="yuan"]')) payload[field.name] = field.value === '' && !field.required ? null : yuan(field.value);
    if (['finance.composition-confirm','finance.composition-reconcile'].includes(form.dataset.command)) {
      payload.evidenceRefs=payload.file?[payload.file]:[];delete payload.file;
      payload.allocations=Object.keys(payload).filter(key=>/^compositionIncome:\d+$/.test(key)).map(key=>{
        const index=key.slice('compositionIncome:'.length);
        return {incomeSourceId:payload[key],incomeRequestNo:payload['compositionReference:'+index],hCents:payload['compositionH:'+index]??0,csCents:payload['compositionCs:'+index]??0};
      }).filter(row=>row.hCents>0||row.csCents>0);
      for(const key of Object.keys(payload))if(/^composition(Income|Reference|H|Cs):\d+$/.test(key))delete payload[key];
    }
    if(form.dataset.command==='service-extra.refund-shortage') { payload.failedAt=Number(payload.failedAt); payload.occurredAt=payload.failedAt; }
    if(form.dataset.command==='account.employment' && form.querySelector('[data-lifecycle-employment-time]')) {
      payload.verifiedAt=Date.parse(`${payload.verifiedAt}+08:00`);
    }
    if (form.hasAttribute('data-management-form')) {
      for (const field of form.querySelectorAll('[data-unit="percent"]')) payload[field.name] = yuan(field.value);
      if (form.querySelector('[name="serviceIds"]')) payload.serviceIds = new FormData(form).getAll('serviceIds');
      if (payload.gallery0 !== undefined) { form._submittedGalleryFields=[0,1,2,3].map(i => payload['gallery'+i]);payload.gallery = form._submittedGalleryFields.filter(Boolean); [0,1,2,3].forEach(i => delete payload['gallery'+i]); }
      if(await rememberManagement(form)===false)throw Error('原草稿同步尚未完成，请保留内容后重试。');
      const confirmationSummary = frozenQualityConfirmation ?? [...form.querySelectorAll('input:not([type=hidden]):not([type=file]),select')].filter(x=>x.name && x.type!=='checkbox' && !x.disabled).map(x=>(x.closest('.field')?.querySelector('span')?.textContent || x.name)+'：'+(x.tagName==='SELECT'?x.selectedOptions[0]?.textContent:x.value)).join('\n');
      if (form.dataset.confirm && !await confirmManagement(form.dataset.confirm + '\n\n本次保存内容：\n' + confirmationSummary + (payload.reason ? '\n\n原因：' + payload.reason : '') + (payload.file ? '\n\n附件：' + payload.file.name : ''))) return;
    }
    if (['booking.refund-request', 'booking.special-aftersale'].includes(form.dataset.command)) payload.requests = requests;
    if (form.dataset.command === 'goods.case') {
      const key = KEY + '-case:' + actor.userId + ':' + payload.id + ':' + payload.kind + ':' + (payload.skuId || (payload.kind === 'cancel' ? 'cancel' : 'shipping'));
      payload.requestId = sessionStorage.getItem(key) || 'case-' + crypto.randomUUID();
      await prepareRequest(form,payload,key,'case-'); form.dataset.caseRequestKey = key;
    }
    if (/^goods\.(address-change|case-withdraw|inspect-partial|partial-propose|partial-confirm|incident-open|incident-note|incident-propose|incident-confirm|incident-verify|incident-receipt)$/.test(form.dataset.command) || form.dataset.command === 'goods.inspect' && payload.version != null) {
      const key = KEY + '-request:' + [actorScope(), form.dataset.command, payload.id || '', payload.caseId || '', payload.incidentId || '', payload.stage || '', payload.kind || '', payload.version || 0].join(':');
      payload.requestId = sessionStorage.getItem(key) || crypto.randomUUID();
      await prepareRequest(form,payload,key);
    }
    if (['recovery.receive', 'booking.assistance-request', 'booking.busy-create', 'booking.special-aftersale'].includes(form.dataset.command)) {
      const scope = form.dataset.command === 'booking.busy-create'
        ? [actor.role, actor.job || '', actor.storeId || '', actor.techId || '']
        : [actor.role, actor.job || '', actor.userId || ''];
      const key = KEY + '-request:' + [actorScope(), form.dataset.command, ...scope, payload.id].join(':');
      payload.requestId = sessionStorage.getItem(key) || crypto.randomUUID();
      await prepareRequest(form,payload,key);
    }
    if (form.dataset.command.startsWith('invoice.') || form.dataset.command.startsWith('commerce-invoice.')) {
      const key = KEY + '-request:' + [actorScope(), form.dataset.command, actor.role, actor.userId || '', actor.storeId || '', payload.id || payload.bookingId || payload.orderId || '', payload.category || '', payload.month || '', payload.version || 0, payload.slot || ''].join(':');
      payload.requestId = sessionStorage.getItem(key) || crypto.randomUUID();
      await prepareRequest(form,payload,key);
    }
    if (form.dataset.command === 'review.create') payload.tags = new FormData(form).getAll('tags');
    if (form.dataset.command.startsWith('fulfilment.')) {
      const key=KEY+'-request:'+JSON.stringify([actorScope(),form.dataset.command,payload.bookingId||'',payload.factId||'',payload.departureId||'',payload.noticeId||'',payload.storeId??'global',payload.accountId||'',payload.grantId||'',payload.id||'',payload.version??0]);
      await prepareRequest(form,payload,key);
    }
    if (form.dataset.command.startsWith('goods-logistics.')) {
      const key=KEY+'-request:'+JSON.stringify([actorScope(),actor.role,actor.job||'',actor.userId||'',form.dataset.command,payload.id||'',payload.factId||'',payload.replacesId||'',payload.kind||'',payload.scope||'',payload.version??0]);
      await prepareRequest(form,payload,key);
    }
    if (form.dataset.command.startsWith('service-extra.')) {
      const key=KEY+'-request:'+JSON.stringify([actorScope(),actor.role,actor.job||'',actor.userId||'',actor.storeId||'',form.dataset.command,payload.id||'',payload.bookingId||'',payload.paymentId||'',payload.refundId||'',payload.advanceId||'',payload.entryId||'',payload.recoveryId||'',payload.kind||'',payload.path||'',payload.scope||'',payload.action||'',payload.version??0,payload.sourceToken||'']);
      await prepareRequest(form,payload,key);
    }
    if (form.dataset.command.startsWith('service-promotion.')) {
      await promotionRequest(form,payload);
    }
    if (form.dataset.command.startsWith('work-escalation.')) {
      const key=KEY+'-request:'+JSON.stringify([actorScope(),form.dataset.command,payload.id,payload.version,payload.sourceToken,payload.ownerToken,payload.assignmentVersion]);
      await prepareRequest(form,payload,key);
    }
    if(form.dataset.command.startsWith('penalty.')) {
      const key=KEY+'-request:'+JSON.stringify([actorScope(),form.dataset.command,payload.id||'',payload.caseId||'',payload.actionIndex??'',payload.caseVersion??'',payload.version??'',payload.sourceToken||'',payload.decision||'']);
      await prepareRequest(form,payload,key);
    }
    if(['quality.policy-publish','quality.policy-withdraw'].includes(form.dataset.command)) {
      const key=KEY+'-request:'+JSON.stringify([actorScope(),form.dataset.command,payload.scope||null,payload.id||'',payload.expectedVersion??null,payload.version??null,payload.revision??null,payload.sourceToken]);
      await prepareRequest(form,payload,key);
    }
    if (/^(finance\.|tech-income\.|review\.|care\.|qualification\.|recipient\.|handoff\.|account\.|privacy\.|sensitive\.|report\.|lifecycle\.)/.test(form.dataset.command)) {
      const key = KEY + '-request:' + [actorScope(), form.dataset.command, actor.role, actor.role === 'group' ? actor.job || 'all' : '', actor.role === 'user' ? actor.userId : actor.role === 'tech' ? actor.techId : actor.storeId || '', form.dataset.managementForm, payload.id || payload.bookingId || payload.techId || '', payload.version || 0].join(':');
      payload.requestId = sessionStorage.getItem(key) || crypto.randomUUID();
      await prepareRequest(form,payload,key);
    }
    if (submitContext !== JSON.stringify(actor)+location.hash) { toast('页面或身份已改变，请在当前页面重新确认。',true); return; }
    await execute(form.dataset.command, payload, form);
  } catch (error) { toast(error.message, true); }
});
document.addEventListener('change', async event => {
  const management = event.target.closest('[data-management-form]');
  if(management&&event.target.matches('[data-quality-policy-control]')) {
    syncQualityPolicyForm(management);await rememberManagement(management);return;
  }
  if(management&&event.target.matches('[data-care-upload],[data-qualification-upload]')) {
    const input=event.target,files=Array.from(input.files||[]);if(!files.length)return;
    const domain=input.hasAttribute('data-care-upload')?'care':'qualification',generationKey=domain+'Generation';
    const origin=JSON.stringify(actor)+location.hash,key=managementKey(management),generation=crypto.randomUUID();
    management.dataset[generationKey]=generation;management.dataset.invoicePending=String(Number(management.dataset.invoicePending||0)+1);
    const note=management.querySelector(`[data-${domain}-upload-status]`),clear=management.querySelector(`[data-${domain}-clear]`);if(note)note.textContent=domain==='care'?'正在核验并保存图片…':'正在核验并保存资格凭证…';if(clear)clear.disabled=true;
    (async()=>{
      try{
        const publish=appUploads.begin(management,'evidenceRefs');
        const payload=await prepareUploadPayload(management);
        const saved=await (domain==='care'?saveCareUpload:saveQualificationUpload)(files,management.dataset.command,payload,{currentContext:()=>{
          load();if(viewError)throw new Error(viewError);
          if(!management.isConnected||management.dataset[generationKey]!==generation||origin!==JSON.stringify(actor)+location.hash)throw new Error(domain==='care'?'页面或身份已改变，请从当前原案件重新选择图片。':'页面或身份已改变，请从当前原资格记录重新选择凭证。');
          return {state,actor};
        },saveFile:file=>saveFormUpload(management,file,'evidenceRefs')});
        if(!management.isConnected||management.dataset[generationKey]!==generation||origin!==JSON.stringify(actor)+location.hash)return;
        await publish();
        management.elements.namedItem('evidenceRefs').value=JSON.stringify(saved);await rememberManagement(management,key);refreshEvidenceUploadForm(management,domain);
      }catch(error){
        if(management.isConnected&&management.dataset[generationKey]===generation&&origin===JSON.stringify(actor)+location.hash){input.value='';await rememberManagement(management,key);if(note)note.textContent=error.message;toast(error.message,true);}
      }finally{management.dataset.invoicePending=String(Math.max(0,Number(management.dataset.invoicePending||0)-1));if(clear&&management.isConnected)clear.disabled=Number(management.dataset.invoicePending)>0||!management.elements.namedItem('evidenceRefs')?.value||management.elements.namedItem('evidenceRefs')?.value==='[]';}
    })();return;
  }
  if (management && event.target.matches('[data-lifecycle-destination]')) {
    const destination=state.stores.find(x=>x.id===event.target.value),versionField=management.querySelector('[name="targetVersion"]');
    if (versionField) versionField.value=destination?.version??'';
  }
  if (management && event.target.matches('[data-lifecycle-identity-tech]')) {
    load();
    if(viewError){await render();toast(viewError,true);return;}
    const tech=state.techs.find(x=>x.id===event.target.value),versionField=management.querySelector('[name="version"]');
    if(versionField)versionField.value=tech?.version??'';
    management.dataset.liveVersion=String(tech?.version??'');
  }
  if (management && event.target.matches('[data-invoice-upload]')) {
    const input = event.target, file = input.files?.[0]; if (!file) return;
    const origin = JSON.stringify(actor) + location.hash, key = managementKey(management), generation = crypto.randomUUID();
    management.dataset.invoiceGeneration = generation;
    management.dataset.invoicePending = String(Number(management.dataset.invoicePending || 0) + 1);
    const note = management.querySelector('[data-invoice-upload-status]'); if (note) note.textContent = '正在保存附件…';
    (async () => {
      try {
        load();
        if(viewError)throw new Error(viewError);
        const payload=await prepareUploadPayload(management);
        assertPrivacyCommand(state,resolveAccountActor(state,actor),management.dataset.command,payload);
        if(!management.isConnected||origin!==JSON.stringify(actor)+location.hash)throw new Error('页面或身份已改变，请从当前原详情重新选择附件。');
        const publish=appUploads.begin(management,'file');
        const saved = await saveFormUpload(management,file,'file');
        if (!management.isConnected || management.dataset.invoiceGeneration !== generation || origin !== JSON.stringify(actor) + location.hash) return;
        await publish();
        for (const [name, value] of Object.entries({ fileRef: saved.ref, fileName: saved.name, fileType: saved.type, fileSize: saved.size })) management.elements.namedItem(name).value = value;
        input.required = false; if (note) note.textContent = '已保存：' + saved.name;
        await rememberManagement(management, key);
      } catch (error) {
        if (management.isConnected && management.dataset.invoiceGeneration === generation && origin===JSON.stringify(actor)+location.hash) {
          input.value = ''; if (note) note.textContent = error.message; toast(error.message, true);
          await rememberManagement(management, key);
        }
      } finally { management.dataset.invoicePending = String(Math.max(0, Number(management.dataset.invoicePending || 0) - 1)); }
    })(); return;
  }
  if (management && (management.dataset.command.startsWith('invoice.') || management.dataset.command.startsWith('commerce-invoice.')) && event.target.name === 'kind') refreshInvoiceForms();
  if (management && (event.target.dataset.imageChoice || event.target.dataset.imageUpload)) {
    const target = event.target.dataset.imageChoice || event.target.dataset.imageUpload;
    const imageDraftKey = managementKey(management),origin=JSON.stringify(actor)+location.hash;
    const generation = crypto.randomUUID(); management.elements.namedItem(target).dataset.imageGeneration = generation;
    const applyImage = async value => { if (!management.isConnected||origin!==JSON.stringify(actor)+location.hash||management.elements.namedItem(target).dataset.imageGeneration !== generation) return; management.elements.namedItem(target).value = value; const img = [...management.querySelectorAll('[data-image-preview]')].find(x => x.dataset.imagePreview === target); showMedia(img, value); await rememberManagement(management, imageDraftKey); };
    if (event.target.dataset.imageChoice) { (async()=>{try{await appUploads.release(management,target,event.target.value?'replace-selection':'clear-selection');await applyImage(event.target.value);}catch(error){await rememberManagement(management,imageDraftKey);toast(error.message,true);}})();return; }
    const file = event.target.files?.[0]; if (!file) return;
    if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 300 * 1024) { toast('请选择300KB以内的 PNG、JPG 或 WebP。', true); event.target.value = ''; return; }
    management.dataset.imagePending=String(Number(management.dataset.imagePending||0)+1);
    const finish=()=>management.dataset.imagePending=String(Math.max(0,Number(management.dataset.imagePending||0)-1));
    const preview = URL.createObjectURL(file);
    (async () => { try { const picture = new Image(); picture.src = preview; await picture.decode();if(!management.isConnected||origin!==JSON.stringify(actor)+location.hash||management.elements.namedItem(target).dataset.imageGeneration!==generation)throw new Error('页面或选择已变化，原资料保留。');const publish=appUploads.begin(management,target),saved=await saveFormUpload(management,file,target);if(!management.isConnected||origin!==JSON.stringify(actor)+location.hash||management.elements.namedItem(target).dataset.imageGeneration!==generation)return;await publish();await applyImage(saved.ref); } catch (error) { if(management.isConnected&&origin===JSON.stringify(actor)+location.hash)await rememberManagement(management,imageDraftKey);toast('图片未保存：' + error.message, true); } finally { URL.revokeObjectURL(preview); finish(); } })(); return;
  }
  if (management) await rememberManagement(management);
  const bookingField = event.target.closest('[data-booking-field]');
  if (bookingField) { if(await updateBookingField(bookingField)&&bookingField.hasAttribute('data-booking-refresh')) await render(); return; }
  const demoResult = event.target.closest('[data-booking-result]');
  if (demoResult) {
    load();if(viewError){await render();toast(viewError,true);return;}
    if(actor.role==='user'&&privacyUseClosed(state,actor.userId)){await render();toast('账号使用已关闭，不能更改预约支付演示结果。',true);return;}
    try{await writeSession(KEY+'-booking-result',demoResult.value);bookingPaymentResult=demoResult.value;}catch(error){demoResult.value=bookingPaymentResult;toast('支付演示选择同步未完成：'+error.message,true);}return;
  }
  const filter = event.target.closest('form[data-auto-filter="true"][data-command="ui.filter"]');
  if (filter) { execute('ui.filter', { ...JSON.parse(filter.dataset.payload || '{}'), ...Object.fromEntries(new FormData(filter)) }, filter); return; }
  const field = event.target.closest('[data-identity]'); if (!field) return;
  if (actor.sessionId) { await render(); return; }
  const next={...actor,[field.dataset.identity]:field.value};
  if(field.dataset.identity==='techId')next.storeId=state.techs.find(t=>t.id===field.value)?.storeId||next.storeId;
  try{const target=await changeActor(next,'/'+next.role+'/'+(next.role==='user'?'home':'dashboard'));location.hash=target.path;await render();}catch(error){toast(error.message,true);}
});
document.addEventListener('input', async event => {
  const management = event.target.closest('[data-management-form]'); if (management) await rememberManagement(management);
  const field = event.target.closest('[data-booking-field]');
  if (field) await updateBookingField(field);
});
window.addEventListener('storage', async event => { if (event.key === KEY) { sensitiveResult = null; load(); await render(); } });
window.addEventListener('beforeunload',event=>{if(qualityDraftPending>0){event.preventDefault();event.returnValue='';}});
window.addEventListener('hashchange', async () => {
  sensitiveResult = null;
  try {
  await prepareRoute();const route = parsedRoute();
  if (actor.role === 'user' && route[0] === 'mall' && ui.query.has('ref')) {
    const storeId = ui.query.get('ref');
    history.replaceState(null, '', location.pathname + '#/user/mall'); await execute('promotion.enter', { storeId });
    // A rejected referral still needs to render the normalized mall route.
    await render();
  } else await render();
  window.scrollTo({ top: 0, behavior: 'instant' });
  } catch(error) {toast('页面身份同步未完成，请保留原草稿后重试：'+error.message,true);}
});
if (location.hash.includes('ref=')) window.dispatchEvent(new Event('hashchange')); else await render();
