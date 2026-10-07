'use strict';
// 本地原型状态。这里的支付/核身/拨号只演示界面，不调用外部服务。
(() => {
  const KEY = 'tianli-prototype-v3-demo';
  const initial = () => ({
    service: 'relax', price: 298, duration: 60, tech: '林师傅', assignment: 'nearby',
    slot: '14:00', date: '10月2日', recipient: {name: '王女士', phone: '13800008000'},
    address: '幸福里小区 2号楼 8层 802室', realname: false, health: false,
    adult: false, eligible: false, consent: true, account: 'normal',
    stage: 'draft', finance: 'unpaid', paid: false, changes: 1, elapsed: 45,
    extension: 0, extendPending: false, location: false, invoice: '', aftersale: '',
    requestedRefund: 98, offeredRefund: 49.67, refundAmount: 0, refundReason: '',
    withdrawal: '', balance: 186.40, withdrawalAmount: 0, promoter: true,
    sos: '', sosOrder: '0132', sosPosition: '幸福里小区 2号楼',
    leave: '', appeal: '', drafts: {}, orderNo: 'TL2026100100132', deadlines: {}, events: [],
    paidAt: 0, dispatchRoundStartedAt: 0, dispatchRoundExpiresAt: 0, clockOffsetMs: 0
  });
  let live = q.get('demo') === '1';
  let state = initial();
  const stack = [];
  if (live) {
    const saved = sessionStorage.getItem(KEY);
    if (saved) {
      try { state = {...initial(), ...JSON.parse(saved)}; }
      catch (error) { sessionStorage.removeItem(KEY); console.warn('演示记录已重置：', error.message); }
    }
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const now=()=>Date.now()+(state.clockOffsetMs||0);
  const role = () => sid.startsWith('t-') ? 'tech' : sid.startsWith('s-') ? 'store' : 'user';
  const store = event => {
    live = true;
    if (event) state.events.push({event, stage: state.stage, finance: state.finance, at: new Date().toISOString()});
    sessionStorage.setItem(KEY, JSON.stringify(state));
    window.parent.postMessage({type: 'tianli-demo-state', state}, location.protocol === 'file:' ? '*' : location.origin);
  };
  const currentOrder = () => {
    if (state.finance === 'refund-processing') return 'u-refund-processing';
    if (state.stage === 'cancelled') return 'u-o-cancelled';
    if (state.stage === 'refunded') return 'u-refund-received';
    if (state.aftersale === 'pending') return 'u-o-aftersale';
    if (state.aftersale === 'confirm') return 'u-aftersale-confirm';
    if (state.aftersale === 'reject-confirm') return 'u-aftersale-rejected';
    if (state.aftersale === 'hq') return 'u-aftersale-hq';
    if (['completed','settled'].includes(state.stage)) {
      const age=state.finishedAt?now()-state.finishedAt:0;
      if(age>90*86400000)return 'u-o-history';
      if(age>48*3600000)return 'u-o-settled';
      return 'u-o-done';
    }
    return ({draft:'u-confirm',waiting:'u-o-waiting',dispatching:'u-o-dispatching',accepted:'u-o-accepted',reassign:'u-o-reassign',reschedule:'u-o-store-reschedule',departed:'u-o-departed',late:'u-o-late',arrived:'u-o-arrived',serving:'u-o-serving',service:'u-o-service',completed:'u-o-done',settled:'u-o-settled',closed:'u-o-closed'})[state.stage] || 'u-orders';
  };
  const aliases = {'t-o-intervention':'t-service-info','t-extend-waiting':'t-extension-wait','t-extend-expired':'t-extension-expired','t-no-show':'t-noshow-confirm','s-reassign':'s-reassign-designated','s-reassign-waiting':'s-reassign-wait','s-dispatch-result':'s-reassign-result','t-onboarding-form':'t-onboarding-edit'};
  const techOrder = () => ({accepted:'t-o-accepted',departed:'t-o-departed',late:'t-o-departed',arrived:'t-o-arrived',serving:'t-o-serving',service:'t-service-info',completed:'t-o-completed'})[state.stage] || 't-work';
  const resolve = id => id === 'u-order-current' ? currentOrder() : id === 't-order-current' ? techOrder() : aliases[id] || id;
  function go(id, replace = false) {
    id = resolve(id);
    if (!S[id]) { toast('该操作的页面尚未注册：' + id); return; }
    if (!replace) stack.push(sid);
    if (id === 'u-sos' && role() === 'tech') id = 't-sos';
    sid = id;
    store();
    const url = new URL(location.href);
    url.searchParams.set('screen', id); url.searchParams.set('demo', '1');
    history.replaceState({screen: id}, '', url);
    render();
    document.querySelector('.content')?.scrollTo(0, 0);
  }
  function back() { go(stack.pop() || (role() === 'tech' ? 't-work' : role() === 'store' ? 's-alerts' : 'u-home'), true); }
  function toast(message) {
    document.querySelector('.toast.runtime')?.remove();
    const t = document.createElement('div'); t.className = 'toast runtime'; t.setAttribute('role', 'status'); t.textContent = message;
    document.getElementById('app').append(t);
    setTimeout(() => t.remove(), 3500);
  }
  function modal(title, text, buttons = [{label:'知道了',action:'close-dialog'}]) {
    document.querySelector('.overlay.runtime')?.remove();
    const el = document.createElement('div'); el.className = 'overlay runtime';
    el.innerHTML = `<section class="sheet" role="dialog" aria-label="${escape(title)}"><div class="sheet-head"><h2>${escape(title)}</h2><button aria-label="关闭" data-action="close-dialog">${I('x')}</button></div><div class="sheet-body"><p>${escape(text)}</p></div><div class="sheet-footer"><div class="actions">${buttons.map((b,i)=>B(escape(b.label), i === buttons.length-1 ? 'primary' : 'secondary', b.go ? `data-go="${b.go}"` : `data-action="${b.action}"`)).join('')}</div></div></section>`;
    document.getElementById('app').append(el); lucide.createIcons();
  }
  const field = name => document.querySelector(`[name="${name}"]`);
  const value = (...names) => {
    for (const name of names) { const element = field(name); if (element) return element.type === 'checkbox' ? element.checked : element.value.trim(); }
    return '';
  };
  function validForm() {
    const invalid = [...document.querySelectorAll('input,textarea,select')].find(input => !input.disabled && !input.checkValidity());
    if (invalid) { invalid.reportValidity(); invalid.focus(); toast(invalid.validationMessage || '请填写完整信息'); return false; }
    return true;
  }
  function setDeadline(key, minutes) { state.deadlines[key] = now() + minutes * 60000; }
  function appointmentStart(){const match=state.date.match(/(\d+)月(\d+)日/);if(!match)return Infinity;return new Date(`${new Date(now()).getFullYear()}-${String(match[1]).padStart(2,'0')}-${String(match[2]).padStart(2,'0')}T${state.slot}:00+08:00`).getTime();}
  function startDispatchRound(reason){const start=reason==='首次支付'?state.paidAt:now();state.dispatchRoundStartedAt=start;state.dispatchRoundExpiresAt=Math.min(start+30*60000,appointmentStart()-60*60000);state.dispatchRoundReason=reason;state.dispatchRoundCompletedAt=0;state.deadlines.dispatch=state.dispatchRoundExpiresAt;state.deadlines.accept=Math.min(start+10*60000,state.dispatchRoundExpiresAt);}
  function ensureDispatchRound(){if(!state.dispatchRoundExpiresAt){state.dispatchRoundStartedAt=state.paidAt||now();state.dispatchRoundExpiresAt=state.deadlines.dispatch||Math.min(state.dispatchRoundStartedAt+30*60000,appointmentStart()-60*60000);}state.deadlines.dispatch=state.dispatchRoundExpiresAt;}
  function dispatchAvailable(){ensureDispatchRound();if(state.dispatchRoundExpiresAt<=now()){refund(state.price,'派单超时，自动全额退款');return false;}return true;}
  function completeDispatch(){state.stage='accepted';state.dispatchRoundCompletedAt=now();delete state.deadlines.accept;delete state.deadlines.dispatch;delete state.deadlines.reassign;}
  function leaveOverlapsOrder(tech){const leave=state.leaveDetails;if(!leave||leave.tech!==tech)return false;const start=appointmentStart(),end=start+(state.duration+(state.extendedMinutes||0))*60000;const leaveStart=new Date(`${leave.date}T${leave.start||'00:00'}:00+08:00`).getTime();const leaveEnd=new Date(`${leave.endDate||leave.date}T${leave.end||'23:59'}:00+08:00`).getTime();return start<leaveEnd&&end>leaveStart;}
  const techAvailable=tech=>!(state.leave==='approved'&&leaveOverlapsOrder(tech));
  const extensionPayments=()=>Array.from({length:state.extension||0},(_,i)=>state.extensionPayments?.[i]||Math.round(state.price/state.duration*30));
  const paidTotal=()=>state.price+extensionPayments().reduce((sum,amount)=>sum+amount,0);
  const confirmedRefunds=()=>state.refundedByPayment||(['refunded','settled'].includes(state.finance)?state.refundBreakdown||[state.refundAmount||0]:[]);
  const refundedTotal=()=>confirmedRefunds().reduce((sum,amount)=>sum+Math.round(amount*100),0)/100;
  const refundTotal=()=>state.refundedByPayment?Math.round((refundedTotal()+(state.finance==='refund-processing'?state.refundAmount:0))*100)/100:state.refundAmount;
  const refundableBalances=()=>[state.price,...extensionPayments()].map((paid,i)=>Math.max(0,Math.round((paid-(confirmedRefunds()[i]||0)-(state.finance==='refund-processing'?(state.refundBreakdown?.[i]||0):0))*100)/100));
  const cancellationAmounts=()=>{const paid=Math.round(state.price*100),fee=Math.round(paid*.2);return {paid:paid/100,fee:fee/100,refund:(paid-fee)/100,compensation:Math.floor(fee*.5)/100};};
  function refund(amount, reason) {
    if(state.finance==='refund-processing'){go('u-refund-processing');return;}
    const available=refundableBalances();
    if(!Number.isFinite(amount)||amount<0||Math.round(amount*100)>Math.round(available.reduce((a,b)=>a+b,0)*100)){toast('退款金额不能超过尚可退金额');return;}
    state.refundAmount = Math.round(amount * 100) / 100; state.refundReason = reason;
    if(state.refundAmount===0){state.refundBreakdown=[0,...extensionPayments().map(()=>0)];state.aftersale='result';state.aftersaleNoRefund=true;delete state.deadlines.storeAftersale;delete state.deadlines.aftersaleConfirm;delete state.deadlines.hqAftersale;state.finance=state.stage==='refunded'?'refunded':state.stage==='settled'?'settled':state.stage==='service'||state.sosUnresolved||['sent','escalated','handling','unanswered'].includes(state.sos)?'blocked':'pending-settlement';store('售后完成，无退款交易');go('u-aftersale-result');return;}
    state.aftersaleNoRefund=false;
    const requested=state.requestedRefundBreakdown;
    if(requested&&state.requestedRefund>0){const parts=[requested.main,...requested.extensions].map(part=>Math.round(part*100));const total=parts.reduce((a,b)=>a+b,0),refundCents=Math.round(state.refundAmount*100);const shares=parts.map(part=>Math.floor(part*refundCents/total));let remain=refundCents-shares.reduce((a,b)=>a+b,0);const order=parts.map((part,i)=>({i,remainder:part*refundCents%total})).sort((a,b)=>b.remainder-a.remainder||a.i-b.i);for(const {i}of order){if(remain>0&&shares[i]<parts[i]){shares[i]++;remain--;}}state.refundBreakdown=shares.map(part=>part/100);}
    else state.refundBreakdown=[state.refundAmount];
    state.finance = 'refund-processing'; state.stage = amount >= paidTotal() ? 'refunded' : state.stage === 'completed' ? 'completed' : 'cancelled';
    state.deadlines = {}; state.aftersale = 'result';
    if (state.invoice === 'issued') state.invoice = 'red';
    store('申请退款'); go('u-refund-processing');
  }
  function cancel() {
    if (['arrived','serving','service'].includes(state.stage)) { go('u-customer-service'); return; }
    const amount = state.stage === 'departed' ? cancellationAmounts().refund : state.price;
    modal('确认取消', amount < state.price ? `技师已出发：扣费 ¥${(state.price-amount).toFixed(2)}，退回 ¥${amount.toFixed(2)}。` : `免费取消，原路退回 ¥${amount.toFixed(2)}。`, [{label:'暂不取消',action:'close-dialog'},{label:'确认取消',action: amount < state.price ? 'cancel-charged' : 'cancel-free'}]);
  }
  function bookingGuard() {
    if (state.account === 'deleted') { go('u-deleted'); return false; }
    if (state.account === 'restricted') { go('u-restricted'); return false; }
    if (!state.consent) { go('u-consent-revoked'); return false; }
    if (!state.realname) { go('u-realname-form'); return false; }
    return true;
  }
  function newBooking(service){const keep={};for(const key of ['realname','consent','account','legalName','recipient','address','balance','promoter','transferAuthorized','withdrawal','withdrawalAmount','withdrawalRestored','withdrawalDay','withdrawalCount','clockOffsetMs','emergency','events'])keep[key]=state[key];state={...initial(),...keep,service,price:service==='neck'?198:298,duration:service==='neck'?45:60};go('u-service-detail');}
  const actions = {
    'close-dialog': () => document.querySelector('.overlay.runtime')?.remove(),
    'choose-relax': () => newBooking('relax'),
    'choose-neck': () => newBooking('neck'),
    'book': () => { state.stage='draft'; state.paid=false; state.health=false; state.adult=false; state.eligible=false; state.deadlines={}; go('u-tech-picker'); },
    'choose-nearby': () => { state.assignment='nearby'; state.tech='林师傅'; go('u-slot'); },
    'choose-technician': button => { state.assignment='specified'; state.tech=button.dataset.tech || button.dataset.name || '林师傅'; go('u-slot'); },
    'confirm-slot': () => { if (state.paid) { toast('已付款订单请使用改约'); return; } setDeadline('payment',15); if (bookingGuard()) go('u-recipient'); },
    'verify-identity': () => { if (!value('identity-consent') && !value('identityConsent') && !value('realnameConsent')) { toast('请单独同意身份信息处理'); return; } if (!validForm()) return; state.realname=true; store('实名核验演示通过'); go('u-recipient'); },
    'health-confirm': () => { if (!state.adult || !state.eligible) { toast('请确认服务对象年龄和健康条件'); return; } state.health=true; go('u-confirm'); },
    'pay': () => {if(state.paid){go(currentOrder());return;}if(!bookingGuard())return;if(!state.health){toast('请勾选健康告知');return;}if(state.deadlines.payment&&state.deadlines.payment<=now()){state.stage='closed';go('u-payment-expired');return;}state.paid=true;state.paidAt=now();state.finance='paid';state.stage='waiting';startDispatchRound('首次支付');delete state.deadlines.payment;store('支付成功演示');if(!dispatchAvailable())return;go('u-paid');},
    'subscribe': () => { toast('已订阅订单进度（演示）'); store('订阅授权'); },
    'cancel': cancel,
    'cancel-free': () => refund(state.price,'免费取消'),
    'cancel-charged': () => refund(cancellationAmounts().refund,'技师出发后取消，扣费 20%'),
    'refund-refresh': () => {if(state.finance!=='refund-processing'){go(currentOrder());return;}const previous=state.refundedByPayment||[],parts=state.refundBreakdown||[state.refundAmount];state.refundedByPayment=[state.price,...extensionPayments()].map((_,i)=>Math.round(((previous[i]||0)+(parts[i]||0))*100)/100);state.finance='refunded';if(refundedTotal()>=paidTotal())state.stage='refunded';store('退款完成');go(state.stage==='refunded'?'u-refund-received':state.refundReason.includes('扣费')?'u-o-cancelled':'u-o-refunded');},
    'reschedule': () => { if (!['waiting','dispatching','accepted'].includes(state.stage)) { toast('技师出发后不能改约'); return; } if (state.changes<=0) { go('u-reschedule-limit'); return; } state.proposedSlot='16:00';state.proposedDate=state.date;state.proposedTech=state.tech;go('u-reschedule'); },
    'confirm-reschedule': () => {if(state.changes<=0||!['waiting','dispatching','accepted'].includes(state.stage)){go('u-reschedule-limit');return;}state.slot=state.proposedSlot||'16:00';state.date=state.proposedDate||state.date;state.tech=state.proposedTech||state.tech;state.changes--;state.deadlines={};state.stage='waiting';startDispatchRound('用户确认改约');store('改约重新派单');if(!dispatchAvailable())return;go('u-o-waiting');},
    'accept-order': () => {if(state.stage!=='waiting'||(state.deadlines.accept&&state.deadlines.accept<=now())){go('t-expired');return;}if(!dispatchAvailable())return;completeDispatch();store('技师接单');go('t-o-accepted');},
    'reject-order': () => { if (state.stage !== 'waiting') { go('t-expired'); return; } state.stage='dispatching'; delete state.deadlines.accept; store('技师拒单转派单池'); go('t-work'); },
    'dispatch-order': () => {if(!['waiting','dispatching'].includes(state.stage)){toast('订单已处理，请查看最新状态');return;}if(!dispatchAvailable())return;const chosen=document.querySelector('.sheet .choice.selected')?.textContent||'陈师傅';const nextTech=chosen.includes('周师傅')?'周师傅':'陈师傅';if(!techAvailable(nextTech)){toast('该技师已请假，请选择可用技师');return;}state.previousTech=state.tech;state.tech=nextTech;if(state.assignment==='specified'){state.reassignFrom=state.stage;state.stage='reassign';delete state.deadlines.accept;state.deadlines.reassign=Math.min(now()+15*60000,state.dispatchRoundExpiresAt);store('指定技师改派待用户确认');go('s-reassign-waiting');}else{completeDispatch();store('门店派单完成，直接已接单');go('s-dispatch-result');}},
    'accept-reassign': () => {if(state.stage!=='reassign'){toast('改派状态已变化');return;}if(state.deadlines.reassign&&state.deadlines.reassign<=now()){refund(state.price,'改派确认超时');return;}if(['waiting','dispatching'].includes(state.reassignFrom)&&!dispatchAvailable())return;if(state.reassignFrom==='accepted'){startDispatchRound('用户确认改派');if(!dispatchAvailable())return;}completeDispatch();store('用户同意改派，门店派单完成');go('u-o-accepted');},
    'reject-reassign': () => refund(state.price,'不同意更换指定技师'),
    'accept-store-reschedule': () => {state.slot=state.proposedSlot||'16:00';state.date=state.proposedDate||state.date;state.tech=state.proposedTech||state.tech;state.stage='waiting';state.deadlines={};startDispatchRound('用户确认门店改约');store('用户同意门店改约，等待技师重新接单');if(!dispatchAvailable())return;go('u-o-waiting');},
    'reject-store-reschedule': () => { state.stage='accepted'; delete state.deadlines.storeReschedule; store('用户保持原预约'); go('u-o-accepted'); },
    'depart': () => { if (!state.location) { go('t-location'); return; } if (state.stage!=='accepted') { toast('当前订单不能出发'); return; } state.stage='departed'; store('技师出发'); go('t-o-departed'); },
    'enable-location': () => { state.location=true; store('位置单独同意'); go('t-o-accepted'); },
    'arrive': () => { state.stage='arrived'; setDeadline('noshow',15); store('到达打卡'); go('t-o-arrived'); },
    'start-service': () => { state.stage='serving'; state.elapsed=20; state.deadlines={}; store('开始服务'); go('t-o-serving'); },
    'finish-service': () => {if(!validForm())return;const choice=document.querySelector('.sheet .choice.selected')?.textContent||'';if(choice.includes('正常完成')&&state.elapsed<state.duration+(state.extendedMinutes||0)){toast('尚未服务满预约时长');return;}state.stage='completed';state.finance=['sent','escalated','handling','unanswered'].includes(state.sos)?'blocked':'pending-settlement';state.finishedAt=now();store('完成服务');go('t-o-completed'); },
    'terminate-service': () => {state.terminationNote=value('terminationNote');state.stage='service';state.finance='blocked';state.terminationReason=document.querySelector('.sheet .choice.selected')?.innerText||value('terminationReason')||'用户提出不当要求';store('中止服务待核实');go('t-o-intervention'); },
    'request-extend': () => { if (state.stage!=='serving') { toast('服务开始后可以加钟'); return; } if (state.extension>=2) { go('u-extend-limit'); return; } state.extendPending=true; setDeadline('extend',5); store('加钟时段锁定'); go(role()==='tech'?'t-extend-waiting':'u-o-extend'); },
    'pay-extend': () => { if (!state.extendPending || (state.deadlines.extend && state.deadlines.extend<=now())) { go('u-extend-expired'); return; }state.extensionPayments=extensionPayments();state.extensionPayments.push(Math.round(state.price/state.duration*30));state.extension++;state.extendPending=false;state.extendedMinutes=(state.extendedMinutes||0)+30;delete state.deadlines.extend;store('加钟支付成功');go('u-o-serving'); },
    'abandon-extend': () => { state.extendPending=false; delete state.deadlines.extend; store('放弃加钟释放时段'); go('u-o-serving'); },
    'apply-aftersale': () => go('u-aftersale-apply'),
    'submit-aftersale': () => {if(state.finance==='refund-processing'||['pending','confirm','reject-confirm','hq'].includes(state.aftersale)){toast('已有售后或退款正在处理，请查看进度');return;}if(state.finishedAt&&now()-state.finishedAt>48*3600000){toast('自助售后期限已结束，请联系客服');return;}if(!validForm())return;const balances=refundableBalances(),main=state.aftersaleOnlyFeedback||field('refundMain')?.checked===false?0:Number(value('refundAmount')||0);const extensions=extensionPayments().map((paid,i)=>!state.aftersaleOnlyFeedback&&field('refundExtension'+(i+1))?.checked?Number(value('extensionRefund'+(i+1))||0):0);if(main<0||main>balances[0]||extensions.some((amount,i)=>amount<0||amount>balances[i+1])){toast('每笔退款金额不能超过该笔尚可退金额');return;}state.requestedRefundBreakdown={main,extensions};state.requestedRefund=main+extensions.reduce((sum,amount)=>sum+amount,0);state.aftersale='pending';state.finance='blocked';setDeadline('storeAftersale',1440);store('申请售后，主单与加钟款分别处理');go('u-o-aftersale');},
    'withdraw-aftersale': () => { state.aftersale='withdrawn'; delete state.deadlines.storeAftersale;state.finance=['sent','escalated','handling','unanswered'].includes(state.sos)?'blocked':'pending-settlement';store('撤销售后');go('u-aftersale-withdrawn'); },
    'submit-refund-plan': () => { const amount=Number(value('refundOffer')||state.offeredRefund); if (amount<0 || amount>state.requestedRefund) { toast('方案金额不能超过申请金额'); return; } if (!validForm()) return; state.offeredRefund=amount; state.aftersale='confirm'; delete state.deadlines.storeAftersale; setDeadline('aftersaleConfirm',2880); store('门店协商待用户确认'); go('s-aftersale-wait'); },
    'approve-requested-refund': () => {if(state.aftersale!=='pending'){toast('售后状态已变化，请查看最新结果');return;}refund(state.requestedRefund,'门店同意退款申请');},
    'accept-refund-plan': () => {if(state.aftersale!=='confirm'){toast('方案状态已变化，请查看最新结果');return;}refund(state.offeredRefund,'已接受门店退款方案');},
    'request-hq': () => { state.aftersale='hq'; delete state.deadlines.aftersaleConfirm; setDeadline('hqAftersale',2880); store('申请集团介入'); go('u-aftersale-hq'); },
    'sos-send': () => { if (!['departed','late','arrived','serving','service','completed'].includes(state.stage)) { toast('当前订单尚未进入求助可用时段'); return; }if(state.finishedAt&&now()-state.finishedAt>2*3600000){toast('订单求助时段已结束，请联系客服；紧急情况可直接拨打110');return;}if(['sent','escalated','handling','unanswered'].includes(state.sos)){go(({sent:'u-sos-sent',escalated:'u-sos-escalated',handling:'u-sos-sent',unanswered:'u-sos-unanswered'})[state.sos]);return;}if(role()==='tech'&&state.stage==='completed'){toast('技师端服务结束后请联系客服');return;}state.sosInitiatorRole=role();state.stageBeforeSos=state.stage;if(state.stage==='serving')state.stage='service';state.financeBeforeSos=state.finance;state.finance='blocked';state.sos='sent';setDeadline('sos',3);store('发起订单求助，暂停分账');go('u-sos-sent'); },
    'sos-ack': () => { state.sos='handling'; delete state.deadlines.sos; store('店长接报'); go('s-sos-handling'); },
    'sos-close': () => {
      const result=value('sosResult')||document.querySelector('.sheet .textarea')?.textContent?.trim();
      if(!result){toast('请填写处理结果');return;}
      state.sos='closed';state.sosResult=result;
      const check=document.querySelector('.sheet .check-row input');
      const unresolved=check?.checked||(!check&&document.querySelector('.sheet .check-row')?.dataset.checked==='true');
      state.sosUnresolved=!!unresolved;
      const terminal=['completed','settled','cancelled','refunded','closed'].includes(state.stage);
      const aftersaleOpen=['pending','confirm','reject-confirm','hq'].includes(state.aftersale);
      const channelState=['refund-processing','refunded','settled'].includes(state.finance);
      if(unresolved){
        if(!terminal&&!aftersaleOpen)state.stage='service';
        if(!channelState)state.finance='blocked';
      }else{
        if(state.stage==='service'&&state.stageBeforeSos!=='service'&&!aftersaleOpen)state.stage=state.stageBeforeSos;
        const blocked=aftersaleOpen||state.stage==='service'||state.financeBeforeSos==='blocked';
        if(!blocked&&!channelState)state.finance=state.stage==='completed'?'pending-settlement':state.financeBeforeSos||'paid';
      }
      store('记录处理结果并结案');go('s-sos-closed');
    },
    'sos-call-110': () => modal('拨打 110','原型演示：真实小程序会打开系统拨号确认。遇到紧急危险请使用手机直接拨打 110。'),
    'call-contact': () => modal('联系技师','原型演示：通过虚拟号码联系，客户真实手机号不会暴露。'),
    'call-customer': () => modal('联系客户','原型演示：打开虚拟号码拨号确认。'),
    'contact-support': () => go('u-customer-service'),
    'navigation': () => modal('导航','原型演示：打开地图导航至当前订单的服务地址。'),
    'retry': () => go(role()==='store'?'s-dispatch':'u-home'),
    'consent-restore': () => { state.consent=true; store('重新同意隐私授权'); go('u-realname'); },
    'retry-payment-query': () => { delete state.deadlines.payment;if(state.paid){go(currentOrder());return;}state.stage='closed';state.finance='unpaid';store('支付查询确认未支付，订单关闭');go('u-o-closed'); },
    'review-submit': () => {if(state.reviewSubmitted){toast('此订单已评价，不能重复提交');return;}if(state.finishedAt&&now()-state.finishedAt>7*86400000){toast('评价期限已结束');return;}if(!validForm())return;state.reviewSubmitted=true;state.reviewRating=state.reviewRating||5;state.reviewText=value('reviewText');state.reviewTags=[...document.querySelectorAll('.chips .chip.on')].map(button=>button.textContent.trim());store('提交评价待内容审核');go('u-review-result');}
  };
  const routes = {
    'u-home': {'服务说明':'u-service-detail','查看':'u-tech-detail','距离优先':'u-tech-picker','幸福里小区':'u-addresses'},
    'u-out-of-range': {'更换地址':'u-addresses','更换上门地址':'u-addresses','查看已开通区域':'@coverage-area'},
    'u-slot': {'换技师':'u-tech-picker'},
    'u-tech-detail': {'预约林师傅':'u-slot'},
    'u-confirm': {'修改':'u-addresses','查看档案':'u-tech-detail'},
    'u-health': {'修改':'u-addresses','查看档案':'u-tech-detail'},
    'u-health-unchecked': {'修改':'u-addresses','查看档案':'u-tech-detail'},
    'u-restricted': {'查看平台规则':'@restriction-rules'},
    'u-paid': {'返回首页':'u-home','查看订单':'u-order-current'},
    'u-orders': {'开发票':'u-invoice-form','去评价':'u-review','查看进度':'u-order-current'},
    'u-o-done': {'开发票':'u-invoice-form','去评价':'u-review','申请售后':'u-aftersale-apply'},
    'u-o-aftersale': {'补充材料':'u-aftersale-material'},
    'u-o-service': {'补充说明':'u-aftersale-material'},
    'u-aftersale-hq': {'补充材料':'u-aftersale-material'},
    'u-o-reassign': {'同意更换':'@accept-reassign','不同意，取消并退款':'@reject-reassign'},
    'u-o-store-reschedule': {'同意调整':'@accept-store-reschedule','保持原时间':'@reject-store-reschedule'},
    'u-reschedule': {'改地址':'u-reschedule-address','选择技师':'u-tech-picker','确认改约':'@confirm-reschedule'},
    'u-promo': {'生成海报':'u-poster','分享给好友':'u-poster','提现':'u-withdraw'},
    'u-withdraw': {'去授权':'@authorize-transfer','确认提现':'@withdraw-submit'},
    't-o-serving': {'结束服务':'t-finish','中止服务':'t-terminate'},
    't-finish': {'结束服务':'t-finish'},
    't-terminate': {'结束服务':'t-finish'},
    't-o-arrived': {'中止服务':'t-terminate'},
    't-onboarding': {'修改资料':'t-onboarding-edit'},
    't-work': {'到达打卡':'@arrive'},
    't-location': {'去开启':'@enable-location','暂不开启':'t-o-accepted'},
    't-profile': {'上传新保单':'t-onboarding-form','申诉':'t-review-appeal'},
    't-suspended': {'上传新保单':'t-onboarding-form'},
    't-schedule': {'当天紧急请假':'t-leave-apply','申请请假':'t-leave-apply'},
    's-dispatch': {'选择技师派单':'s-pick'},
    's-pick': {'确认派单':'@dispatch-order'},
    's-orders': {'改派':'s-reassign','查看充值说明':'s-refund-guide'},
    's-aftersale': {'驳回':'s-aftersale-reject','部分退款':'s-aftersale','同意退款 ¥98':'@approve-requested-refund','提交方案':'@submit-refund-plan'},
    's-sos-handling': {'提交并结案':'@sos-close','110':'@sos-call-110','技师':'@call-contact','用户':'@call-customer'},
    's-schedule': {'驳回':'@reject-leave','批准':'@approve-leave'},
    'u-aftersale-confirm': {'接受方案':'@accept-refund-plan','不接受，申请平台介入':'@request-hq'}
  };
  const commonActions = {
    '确认并支付':'pay','提交核验':'verify-identity','我已确认，继续':'health-confirm','确定':'confirm-slot',
    '取消订单':'cancel','免费取消':'cancel-free','确认取消':'cancel-charged','暂不取消':'close-sheet',
    '开启通知':'subscribe','确认接单':'accept-order','拒单':'reject-order','出发':'depart','开始服务':'start-service',
    '确认中止':'terminate-service','确认结束':'finish-service','发起加钟':'request-extend','加钟':'request-extend',
    '支付 ¥149':'pay-extend','放弃':'abandon-extend','提交申请':'submit-aftersale','撤销申请':'withdraw-aftersale',
    '发起平台求助':'sos-send','直接拨打 110':'sos-call-110','立即接报':'sos-ack',
    '联系技师':'call-contact','拨打技师':'call-contact','联系客户':'call-customer','联系门店':'contact-support',
    '联系客服':'contact-support','联系客服申诉':'contact-support','重新加载':'retry','提交评价':'review-submit',
    '导航':'navigation','改约':'reschedule','改约（剩 1 次）':'reschedule'
  };
  const commonRoutes = {'求助':'u-sos','安全求助':'u-sos','再次预约':'u-home','重新预约':'u-home','去预约':'u-home','开发票':'u-invoice-form','返回首页':'u-home','我的订单':'u-orders','查看订单':'u-order-current','去提现':'u-withdraw'};
  function hydrate(app, screen) {
    if (live) {
      const title = state.service === 'neck' ? '肩颈放松' : '舒缓放松';
      // 演示路径共用同一份订单数据；状态画廊保留每张图的独立示例。
      if (!['u-home','u-out-of-range','u-tech-detail','t-profile','t-income','u-promo','u-withdraw'].includes(screen)) {
        app.innerHTML=app.innerHTML.replaceAll('舒缓放松',escape(title)).replaceAll('60分钟',state.duration+'分钟').replaceAll('60 分钟',state.duration+' 分钟').replaceAll('¥298.00','¥'+state.price.toFixed(2)).replaceAll('¥298','¥'+state.price).replaceAll('¥149','¥'+Math.round(state.price/state.duration*30)).replaceAll('林师傅',escape(state.tech)).replaceAll('王女士',escape(state.recipient.name));
        app.querySelectorAll('.contact').forEach(el=>el.textContent='服务对象：'+state.recipient.name+' '+state.recipient.phone.replace(/(\d{3})\d{4}(\d{4})/,'$1****$2'));
        app.querySelectorAll('.address-line').forEach((el,i)=>{el.textContent=i===0?state.address:'';});
      }
      if (screen==='u-confirm' || screen==='u-health-unchecked') {
        const booking=app.querySelector('.form-row .value'); if(booking)booking.innerHTML=escape(state.date+' '+state.slot+' · '+state.duration+'分钟')+I('chevron-right');
        const price=app.querySelector('.payment-footer .price'); if(price)price.innerHTML='<em>¥</em>'+state.price;
        app.querySelector('.technician-confirm .badge')?.replaceChildren(document.createTextNode(state.assignment==='specified'?'指定技师':'就近安排'));
      }
      if (screen==='t-work' && state.stage!=='draft') {
        const card=app.querySelector('.order-card');
        if(card)card.innerHTML=`<div class="order-top"><span>订单尾号 0132</span>${badge(({waiting:'待接单',dispatching:'交门店派单',accepted:'已接单',departed:'已出发',arrived:'已到达',serving:'服务中',service:'客服介入',completed:'已完成'})[state.stage]||'处理中','good')}</div><h3>${escape(title)} · ${state.duration}分钟</h3><p class="small muted">${escape(state.date+' '+state.slot)} · ${escape(state.recipient.name)}</p><div class="actions">${state.stage==='waiting'?B('拒单','secondary','data-action="reject-order"')+B('确认接单','primary','data-action="accept-order"'):B('查看订单','primary full',`data-go="${({accepted:'t-o-accepted',departed:'t-o-departed',arrived:'t-o-arrived',serving:'t-o-serving',service:'t-o-intervention',completed:'t-o-completed'})[state.stage]||'t-expired'}"`)}</div>`;
      }
      if (screen==='s-dispatch' && state.stage==='dispatching') {
        const list=app.querySelector('.order-list'); if(list)list.insertAdjacentHTML('afterbegin',`<div class="order-card"><div class="order-top"><span>订单尾号 0132</span>${badge('待派单','warm')}</div><h3>${escape(title)} · ${state.duration}分钟</h3><p class="small muted">${escape(state.date+' '+state.slot+' · '+state.recipient.name)}</p><div class="actions">${B('选择技师派单','primary full','data-go="s-pick"')}</div></div>`);
      }
      if (screen==='u-o-serving' && state.extension) {
        const p=app.querySelector('.status-hero>p'); if(p)p.innerHTML=`已加钟 ${state.extension} 次，共 ${state.extendedMinutes} 分钟；服务结束时间已顺延。`;
      }
      if(screen==='u-refund-processing'||screen==='u-refund-received'||screen==='u-o-refunded'||screen==='u-o-cancelled') {
        app.querySelectorAll('.kv').forEach(row=>{const key=row.firstElementChild?.textContent;if(key?.includes('退款金额'))row.lastElementChild.textContent='¥'+state.refundAmount.toFixed(2);if(key==='退款原因')row.lastElementChild.textContent=state.refundReason;if(key==='扣除费用')row.lastElementChild.textContent='−¥'+(state.price-state.refundAmount).toFixed(2);});
      }
      if(screen==='u-aftersale-confirm') app.querySelectorAll('.kv').forEach(row=>{if(row.firstElementChild?.textContent==='你的诉求')row.lastElementChild.textContent='退款 ¥'+state.requestedRefund.toFixed(2);if(row.firstElementChild?.textContent==='门店方案')row.lastElementChild.textContent='部分退款 ¥'+state.offeredRefund.toFixed(2);});
    }
    app.querySelectorAll('button').forEach(button=>{
      if(button.dataset.go||button.dataset.action||button.disabled)return;
      const label=(button.getAttribute('aria-label')||button.innerText).trim().replace(/\s+/g,' ');
      let target=routes[screen]?.[label];
      if (target) { if(target.startsWith('@'))button.dataset.action=target.slice(1);else button.dataset.go=target; return; }
      if(button.closest('.tabbar')) { const label=button.innerText.trim(); const targets={user:{'首页':'u-home','订单':'u-orders','我的':'u-my'},tech:{'工作台':'t-work','排班':'t-schedule','收入':'t-income','我的':'t-profile'},store:{'派单':'s-dispatch','今日订单':'s-orders','告警':'s-alerts','排班':'s-schedule'}};button.dataset.go=targets[role()][label];return; }
      if(label==='返回'){button.dataset.action='back';return;}
      if(label==='关闭'){button.dataset.action='close-sheet';return;}
      if(label==='预约'){button.dataset.action=button.closest('.service-row')?.innerText.includes('肩颈')?'choose-neck':'choose-relax';return;}
      if(button.classList.contains('address-button')){button.dataset.go='u-addresses';return;}
      if(label==='店长'){button.dataset.action='store-account';return;}
      if(label==='生成海报'||label==='分享给好友'){button.dataset.go='u-poster';return;}
      if(label==='提现'){button.dataset.go='u-withdraw';return;}
      if(label==='选择技师派单'){button.dataset.go='s-pick';return;}
      if(commonActions[label])button.dataset.action=commonActions[label];
      else if(commonRoutes[label])button.dataset.go=commonRoutes[label];
      else if(button.closest('.filterbar,.segmented,.date-tabs')||button.classList.contains('slot')||button.classList.contains('choice')||button.classList.contains('chip'))button.dataset.action='select-option';
      else button.dataset.action='explain';
    });
    if(live) app.querySelectorAll('.check-row').forEach((row,index)=>{
      if(row.querySelector('input'))return;
      let name='agreement-'+index,checked=true;
      if(screen==='u-realname'){name='identity-consent';checked=false;}
      else if(screen==='u-health'){name=row.closest('.sheet') ? ([...app.querySelectorAll('.sheet .check-row')].indexOf(row)===0?'adult':'eligible') : 'health';checked=state[name];}
      else if(screen==='u-confirm'||screen==='u-health-unchecked'){name='health';checked=state.health;}
      row.dataset.checked=String(checked);row.querySelector('.box')?.remove();
      row.insertAdjacentHTML('afterbegin',`<input type="checkbox" name="${name}" aria-label="${escape(row.textContent.trim())}" ${checked?'checked':''}>`);
    });
    if(live && ['u-confirm','u-health-unchecked'].includes(screen)) { const pay=app.querySelector('[data-action="pay"]');if(pay)pay.disabled=!state.health; }
    app.querySelectorAll('.form-row .value').forEach(el=>{if(el.textContent.includes('预约时间')||el.closest('.form-row').firstElementChild?.textContent==='预约时间'){el.setAttribute('role','button');el.tabIndex=0;el.dataset.go=state.paid?'u-reschedule':'u-slot';}});
    app.querySelectorAll('a').forEach(a=>{if(!a.href){a.setAttribute('role','button');a.tabIndex=0;a.dataset.go=a.textContent.includes('健康')?'u-health':a.textContent.includes('授权')?'u-privacy-detail':'u-promo-agreement';}});
    if(screen==='u-o-done') app.querySelector('.detail')?.insertAdjacentHTML('beforeend',`<div class="card"><div class="actions">${B('开发票','secondary','data-go="u-invoice-form"')}${B('再次预约','secondary','data-go="u-home"')}</div></div>`);
    if(screen==='u-o-service') app.querySelector('.action-footer [data-action="contact-support"]')?.setAttribute('data-go','u-customer-service');
    lucide.createIcons();
  }
  function selectOption(button) {
    const parent=button.closest('.slots,.date-tabs,.segmented,.chips,.sheet-body,.filterbar')||button.parentElement;
    parent.querySelectorAll('button').forEach(b=>b.classList.remove('on','selected'));
    button.classList.add(button.classList.contains('choice')?'selected':'on');
    if(button.classList.contains('slot')) {
      state.slot=button.childNodes[0].textContent.trim();
      if(!state.paid){const price=button.querySelector('small')?.textContent.match(/¥(\d+)/);state.price=price?Number(price[1]):state.service==='neck'?198:298;}
      const lead=document.querySelector('.action-footer .lead b');if(lead)lead.textContent=state.date+' '+state.slot+' · ¥'+state.price;
    }
    if(button.closest('.date-tabs'))state.date=button.innerText.split('\n').pop().replace(/(\d+)\/(\d+)/,'$1月$2日');
    if(button.closest('.choice'))button.parentElement.querySelectorAll('.radio').forEach(r=>r.classList.toggle('on',r.closest('button')===button));
    store();
  }
  function dispatchAction(name, button) {
    live=true;
    if(actions[name])actions[name](button);
    else if(name==='back')back();
    else if(name==='close-sheet'){const sheet=document.querySelector('.overlay');if(sheet)sheet.remove();}
    else if(name==='select-option')selectOption(button);
    else if(name==='authorize-transfer'){state.transferAuthorized=true;store('免确认收款授权');toast('已开通免确认收款（演示）');}
    else if(name==='explain')toast('演示操作：'+(button?.innerText||'已选择')+'。');
    else toast('该演示操作尚未绑定：'+name);
  }
  function advance(minutes, silent=false) {
    state.clockOffsetMs=(state.clockOffsetMs||0)+minutes*60000;
    if(state.stage==='serving')state.elapsed+=minutes;
    const expired=key=>state.deadlines[key]&&state.deadlines[key]<=now();
    if(expired('payment')&&!state.paid){state.stage='closed';delete state.deadlines.payment;go('u-payment-expired');}
    else if(expired('reassign'))refund(state.price,'改派确认超时，自动全额退款');
    else if(expired('storeReschedule')){state.stage='accepted';delete state.deadlines.storeReschedule;go('u-o-accepted');}
    else if(expired('dispatch')&&['waiting','dispatching','reassign'].includes(state.stage))refund(state.price,'派单超时，自动全额退款');
    else if(expired('accept')&&state.stage==='waiting'){state.stage='dispatching';delete state.deadlines.accept;go('s-dispatch');}
    else if(expired('extend')){state.extendPending=false;delete state.deadlines.extend;go(role()==='tech'?'t-extend-expired':'u-extend-expired');}
    else if(expired('sos')){if(state.sos==='sent' && now()-state.deadlines.sos<180000){state.sos='escalated';state.deadlines.sos+=180000;go('u-sos-escalated');}else{state.sos='unanswered';delete state.deadlines.sos;go('u-sos-unanswered');}}
    else if(expired('storeAftersale')){state.aftersale='hq';delete state.deadlines.storeAftersale;setDeadline('hqAftersale',2880);go('u-aftersale-hq');}
    else if(expired('aftersaleConfirm')){if(state.aftersale==='reject-confirm'){state.aftersale='rejected-accepted';delete state.deadlines.aftersaleConfirm;go('u-aftersale-accepted-rejection');}else refund(state.offeredRefund,'协商方案确认超时，按规则视为接受');}
    else if(expired('noshow')){delete state.deadlines.noshow;state.noshowEligible=true;if(role()==='tech')go('t-no-show');}
    else if(!silent)toast('演示时间已推进 '+minutes+' 分钟');
    if(!silent)store('推进演示时间 '+minutes+' 分钟');
    updateTimers();
  }
  function updateTimers(){
    if(!live)return;
    document.querySelectorAll('[data-countdown]').forEach(el=>{const end=state.deadlines[el.dataset.countdown];if(!end)return;const seconds=Math.max(0,Math.ceil((end-now())/1000));const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remain=seconds%60;el.textContent=hours?hours+'小时'+String(minutes).padStart(2,'0')+'分':String(minutes).padStart(2,'0')+'分'+String(remain).padStart(2,'0')+'秒';});
  }
  function scenario(name) {
    const scenarios={
      'reset':()=>{state=initial();sessionStorage.removeItem(KEY);go('u-home');},
      'departed':()=>{state.paid=true;state.realname=true;state.health=true;state.stage='departed';state.finance='paid';go('u-o-departed');},
      'serving':()=>{state.paid=true;state.realname=true;state.health=true;state.stage='serving';state.finance='paid';state.elapsed=45;go('t-o-serving');},
      'done':()=>{state.paid=true;state.stage='completed';state.finance='pending-settlement';state.finishedAt=now();go('u-o-done');},
      'specified':()=>{state.paid=true;state.assignment='specified';state.stage='accepted';state.finance='paid';go('s-reassign');},
      'invoice-issued':()=>{state.invoice='issued';go('u-invoice-issued');},
      'refund':()=>refund(98,'客服裁决部分退款'),
      'sos':()=>{state.stage='serving';actions['sos-send']();},
      'settled-cancelled':()=>{state.stage='cancelled';state.finance='settled';state.refundAmount=state.price*.8;state.refundReason='技师出发后取消，扣费20%已分账';go('u-o-cancelled');}
    };
    scenarios[name]?.();store('切换演示情景 '+name);
  }
  window.PrototypeRuntime={hydrate,go,back,resolve,dispatchAction,actions,value,validForm,toast,store,modal,advance,scenario,isLive:()=>live,getScreen:()=>sid,getState:()=>state,setDeadline,refund,paidTotal,extensionPayments,cancellationAmounts,refundedTotal,refundTotal,refundableBalances,now,startDispatchRound,dispatchAvailable,completeDispatch,techAvailable,leaveOverlapsOrder,getDispatchDeadline:()=>state.dispatchRoundExpiresAt,patch:values=>{Object.assign(state,values);store();}};
  document.addEventListener('click', event=>{
    const target=event.target.closest('[data-action],[data-go]');if(!target||target.disabled)return;
    event.preventDefault();
    if(target.dataset.go)go(target.dataset.go);else dispatchAction(target.dataset.action,target);
  });
  document.addEventListener('change',event=>{
    if(event.target.type==='checkbox' && ['health','adult','eligible'].includes(event.target.name)){state[event.target.name]=event.target.checked;store();if(event.target.name==='health'){const pay=document.querySelector('[data-action="pay"]');if(pay)pay.disabled=!state.health;}}
  });
  document.addEventListener('submit',event=>event.preventDefault());
  document.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&event.target.matches('[role="button"][data-go]')){event.preventDefault();go(event.target.dataset.go);}});
  document.addEventListener('DOMContentLoaded',()=>{if(!document.getElementById('app'))return;render();if(live)store();setInterval(()=>{if(!live)return;const keys=['payment','reassign','storeReschedule','dispatch','accept','extend','sos','storeAftersale','aftersaleConfirm','noshow'];if(keys.some(key=>state.deadlines[key]&&state.deadlines[key]<=now()))advance(0,true);updateTimers();},1000);});
  window.addEventListener('message',event=>{if(event.source!==window.parent || (location.protocol!=='file:'&&event.origin!==location.origin))return;const data=event.data;if(data?.type==='tianli-demo-control'){if(data.action==='advance')advance(data.minutes);if(data.action==='scenario')scenario(data.name);if(data.action==='go')go(data.id);}});
})();
