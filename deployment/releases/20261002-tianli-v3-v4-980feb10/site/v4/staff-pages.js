'use strict';
(() => {
  const U = window.UI;
  const D = window.BookingData;
  const define = window.defineScreen;
  const {escape: E, page, card, hero, notice, kv, button, link, field, select, check, tabs, footer, avatar, icon, summary} = U;
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString('en-CA', {timeZone:'Asia/Shanghai'});
  const money = amount => '¥' + Number(amount || 0).toFixed(2);
  const paidTotal = s => Number(s.price || 0) + (s.extensionPayments || []).reduce((sum, amount) => sum + Number(amount || 0), 0);
  const fullDuration = s => Number(s.duration || 60) + (s.extensionPayments || []).length * 30;
  const currentTech = s => D.tech(s.staffTechId || 'lin');
  const scheduleSummary = s => {
    const work=s.schedules?.[currentTech(s).id] || s.schedule || {start:'09:00',end:'23:00',breakStart:'12:00',breakEnd:'13:00'};
    return `${work.start}–${work.end} · ${work.breakStart&&work.breakEnd?'休息 '+work.breakStart+'–'+work.breakEnd:'无固定休息时段'}`;
  };
  const appointmentTech = s => D.tech(s.techId);
  const isMine = s => s.techId === currentTech(s).id;
  const aftersaleStatus = s => typeof s.aftersale==='string' ? s.aftersale : s.aftersale?.status || '';
  const disabled = condition => condition ? 'disabled' : '';
  const detail = html => `<div class="detail staff-detail">${html}</div>`;
  const textarea = (label, name, value='', attrs='') => `<label class="field"><span>${label}</span><textarea name="${name}" class="booking-textarea" ${attrs}>${E(value)}</textarea></label>`;
  const upload = (label, name, attrs='') => `<label class="field"><span>${label}</span><input type="file" class="booking-input" name="${name}" accept="image/*,.pdf" ${attrs}></label>`;
  const row = (title, desc, target, extra='') => `<div class="book-row"><div class="grow"><strong>${E(title)}</strong><p>${E(desc)}</p></div>${extra || link('查看', target)}</div>`;
  const badge = (text, tone='') => `<span class="badge ${tone}">${E(text)}</span>`;
  const status = s => ({draft:'未提交', waiting:'待确认', confirmed:'已确认', active:'进行中', completed:'已完成', care:'客服处理中', cancelled:'已取消', closed:'已关闭', refunded:'已退款'}[s.stage] || '待确认');
  const techTarget = s => ({waiting:'t-appointment-waiting',confirmed:'t-appointment-confirmed',active:'t-appointment-active',completed:'t-appointment-completed',care:'t-care',closed:'t-expired',cancelled:'t-expired',refunded:'t-expired'}[s.stage] || 't-appointment-waiting');
  const pendingSeed = {stage:'waiting',paid:true,finance:'paid'};
  const confirmedSeed = {stage:'confirmed',paid:true,finance:'paid'};
  const activeSeed = {stage:'active',paid:true,finance:'paid',elapsed:20};
  const completedSeed = {stage:'completed',paid:true,finance:'pending-settlement',elapsed:60};
  const reg = (id, role, group, title, state, caption, seed, render) => define({id,role,group,title,state,caption,seed:seed || {}}, render);
  const contact = s => card(kv('联系人',E(s.contact?.name || '张女士')) + kv('联系电话',E((s.contact?.phone || '13800001234').replace(/(\d{3})\d{4}(\d{4})/, '$1****$2'))) + kv('所属区域',E(D.region(s.regionId).name)), '联系信息');
  const rules = s => card(kv('约定时长', fullDuration(s) + '分钟') + kv('已完成时长', Number(s.elapsed || 0) + '分钟') + kv('已支付金额',money(paidTotal(s))), '履约记录');
  const reason = (s, name, label='处理说明（必填）') => textarea(label, name, s[name] || '', 'required maxlength="500" placeholder="请填写具体原因和已沟通内容"');
  const staffHeader = s => `<div class="worker-header">${avatar(currentTech(s).name)}<div class="grow"><strong>${E(currentTech(s).name)}</strong><p>${E(D.store(currentTech(s).storeId).name)} · 可预约</p></div>${badge('实名已核验','good')}</div>`;
  const appointmentCard = (s, target) => card(`<div class="row between"><strong>${E(D.service(s.serviceId).name)}</strong>${badge(status(s),s.stage==='completed'?'good':'warm')}</div><div class="order-time">${E(s.date)} ${E(s.slot)}</div><p class="reservation-note">${E(D.store(s.storeId).name)} · ${E(D.region(s.regionId).name)}</p>${kv('预约技师',E(appointmentTech(s).name))}${kv('项目金额',money(s.price))}<div class="actions">${link('预约详情',target,'primary')}</div>`);
  const techOptions = (s, {excludeCurrent=false,name='nextTech'}={}) => {
    const eligible = new Set(D.eligibleTechs(s).map(t=>t.id));
    const candidates = D.techs.filter(t=>t.storeId===s.storeId);
    const first = D.eligibleTechs(s).find(t=>!excludeCurrent || t.id!==s.techId)?.id;
    return `<div class="picker-options">${candidates.map(t=>{
      const allowed = eligible.has(t.id) && (!excludeCurrent || t.id!==s.techId);
      const comment = !eligible.has(t.id) ? '项目或时段不匹配' : excludeCurrent && t.id===s.techId ? '当前预约技师' : '项目匹配 · 可安排';
      return `<label class="radio-label"><input type="radio" name="${name}" value="${E(t.id)}" ${allowed && t.id===first?'checked':''} ${disabled(!allowed)} required>${avatar(t.name)}<span class="grow"><strong>${E(t.name)}</strong><p>${E(comment)}</p></span>${badge(allowed?'可选择':'不可选择',allowed?'good':'')}</label>`;
    }).join('')}</div>`;
  };
  const proposedCard = s => {
    const p=s.proposed || {};
    return card(kv('原预约时间',E(s.date+' '+s.slot)) + kv('拟调整时间',E((p.date || s.date)+' '+(p.slot || '16:00'))) + kv('拟安排技师',E(D.tech(p.techId || s.techId).name)) + kv('处理状态','等待用户确认'), '调整方案');
  };
  const leaveDetails = s => {
    const l=s.leaveDetails || {};
    return card(kv('申请技师',E(D.tech(l.techId || currentTech(s).id).name)) + kv('开始时间',E((l.startDate || s.date)+' '+(l.start || '13:00'))) + kv('结束时间',E((l.endDate || s.date)+' '+(l.end || '17:00'))) + kv('请假类型',E(l.type==='urgent'?'紧急请假':'普通请假')) + kv('申请原因',E(l.reason || '有个人事项需要处理')), '请假申请');
  };
  const remainingRefund = s => Math.max(0,paidTotal(s)-(s.refundedByPayment || []).reduce((a,b)=>a+Number(b || 0),0));
  const refundDetails = s => card(kv('主项目支付',money(s.price)) + kv('加钟支付',money((s.extensionPayments || []).reduce((a,b)=>a+Number(b),0))) + kv('申请退款',aftersaleStatus(s)?money(s.requestedRefund ?? s.refundAmount ?? 0):'尚无用户申请') + kv('已退款',money((s.refundedByPayment || []).reduce((a,b)=>a+Number(b || 0),0))) + kv('尚可退金额',money(remainingRefund(s))), '退款金额');
  const leaveResultText = s => s.leaveStatus==='rejected' ? ['请假未通过','请假时段保持原排班，可修改原因后重新提交。','warm'] : ['请假已批准','批准时段不可预约。匹配技师且时段重叠的已确认预约已重新安排。','good'];

  reg('t-work','tech','预约工作台','我的预约','工作台','待确认和进行中的预约集中显示。',{},s=>page({title:'我的预约',back:false,tabs:tabs('tech','预约'),body:staffHeader(s)+detail(`<div class="booking-stats"><div><strong>${s.stage==='waiting'&&isMine(s)?1:0}</strong><span>待确认</span></div><div><strong>${['confirmed','active'].includes(s.stage)&&isMine(s)?1:0}</strong><span>进行中</span></div><div><strong>${s.stage==='completed'&&isMine(s)?1:0}</strong><span>已完成</span></div></div>${s.stage==='care'?notice('warm','message-circle','当前预约需要客服协助，请先查看处理进度。'):''}${appointmentCard(s,techTarget(s))}${card(row('今日排班',scheduleSummary(s),'t-schedule')+row('个人资料','联系方式、项目和资质资料','t-profile'))}`)}));

  reg('t-appointment-waiting','tech','预约处理','预约待确认','待技师确认','预约信息和确认期限持续可见。',pendingSeed,s=>page({title:'预约待确认',body:hero('请确认这笔预约','超过个人确认期限，交由门店继续处理。','brand','calendar-clock')+detail(`${notice('brand','clock-3','剩余 <b data-countdown="confirmDeadline">10:00</b>；实际期限以预约记录为准。')}${summary(s)}${contact(s)}${!isMine(s)?notice('warm','info','这笔预约已安排其他技师，请返回查看自己的预约。'):''}${card('<p class="reservation-note">确认后请按约定时间完成项目。如无法履约，请填写原因交由门店重新安排。</p>'+reason(s,'rejectReason','无法确认的原因（拒绝时必填）'),'确认规则')}`),foot:footer(button('无法确认','reject-appointment','secondary',disabled(s.stage!=='waiting'||!isMine(s)||s.confirmationPhase==='store')),button('确认预约','accept-appointment','primary',disabled(s.stage!=='waiting'||!isMine(s)||s.confirmationPhase==='store')))}));

  reg('t-appointment-confirmed','tech','预约处理','已确认预约','等待开始','预约时间到后可开始记录。',confirmedSeed,s=>page({title:'已确认预约',body:hero('预约已确认','请核对项目和时间，按约定开始。','good','calendar-check')+detail(`${summary(s)}${contact(s)}${notice('gray','info','项目开始后记录计时；提前结束需要说明原因。')}${card(row('联系客服','需要门店协助时查看处理入口','t-care')+row('查看排班','核对这笔预约对应的工作时段','t-schedule'))}`),foot:footer(button('开始记录','start-appointment','primary',disabled(s.stage!=='confirmed'||!isMine(s))))}));

  reg('t-appointment-active','tech','预约处理','预约进行中','计时中','显示已完成时长、加钟和结束入口。',activeSeed,s=>page({title:'预约进行中',body:hero('项目进行中','计时和加钟以支付记录为准。','brand','timer')+detail(`${card(`<div class="row between"><strong>已完成时长</strong>${badge('计时中','good')}</div><div class="timer-big"><span data-elapsed>${Number(s.elapsed||0)}</span><small>分钟</small></div><p class="reservation-note">约定总时长 ${fullDuration(s)}分钟</p><div class="progress"><i style="width:${Math.min(100,Number(s.elapsed||0)/fullDuration(s)*100)}%"></i></div>`)}${summary(s)}${card(kv('加钟时长','30分钟')+kv('加钟金额',money(Number(s.price||0)/Number(s.duration||60)*30))+'<p class="reservation-note">用户完成支付后才增加约定时长。</p><div class="actions">'+button('申请加钟','request-extension','secondary',disabled(s.stage!=='active'))+'</div>','加钟')}${card(row('客服协助','发生异常时可暂停结算并联系门店','t-care')+row('提前结束','说明原因后提交，保留本次记录','t-terminate'))}`),foot:footer(link('结束记录','t-finish','primary'))}));

  reg('t-appointment-completed','tech','预约处理','预约已完成','等待结算','时长、金额和结算状态汇总。',completedSeed,s=>page({title:'预约已完成',body:hero('本次预约已完成','等待结算期间仍可查看处理记录。','good','circle-check')+detail(`${summary(s)}${rules(s)}${notice(s.finance==='blocked'?'warm':'gray','wallet',s.finance==='blocked'?'当前资金暂不可结算，客服处理完成后更新。':'结算金额按项目、加钟和退款记录计算。')}${card(row('收入明细','查看可提现和待结算金额','t-income')+row('客服记录','查看本次预约的处理进度','t-care'))}`),foot:footer(link('返回预约','t-work','primary'))}));

  reg('t-care','tech','异常处理','客服处理','处理中','客服处理期间显示冻结原因和预约信息。',{stage:'care',paid:true,finance:'blocked',careOpen:true},s=>page({title:'客服处理',body:hero(s.careOpen||s.stage==='care'?'客服处理中':'预约协助',s.careOpen||s.stage==='care'?'本次预约资金暂不可结算，请保持联系。':'需要协助时请填写具体情况。','warm','message-circle')+detail(`${notice('warm','shield-alert','异常处理有完整记录。客服决定继续后，再恢复本次项目记录。')}${summary(s)}${card(reason(s,'careReason','情况说明（必填）')+'<p class="reservation-note">请描述发生的问题、已沟通内容和需要的协助。</p>','补充说明')}${card(kv('处理方',E(D.store(s.storeId).name))+kv('当前状态',s.careOpen||s.stage==='care'?'等待门店处理':'待提交')+kv('资金状态',s.finance==='blocked'?'暂不可结算':'按预约记录处理'),'处理进度')}`),foot:footer(link('返回预约','t-work'),button(s.careOpen||s.stage==='care'?'补充说明':'提交协助','request-care','primary'))}));

  reg('t-expired','tech','预约处理','预约已关闭','关闭结果','关闭原因和支付处理结果可追溯。',{stage:'closed',paid:true,finance:'refund-processing'},s=>page({title:'预约已关闭',body:hero('这笔预约已关闭','关闭后的记录继续保留。','gray','circle-slash')+detail(`${summary(s)}${card(kv('关闭原因',E(s.closeReason||'确认期限结束，预约未完成确认'))+kv('支付处理',s.finance==='refunded'?'退款已完成':'已支付金额按规则退回')+kv('退款金额',money(s.refundAmount||paidTotal(s))),'处理结果')}${notice('gray','info','已关闭预约无法再次确认，可返回工作台查看新预约。')}`),foot:footer(link('返回预约','t-work','primary'))}));

  reg('t-extension-wait','tech','预约处理','加钟待支付','等待用户支付','用户支付前约定时长保持原值。',{...activeSeed,extensionRequested:true},s=>page({title:'加钟待支付',body:hero('等待用户支付','支付成功后自动更新约定时长。','brand','clock-3')+detail(`${summary(s)}${card(kv('申请加钟','30分钟')+kv('待支付金额',money(Number(s.price||0)/Number(s.duration||60)*30))+kv('当前约定时长',fullDuration(s)+'分钟'),'加钟申请')}${notice('gray','info','申请未支付时，不能按新增时长完成本次记录。')}`),foot:footer(link('返回进行中','t-appointment-active','primary'))}));

  reg('t-finish','tech','预约处理','结束记录','完成确认','正常完成需达到约定时长，提前结束需说明。',{...activeSeed,elapsed:60},s=>{
    const ready=Number(s.elapsed||0)>=fullDuration(s);
    return page({title:'结束记录',body:detail(`${rules(s)}${summary(s)}${card(`<label class="radio-label"><input type="radio" name="finishType" value="normal" checked><span class="grow"><strong>正常完成</strong><p>已完成约定的全部时长</p></span></label><label class="radio-label"><input type="radio" name="finishType" value="early"><span class="grow"><strong>提前结束</strong><p>说明原因后保留已完成记录</p></span></label>${reason(s,'finishReason','提前结束原因（提前结束时必填）')}`,'结束方式')}${!ready?notice('warm','clock-3','约定时长尚未完成，正常完成暂不可提交；提前结束请填写原因。'):notice('good','circle-check','已达到约定时长，可提交完成记录。')}`),foot:footer(button('提交结束记录','finish-appointment','primary',`data-finish-submit ${disabled(!ready||s.stage!=='active')}`))});
  });

  reg('t-terminate','tech','异常处理','提前结束','填写原因','保留时长和原因，后续处理金额单独确认。',activeSeed,s=>page({title:'提前结束',body:detail(`${notice('warm','info','提交后停止计时，保留已完成时长；涉及退款时由门店处理。')}${rules(s)}${card('<input type="hidden" name="finishType" value="early">'+reason(s,'finishReason','提前结束原因（必填）')+check('已与用户说明本次结束原因','terminationConsent',false),'原因说明')}${summary(s)}`),foot:footer(button('提交提前结束','submit-termination','primary',disabled(s.stage!=='active')))}));

  reg('t-schedule','tech','排班请假','我的排班','排班总览','可约时段、休息和请假显示在一处。',{},s=>page({title:'我的排班',back:false,tabs:tabs('tech','排班'),body:detail(`${card(kv('所属门店',E(D.store(currentTech(s).storeId).name))+kv('日常工作时段',E((s.schedule?.start||'09:00')+'–'+(s.schedule?.end||'23:00')))+kv('休息时段',E((s.schedule?.breakStart||'12:00')+'–'+(s.schedule?.breakEnd||'13:00')))+'<div class="actions">'+link('编辑排班','t-schedule-edit')+link('申请请假','t-leave')+'</div>','工作时间')}${card(kv('日期',E(s.date))+kv('预约时段',E(s.slot))+kv('预约状态',status(s))+kv('安排技师',E(appointmentTech(s).name)), '当日预约')}${card(row('请假记录',s.leaveStatus==='approved'?'已批准':s.leaveStatus==='rejected'?'未通过':'查看申请进度','t-leave-pending'))}${notice('gray','calendar-days','休息、已批准请假和已占用时段不可预约。排班变更须保留已有预约。')}`)}));

  reg('t-schedule-edit','tech','排班请假','编辑排班','填写工作时间','工作和休息时间采用真实时间输入。',{},s=>page({title:'编辑排班',body:detail(`${card(field('工作开始','scheduleStart',s.schedule?.start||'09:00','type="time" required')+field('工作结束','scheduleEnd',s.schedule?.end||'23:00','type="time" required')+field('休息开始','breakStart',s.schedule?.breakStart||'12:00','type="time"')+field('休息结束','breakEnd',s.schedule?.breakEnd||'13:00','type="time"'),'每天的工作时间')}${notice('gray','info','结束时间应晚于开始时间，休息时段须包含在工作时段内。已有预约不会直接被取消。')}`),foot:footer(button('保存排班','save-schedule','primary'))}));

  reg('t-leave','tech','排班请假','申请请假','填写申请','普通和紧急请假保留时段、原因和处理结果。',{},s=>{
    const l=s.leaveDetails || {};
    return page({title:'申请请假',body:detail(`${card(`<input type="hidden" name="techId" value="${E(currentTech(s).id)}">${select('请假类型','leaveType',[['normal','普通请假'],['urgent','紧急请假']],l.type||'normal')}${field('开始日期','leaveStartDate',l.startDate||s.date||tomorrow,'type="date" required')}${field('结束日期','leaveEndDate',l.endDate||s.date||tomorrow,'type="date" required')}${field('开始时间','leaveStart',l.start||'13:00','type="time" required')}${field('结束时间','leaveEnd',l.end||'17:00','type="time" required')}${textarea('请假原因（必填）','leaveReason',l.reason||'','required maxlength="500" placeholder="请说明请假原因"')}`,'请假信息')}${notice('gray','info','请假经门店批准后生效。与请假时段重叠的已确认预约，由门店重新安排。')}`),foot:footer(button('提交请假','submit-leave','primary'))});
  });

  reg('t-leave-pending','tech','排班请假','请假进度','门店处理中','批准和未通过结果都有记录。',{leaveStatus:'pending',leaveDetails:{techId:'lin',startDate:tomorrow,endDate:tomorrow,start:'13:00',end:'17:00',type:'normal',reason:'处理个人事项'}},s=>{
    const result=s.leaveStatus==='pending'?['请假申请已提交','等待门店确认，批准前仍按原排班履约。','brand']:leaveResultText(s);
    return page({title:'请假进度',body:hero(...result,'calendar-clock')+detail(`${leaveDetails(s)}${s.leaveStatus==='rejected'?card(kv('未通过原因',E(s.leaveRejectReason||'该时段已有预约，请先与门店协商')),'门店反馈'):''}${notice('gray','info','请假处理只影响申请技师和重叠时段，其他预约继续保留。')}`),foot:footer(link('返回排班','t-schedule',s.leaveStatus==='rejected'?'secondary':'primary'),s.leaveStatus==='rejected'?link('修改申请','t-leave','primary'):'')});
  });

  reg('t-profile','tech','个人资料','个人资料','资料总览','实名、联系方式和可约项目集中查看。',{},s=>page({title:'个人资料',back:false,tabs:tabs('tech','我的'),body:staffHeader(s)+detail(`${card(kv('姓名',E(s.profile?.realName||currentTech(s).name))+kv('手机号',E((s.profile?.phone||'13900006666').replace(/(\d{3})\d{4}(\d{4})/,'$1****$2')))+kv('所属门店',E(D.store(currentTech(s).storeId).name))+kv('可约项目',E(currentTech(s).services.map(id=>D.service(id).name).join('、')))+kv('资料状态',s.profileSubmitted?'已提交，等待核验':'实名及资质可查'),'资料信息')}${card(row('完善个人资料','联系方式、介绍和资质资料','t-onboarding')+row('我的排班','设置日常时段和申请请假','t-schedule')+row('收入明细','查看结算记录和资金状态','t-income'))}`)}));

  reg('t-onboarding','tech','个人资料','完善资料','填写并上传','实名和资质文件独立上传，单独勾选授权。',{},s=>page({title:'完善资料',body:detail(`${card(field('真实姓名','realName',s.profile?.realName||'','required maxlength="20" placeholder="请输入真实姓名"')+field('手机号','phone',s.profile?.phone||'','type="tel" inputmode="numeric" maxlength="11" required placeholder="请输入手机号"')+select('所属门店','profileStore',D.stores.map(t=>[t.id,t.name]),currentTech(s).storeId)+textarea('擅长项目','skills',s.profile?.skills||'','required maxlength="100" placeholder="请填写可提供的项目"')+textarea('个人介绍','introduction',s.profile?.introduction||'','maxlength="300" placeholder="简要介绍经验和擅长内容"'),'基本信息')}${card(upload('个人照片','profilePhoto')+upload('身份资料','identityFile')+upload('项目资质','qualificationFile'),'资料上传')}${check('同意为实名核验处理本人身份资料','identityConsent',false)}${check('同意为本人核验使用人脸信息','faceConsent',false)}${notice('gray','shield-check','请提供本人资料。身份资料仅用于核验，个人介绍展示给预约用户。')}`),foot:footer(button('保存并提交资料','submit-profile','primary'))}));

  reg('t-income','tech','收入结算','收入明细','资金状态','可提现与待结算金额分开展示。',{},s=>page({title:'收入明细',back:false,tabs:tabs('tech','收入'),body:detail(`${card('<p class="small muted">可提现余额</p><div class="money">'+money(s.balance??568)+'</div>'+kv('待结算项目',s.finance==='pending-settlement'?money(paidTotal(s)):'¥0.00')+kv('暂不可结算',s.finance==='blocked'?money(paidTotal(s)):'¥0.00'),'资金概览')}${card(kv('本次预约支付',money(paidTotal(s)))+kv('本次退款',money((s.refundedByPayment||[]).reduce((a,b)=>a+Number(b||0),0)))+kv('结算状态',({paid:'履约中',blocked:'客服处理期间暂不可结算','pending-settlement':'待结算',settled:'已结算','refund-processing':'退款处理中',refunded:'已退款'}[s.finance]||'未支付')),'当前预约')}${notice('gray','wallet','余额以已完成结算的项目为准。退款和客服处理会影响实际结算金额。')}`)}));

  reg('s-board','store','门店工作台','门店看板','经营工作台','同笔预约的确认、处理与异常待办。',{},s=>page({title:'门店看板',back:false,tabs:tabs('store','看板'),body:`<div class="store-header">${icon('store')}<div class="grow"><strong>${E(D.store(s.storeId).name)}</strong><p>${E(D.store(s.storeId).area)} · ${E(D.store(s.storeId).hours)}</p></div></div>`+detail(`<div class="booking-stats"><div><strong>${s.stage==='waiting'?1:0}</strong><span>待安排</span></div><div><strong>${['confirmed','active'].includes(s.stage)?1:0}</strong><span>已确认</span></div><div><strong>${s.stage==='care'||s.aftersale?1:0}</strong><span>待处理</span></div></div>${appointmentCard(s,s.stage==='waiting'?'s-waiting':s.stage==='care'?'s-care':'s-reassign')}${card(row('预约安排','处理确认、指定改派和时间变更','s-waiting')+row('客服协助',s.stage==='care'?'1笔需要处理':'查看协助记录','s-care')+row('售后处理',s.aftersale?'有待处理申请':'查看退款及处理结果','s-aftersale')+row('排班请假','核对技师工作时段和待处理请假','s-schedule'))}`)}));

  reg('s-waiting','store','预约安排','待安排预约','待门店安排','就近安排和指定技师有不同确认规则。',pendingSeed,s=>page({title:'待安排预约',back:false,tabs:tabs('store','安排'),body:detail(`${notice('brand','calendar-clock','请在当前确认期限内完成安排，剩余 <b data-countdown="roundDeadline">30:00</b>。')}${summary(s)}${card(kv('安排方式',s.assignment==='specified'?'指定技师':'就近安排')+kv('推荐技师',D.nearest(s)?E(D.nearest(s).name):'当前无可用技师')+'<p class="reservation-note">门店安排直接确认。指定改派方案需用户确认，原期限继续保留。</p>','处理规则')}${card(row('选择可约技师','按门店、项目和可约时段筛选','s-pick')+row('发起指定改派','用户确认后才改变预约技师','s-reassign')+row('调整预约时间','新方案需用户确认','s-reschedule'))}`),foot:footer(link('选择并安排','s-pick','primary'))}));

  reg('s-pick','store','预约安排','选择预约技师','门店派单','项目不匹配或请假时段的技师不可选。',pendingSeed,s=>page({title:'选择预约技师',body:detail(`${summary(s)}${card(techOptions(s),'可安排技师')}${notice('gray','user-check','仅可安排本门店、匹配项目且该时段可约的技师。提交成功后预约变为已确认。')}`),foot:footer(button('确认安排','store-assign','primary',disabled(s.stage!=='waiting'||!D.eligibleTechs(s).length)))}));

  reg('s-reassign','store','预约变更','改派预约技师','填写调整方案','指定改派经用户确认后更新，就近安排直接确认。',confirmedSeed,s=>page({title:'改派预约技师',body:detail(`${summary(s)}${card(select('改派方式','assignmentMode',[['specified','指定技师，需用户确认'],['nearby','就近安排，直接确认']],s.assignment)+techOptions(s,{excludeCurrent:true})+reason(s,'reassignReason','改派原因（必填）'),'选择新技师')}${notice('warm','clock-3','指定改派的用户确认最多15分钟，且不能超过当前确认期限。确认前原预约继续保留。')}${notice('gray','info','原技师已有确认记录时，也须保留原记录和改派原因。')}`),foot:footer(button('提交改派方案','store-reassign','primary',disabled(!['waiting','confirmed'].includes(s.stage)||!D.eligibleTechs(s).some(t=>t.id!==s.techId))))}));

  reg('s-reassign-wait','store','预约变更','改派待确认','等待用户确认','待确认期间保留原技师和原期限。',{...confirmedSeed,assignment:'specified',proposed:{techId:'zhou'},pendingChange:{type:'reassign',fromStage:'confirmed',techId:'zhou'}},s=>page({title:'改派待确认',body:hero('等待用户确认','用户同意后才更新这笔预约。','brand','clock-3')+detail(`${summary(s)}${card(kv('原预约技师',E(appointmentTech(s).name))+kv('拟安排技师',E(D.tech(s.pendingChange?.techId||s.proposed?.techId||'zhou').name))+kv('确认剩余','<b data-countdown="pendingChange.deadline">15:00</b>')+kv('改派原因',E(s.reassignReason||'原技师时段调整，建议安排可约技师')),'改派方案')}${notice('warm','info','用户拒绝指定改派时，预约关闭并全额退款。未确认方案不会替换当前技师。')}`),foot:footer(link('返回安排','s-waiting','primary'))}));

  reg('s-reassign-result','store','预约变更','改派结果','结果记录','指定改派未同意时关闭预约并全额退款。',{...confirmedSeed,reassignResult:'accepted',techId:'zhou'},s=>{
    const rejected=s.reassignResult==='rejected'||['cancelled','closed','refunded'].includes(s.stage);
    return page({title:'改派结果',body:hero(rejected?'用户未同意改派':'改派已确认',rejected?'这笔预约已关闭，已支付金额全额退回。':'本次预约技师已更新。',rejected?'warm':'good','user-check')+detail(`${summary(s)}${card(kv('处理结果',rejected?'关闭预约，全额退款':'用户已同意或门店已直接安排')+kv('当前技师',E(appointmentTech(s).name))+(rejected?kv('退款金额',money(s.price))+kv('退款状态',s.finance==='refunded'?'已完成':'处理中'):''),'结果记录')}${notice('gray','info','新一轮处理沿用原确认规则，不额外延长原预约截止时间。')}`),foot:footer(link('返回看板','s-board','primary'))});
  });

  reg('s-reschedule','store','预约变更','调整预约时间','填写调整方案','新时间、技师和原因由用户一起确认。',confirmedSeed,s=>page({title:'调整预约时间',body:detail(`${summary(s)}${card(field('新预约日期','newDate',s.proposed?.date||s.date,'type="date" required')+select('新预约时段','newSlot',[['10:00','10:00'],['14:00','14:00'],['16:00','16:00'],['19:00','19:00'],['21:00','21:00']],s.proposed?.slot||'16:00')+select('新预约技师','newTech',D.eligibleTechs({...s,date:s.proposed?.date||s.date,slot:s.proposed?.slot||'16:00'}).map(t=>[t.id,t.name]),s.proposed?.techId||s.techId)+reason(s,'rescheduleReason','调整原因（必填）'),'新预约方案')}${notice('gray','calendar-check','用户同意前保留原预约时间和技师。跨价格时段的金额变化应先向用户说明。')}`),foot:footer(button('发送调整方案','store-reschedule','primary',disabled(s.stage!=='confirmed')))}));

  reg('s-reschedule-wait','store','预约变更','改约待确认','等待用户确认','返回或未确认不会覆盖正式预约。',{...confirmedSeed,proposed:{date:tomorrow,slot:'16:00',techId:'lin'},pendingChange:{type:'reschedule',fromStage:'confirmed',date:tomorrow,slot:'16:00',techId:'lin'}},s=>page({title:'改约待确认',body:hero('等待用户确认','确认前继续保留正式预约。','brand','clock-3')+detail(`${summary(s)}${proposedCard(s)}${card(kv('调整原因',E(s.rescheduleReason||'门店协调预约时段'))+kv('当前状态','方案待确认')+kv('确认剩余','<b data-countdown="pendingChange.deadline">15:00</b>'),'处理记录')}${notice('gray','info','用户拒绝后继续原预约；用户同意后同时更新日期、时段和技师。')}`),foot:footer(link('返回看板','s-board','primary'))}));

  reg('s-aftersale','store','售后处理','售后处理','待门店处理','主项目和加钟支付分别核对退款。',{...completedSeed,aftersale:'pending',refundDescription:'本次项目提前结束，请核对退款',requestedRefund:98},s=>{
    const pending=['pending','hq'].includes(aftersaleStatus(s));
    const careNegotiation=!aftersaleStatus(s)&&s.careOutcome==='refund';
    return page({title:'售后处理',body:detail(`${notice('warm','wallet','处理期间本次预约资金暂不可结算。请核对实际履约与退款金额。')}${summary(s)}${refundDetails(s)}${card(kv('用户说明',E(s.refundDescription||s.aftersale?.reason||(careNegotiation?s.careResult:'本次项目提前结束，请核对退款')))+field('建议退款金额','refundOffer',careNegotiation?remainingRefund(s):(s.offeredRefund??s.requestedRefund??0),'type="number" min="0" step="0.01" required')+reason(s,'refundReason','处理说明（必填）')+'<div class="actions">'+button('发送退款方案','store-refund-offer','secondary',disabled((!pending&&!careNegotiation)||remainingRefund(s)<=0))+'</div>','处理方案')}${card(reason(s,'refundRejectReason','驳回理由（驳回时必填）')+'<div class="actions">'+button('驳回申请','store-refund-reject','ghost-red',disabled(!pending))+'</div>','驳回申请')}`),foot:footer(button('同意申请金额','store-refund-approve','primary',disabled(!pending)))});
  });

  reg('s-aftersale-wait','store','售后处理','退款方案待确认','等待用户确认','店长提出部分退款时等待用户确认。',{...completedSeed,aftersale:'confirm',requestedRefund:198,offeredRefund:98},s=>page({title:'退款方案待确认',body:hero(aftersaleStatus(s)==='rejected'?'驳回结果已发送':'退款方案已发送',aftersaleStatus(s)==='rejected'?'用户可查看核实说明或申请进一步处理。':'用户确认后才执行本次退款。',aftersaleStatus(s)==='rejected'?'warm':'brand','wallet')+detail(`${summary(s)}${refundDetails(s)}${card(aftersaleStatus(s)==='rejected'?kv('门店结果','本次申请未通过')+kv('核实说明',E(s.rejectionReason||s.refundRejectReason||'门店已记录核实说明')):kv('门店退款方案',money(s.offeredRefund??98))+kv('处理说明',E(s.refundReason||'按已完成时长核对，建议部分退款'))+kv('用户确认','等待确认'),'方案详情')}${notice('gray','info','用户未确认时不能将退款方案标记为退款完成。')}`),foot:footer(link('返回看板','s-board','primary'))}));

  reg('s-aftersale-result','store','售后处理','售后结果','结果记录','退款处理中、完成及驳回状态都可查看。',{...completedSeed,finance:'refund-processing',refundAmount:98,offeredRefund:98,aftersale:'approved'},s=>{
    const rejected=aftersaleStatus(s)==='rejected';
    const done=s.finance==='refunded'||aftersaleStatus(s)==='refunded';
    return page({title:'售后结果',body:hero(rejected?'申请已驳回':done?'退款已完成':'退款处理中',rejected?'已记录驳回原因，用户可查看处理说明。':done?'款项按对应支付记录退回。':'退款处理中，结果以退款记录为准。',rejected?'warm':done?'good':'brand','wallet')+detail(`${summary(s)}${refundDetails(s)}${card(kv('本次退款',money(s.refundAmount??s.offeredRefund??98))+kv('处理说明',E(rejected?(s.rejectionReason||s.refundRejectReason||'已完成约定项目，申请说明不足'):(s.refundReason||'按协商方案处理')))+kv('资金状态',done?'已退款':rejected?'按原结算规则':'退款处理中'),'结果记录')}${notice('gray','info','主项目和各次加钟分别退款，同笔支付不会重复退回。')}`),foot:footer(link('返回看板','s-board','primary'))});
  });

  reg('s-schedule','store','排班请假','门店排班','排班总览','本门店技师和请假待办集中显示。',{},s=>page({title:'门店排班',back:false,tabs:tabs('store','排班'),body:detail(`${card(D.techs.filter(t=>t.storeId===s.storeId).map(t=>`<div class="book-row">${avatar(t.name)}<div class="grow"><strong>${E(t.name)}</strong><p>09:00–23:00 · 休息 12:00–13:00</p><p>${D.overlapsLeave(s,t.id)?'预约时段请假中':'按排班可约'}</p></div>${badge(D.overlapsLeave(s,t.id)?'请假':'可约',D.overlapsLeave(s,t.id)?'warm':'good')}</div>`).join(''),'技师排班')}${card(row('请假申请',s.leaveStatus==='pending'?'1笔等待处理':'查看最近申请','s-leave-review'))}${notice('gray','calendar-days','批准请假只处理申请技师与重叠时段的已确认预约。')}`)}));

  reg('s-leave-review','store','排班请假','处理请假','待门店确认','普通和紧急请假均保留批准或驳回理由。',{...confirmedSeed,leaveStatus:'pending',leaveDetails:{techId:'lin',startDate:tomorrow,endDate:tomorrow,start:'13:00',end:'17:00',type:'urgent',reason:'处理紧急个人事项'}},s=>page({title:'处理请假',body:detail(`${leaveDetails(s)}${card(kv('当前预约',E(s.date+' '+s.slot))+kv('预约技师',E(appointmentTech(s).name))+kv('影响判定',s.stage==='confirmed'&&D.tech(s.leaveDetails?.techId||'lin').id===s.techId?'批准时检查预约是否重叠':'本次预约无需调整')+'<p class="reservation-note">仅已确认、匹配申请技师且时间重叠的预约重新安排，其他预约保持原状态。</p>','预约影响')}${card(reason(s,'leaveRejectReason','未通过理由（驳回时必填）'),'门店说明')}${notice('warm','calendar-clock','紧急请假批准后立即按申请时段生效；受影响的预约继续按原期限处理。')}`),foot:footer(button('未通过','reject-leave','secondary',disabled(s.leaveStatus!=='pending')),button('批准请假','approve-leave','primary',disabled(s.leaveStatus!=='pending')))}));

  reg('s-leave-result','store','排班请假','请假处理结果','结果记录','请假结果与受影响预约处理一致。',{leaveStatus:'approved',leaveDetails:{techId:'lin',startDate:tomorrow,endDate:tomorrow,start:'13:00',end:'17:00',type:'urgent',reason:'处理紧急个人事项'}},s=>{
    const [title,desc,tone]=leaveResultText(s);
    return page({title:'请假处理结果',body:hero(title,desc,tone,'calendar-check')+detail(`${leaveDetails(s)}${card(kv('处理结果',s.leaveStatus==='rejected'?'未通过':'已批准')+kv('预约处理',s.leaveStatus==='rejected'?'原预约继续保留':s.stage==='waiting'?'重叠预约进入重新安排':'不重叠预约保留原状态')+(s.leaveStatus==='rejected'?kv('门店理由',E(s.leaveRejectReason||'请先协商已有预约的处理安排')):''),'处理记录')}`),foot:footer(link('返回排班','s-schedule','primary'))});
  });

  reg('s-care','store','客服协助','客服待办','待门店处理','异常预约资金冻结并记录处理方式。',{stage:'care',paid:true,finance:'blocked',careOpen:true,careReason:'项目中出现异常，请门店协助'},s=>page({title:'客服待办',back:false,tabs:tabs('store','待办'),body:detail(`${notice('warm','shield-alert','当前预约需要协助，处理结束前资金暂不可结算。')}${summary(s)}${card(kv('发起说明',E(s.careReason||'预约需要门店协助'))+select('处理方式','careOutcome',[['','请选择处理方式'],['continue','继续本次预约'],['terminate','结束本次预约'],['refund','进入退款协商']],s.careOutcome||'')+textarea('处理结果（必填）','careResult',s.careResult||'','required maxlength="500" placeholder="请记录沟通结果和处理依据"')+check('已核对用户与技师，双方可以继续','continueCare',false),'客服处理')}${card(row('售后申请','查看退款申请和金额方案','s-aftersale')+row('请假待办','核对需重新安排的预约','s-leave-review'))}`),foot:footer(button('保存处理结果','close-care','primary',disabled(!s.careOpen&&s.stage!=='care')))}));

  reg('s-care-result','store','客服协助','客服处理结果','结果记录','继续、结束和退款处理保持明确状态。',{stage:'active',paid:true,finance:'paid',careOpen:false,careOutcome:'continue',careResult:'已沟通确认，双方同意继续本次预约'},s=>{
    const awaiting=s.careOpen&&s.careOutcome==='continue';
    const description=awaiting?'处理记录已保存，双方尚未确认继续，仍待核实。':s.careOutcome==='refund'?'本次预约转入售后协商，退款金额另行确认。':s.stage==='completed'?'已完成预约事实保留，按最新退款和结算记录处理。':s.careOutcome==='continue'?'双方已确认继续本次预约，计时记录保留。':'本次预约已结束，保留处理记录。';
    return page({title:'客服处理结果',body:hero(awaiting?'继续处理待核实':'处理结果已保存',description,awaiting?'warm':'good',awaiting?'clock-3':'circle-check')+detail(`${summary(s)}${card(kv('处理方式',awaiting?'待核实后继续':s.careOutcome==='continue'?'双方确认继续':s.careOutcome==='refund'?'退款协商':'结束预约')+kv('当前状态',status(s))+kv('处理记录',E(s.careResult||'已记录沟通结果'))+kv('资金状态',s.finance==='blocked'?'暂不可结算':s.finance==='refund-processing'?'退款处理中':s.finance==='refunded'?'退款已完成':'按预约结算规则'),'处理记录')}`),foot:footer(link('返回看板','s-board',s.careOutcome==='refund'?'secondary':'primary'),s.careOutcome==='refund'?link('处理退款协商','s-aftersale','primary'):'')});
  });

  reg('s-forbidden','store','权限边界','暂无操作权限','非本门店记录','门店只能处理自己权限范围内的预约。',{},s=>page({title:'暂无操作权限',body:hero('无法处理这笔预约','请在当前门店的预约列表中选择记录。','gray','shield-alert')+detail(`${notice('gray','lock-keyhole','预约安排、资料和退款仅允许所属门店处理。')}${card(kv('当前门店',E(D.store(s.actingStoreId||s.storeId).name))+kv('可用操作','返回门店看板'),'权限说明')}`),foot:footer(link('返回看板','s-board','primary'))}));
})();
