'use strict';
// 技师、店长的补充页面；与 app.js 共用布局组件。
(() => {
  const style = document.createElement('style');
  style.textContent = `.staff-field{display:block;margin:12px 0;font-size:13px;line-height:21px}.staff-field>span{display:block;margin-bottom:5px;color:var(--muted)}.staff-field input,.staff-field select,.staff-field textarea{font:inherit;width:100%;min-width:0;box-sizing:border-box;border:1px solid #dcdfe3;border-radius:7px;background:#fff;color:var(--ink);padding:10px;min-height:44px}.staff-field textarea{min-height:92px;resize:vertical}.staff-field input[type=file]{padding:9px;font-size:12px}.staff-field input:invalid:not(:placeholder-shown){border-color:var(--red)}.staff-consent{display:flex;align-items:flex-start;gap:10px;margin:14px 0;font-size:13px;line-height:22px}.staff-consent input{width:18px;height:18px;flex:0 0 18px;margin:3px 0;accent-color:var(--brand)}.staff-radio{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:8px;padding:12px;margin:10px 0;min-height:60px}.staff-radio input{accent-color:var(--brand);width:17px;height:17px;flex-shrink:0}.staff-radio small{display:block;color:var(--muted)}.staff-radio:has(input:checked){background:var(--brand-soft);border-color:#e9b4a7}.staff-radio:has(input:disabled){background:#f6f7f8;color:#a4a8ad}.staff-links{display:flex;flex-direction:column;gap:8px}.staff-links .button{width:100%;box-sizing:border-box}.staff-note{font-size:12px;line-height:20px;color:var(--muted);margin-top:8px}.staff-label{display:flex;align-items:center;justify-content:space-between;gap:8px}.staff-form .card-title{margin-top:4px}.staff-form input[type=date],.staff-form input[type=time]{font-size:13px}.staff-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.staff-result h2{font-size:19px}.staff-result p{font-size:13px}.staff-record{font-size:13px;line-height:22px;color:#4b5159;padding:10px 0}.staff-form-error{font-size:12px;color:var(--red);margin-top:8px}.staff-file-summary{font-size:12px;line-height:19px;color:var(--green);margin-top:6px}`;
  document.head.appendChild(style);
  const go = id => `data-go="${id}"`;
  const act = name => `data-action="${name}"`;
  const field = (label, name, value = '', type = 'text', extra = '') => `<label class="staff-field"><span>${label}</span><input name="${name}" type="${type}" value="${value}" ${extra}></label>`;
  const area = (label, name, placeholder, value = '', required = true) => `<label class="staff-field"><span>${label}${required ? '（必填）' : '（选填）'}</span><textarea name="${name}" placeholder="${placeholder}" ${required ? 'required' : ''} maxlength="500">${value}</textarea></label>`;
  const select = (label, name, options) => `<label class="staff-field"><span>${label}</span><select name="${name}" required>${options.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}</select></label>`;
  const file = (label, name, accept = 'image/*', extra = '') => `<label class="staff-field"><span>${label}</span><input type="file" name="${name}" accept="${accept}" ${extra}><span class="staff-file-summary" data-file-summary="${name}" hidden></span></label>`;
  const consent = (name, text) => `<label class="staff-consent"><input type="checkbox" name="${name}" required><span>${text}</span></label>`;
  const form = (id, html) => `<form id="${id}" class="staff-form" novalidate>${html}<div class="staff-form-error" role="alert" hidden></div></form>`;
  const card = html => `<section class="card">${html}</section>`;
  const screen = (title, body, foot = '', tabs = '') => page({time:'14:20', header:nav(title), body:`<div class="detail">${body}</div>`, foot, tabs});
  const orderShort = () => card(kv('订单编号', 'TL2026100200132') + kv('服务项目', '舒缓放松 · 60分钟') + kv('预约时间', '10月2日 14:00–15:00') + kv('技师', '林师傅') + kv('服务门店', '天俪·示例门店'));
  const result = (title, desc, details, buttons, tone = 'green', icon = 'circle-check') => page({time:'14:20', header:nav(title), body:hero(title, desc, tone, icon) + `<div class="detail">${details}</div>`, foot:footer(...buttons)});
  const add = (id, role, group, title, state, caption, ref, fn) => { S[id] = fn; window.SCREENS.push({id, role, group, title, state, caption, ref}); };
  const techGroup = '技师端 · 资料与排班';
  const orderGroup = '技师端 · 订单与申诉';
  const storeGroup = '店长小程序 · 处理与结果';

  add('t-onboarding-edit','tech',techGroup,'入驻资料','填写与上传','填写资质、保险有效期并上传工装照，审核通过后才能接单。','12 §2 · 05 §3',() => screen('入驻资料',
    notice('gray','badge-check','已匹配结业名单：林师傅 · 2024 年第 6 期。资料提交集团审核，审核通过后分配门店。') +
    form('staff-onboarding', card(`<div class="card-title">实名与核身</div>${kv('实名核验', '尚未完成')}${B('去实名与人脸核身','secondary full',go('t-identity-consent'))}`) +
    card(`<div class="card-title">培训证书</div>${field('证书编号','certificateNo','TL-2024-06-0132','text','required')}${file('证书照片（必填）','certificateFile','image/*','required')}${consent('publicCertificate','我同意对用户展示证书编号及审核通过的证书公开部分。')}`) +
    card(`<div class="card-title">意外保险</div>${field('保险公司','insuranceCompany','示例保险公司','text','required')}${field('保单号','policyNo','','text','required placeholder="填写完整保单号"')}${field('保障范围','insuranceCoverage','意外伤害、意外医疗','text','required')}<div class="staff-two">${field('生效日期','insuranceStart','2026-10-01','date','required')}${field('到期日期','insuranceEnd','2027-03-31','date','required')}</div>${file('保单（必填）','policyFile','image/*,.pdf','required')}`) +
    card(`<div class="card-title">展示资料</div>${file('统一工装正面照片（必填）','uniformFile','image/*','required')}${area('个人介绍','bio','介绍擅长项目和服务经验','擅长肩颈与全身舒缓放松。',false)}<p class="staff-note">照片与介绍审核通过后展示；离职后下架。不可使用生活照或夸大疗效的描述。</p>`)),
    footer(B('提交资料审核','primary',act('staff-onboarding-submit')))));

  add('t-identity-consent','tech',techGroup,'实名与人脸核身','单独同意','身份证号和人脸分别授权，未同意不能启动相应核验。','05 §3、§5 · 12 §2',() => screen('实名与人脸核身',
    notice('gray','shield-check','核验用于确认入驻身份。平台保存核验结果与流水号，不保存人脸图像，后台不展示身份证号明文。') +
    form('staff-identity',card(field('真实姓名','realName','林师傅','text','required') + field('身份证号','identityNo','','text','required minlength="18" maxlength="18" placeholder="填写本人身份证号"') +
      consent('identityConsent','我单独同意平台为实名核验处理本人的身份证号。') + consent('faceConsent','我单独同意为人脸核身处理本人的人脸信息，并已阅读人脸信息处理说明。') + `<p class="staff-note">可在隐私设置撤回同意，撤回后对应功能不可用；未核验通过不能接单。</p>`)),
    footer(B('同意并开始核验','primary',act('staff-identity-submit')))));

  add('t-onboarding-rejected','tech',techGroup,'入驻审核结果','需补充资料','逐项显示集团驳回理由，可补交后重新审核。','12 §2',() => result('资料审核未通过','请按审核意见补充资料，审核通过前不能接单。',
    card(`<div class="card-title">需要修改的资料</div><div class="staff-record"><strong>保单：保障范围页缺失</strong><p class="staff-note">请补充包含保险公司、保单号、保障范围与有效期的完整保单。</p></div><div class="staff-record"><strong>工装照片：照片模糊</strong><p class="staff-note">请重新上传清晰的正面工装照片。</p></div>${kv('审核时间','10月2日 11:10')}`),[B('联系集团客服','secondary',act('contact-support')),B('补充资料','primary',go('t-onboarding-supplement'))],'warm','file-warning'));
  add('t-onboarding-supplement','tech',techGroup,'补充入驻资料','重新提交','保留已通过资料，针对驳回项补交保单和工装照片。','12 §2',() => screen('补充入驻资料',
    notice('warm','file-warning','证书与实名已通过，本次仅需重新提交保单和工装照片。') + form('staff-supplement',
    card(file('完整保单（必填）','supplementPolicy','image/*,.pdf','required') + file('清晰工装照片（必填）','supplementUniform','image/*','required') + area('补充说明','supplementNote','说明本次修改内容','',false))),
    footer(B('重新提交审核','primary',act('staff-supplement-submit')))));
  add('t-onboarding-approved','tech',techGroup,'入驻审核结果','已通过','展示分配门店和接单资格，自动开通分销身份。','12 §2 · 04 §2',() => result('审核已通过','已分配门店，可以开始接单。',
    card(kv('门店','天俪·示例门店') + kv('接单状态',badge('在岗','good')) + kv('保单有效期','至 2027-03-31') + kv('分销身份','技师分销员 · 已开通')),
    [B('设置排班','secondary',go('t-roster-edit')),B('进入工作台','primary',go('t-work'))]));

  add('t-roster-edit','tech',techGroup,'设置排班','时段校验','可约时段不覆盖已接订单及前后缓冲，休息段内不接新单。','02 §4 · 12 §2',() => screen('设置排班',
    form('staff-roster',card(field('排班日期','rosterDate','2026-10-02','date','required') + `<div class="staff-two">${field('开始时间','rosterStart','09:00','time','required')}${field('结束时间','rosterEnd','21:00','time','required')}</div>` +
    `<div class="card-title">休息时段（选填）</div><div class="staff-two">${field('休息开始','breakStart','','time')}${field('休息结束','breakEnd','','time')}</div>`) +
    card(`<div class="card-title">已有订单占用</div>${kv('尾号 0132','13:30–15:30')}${kv('尾号 0158','16:30–18:30')}<p class="staff-note">占用含服务前后各 30 分钟路程；修改排班不能让已接订单失去服务时段。需要处理这些订单，请先申请请假。</p>`)),
    footer(B('保存排班','primary',act('staff-roster-save')))));
  add('t-leave-apply','tech',techGroup,'申请请假','填写申请','普通请假先处理已有订单；当天紧急请假由店长审批后自动移入待派单。','12 §2',() => screen('申请请假',
    form('staff-leave',card(select('请假类型','leaveType',[['normal','普通请假'],['urgent','当天紧急请假']]) + `<div class="staff-two">${field('开始日期','leaveDate','2026-10-05','date','required')}${field('结束日期','leaveEndDate','2026-10-05','date','required')}</div><div class="staff-two">${field('开始时间','leaveStart','09:00','time','required')}${field('结束时间','leaveEnd','21:00','time','required')}</div>` + area('请假原因','leaveReason','请说明请假原因')) +
    notice('warm','calendar-clock','请假申请提交后仍需正常履行已有订单。普通请假在受影响订单处理完后才能获批；当天紧急请假批准后，已有订单交由店长改派。')),
    footer(B('提交请假申请','primary',act('staff-leave-submit')))));
  add('t-leave-approved','tech',techGroup,'请假结果','已批准','显示批准时段，假期内停止接单，结束后恢复在岗。','12 §2',() => result('请假已批准','请假时段内不会收到新订单。假期结束后恢复在岗。',
    card(kv('请假时段','10月5日 09:00–21:00') + kv('审批人','张店长') + kv('已有订单','已完成改派')),
    [B('查看排班','primary',go('t-schedule'))]));
  add('t-leave-rejected','tech',techGroup,'请假结果','已驳回','展示审批理由，保留原排班和履约责任，可重新申请。','12 §2',() => result('请假未批准','原排班保持不变，请继续履行已接订单。',
    card(kv('申请时段','10月5日 09:00–21:00') + `<div class="staff-record"><strong>驳回原因</strong><p>受影响的订单尚未找到可用技师，请与店长沟通后重新申请。</p></div>`),
    [B('联系门店','secondary',act('contact-store')),B('重新申请','primary',go('t-leave-apply'))],'warm','calendar-x'));
  add('t-leaving','tech',techGroup,'离职交接','停止接新单','显示订单改派与当月提成结清进度，可提现佣金保留。','12 §2 · 04 §2',() => screen('离职交接',
    notice('warm','clipboard-list','已停止接新单。门店正在处理订单改派与提成结清，完成交接后账号转为普通用户。') +
    card(kv('申请状态','交接中') + kv('已接订单','2 笔 · 待门店改派') + kv('本月提成','¥1,286.40 · 待结清') + kv('可提现佣金','¥186.40') + `<p class="staff-note">离职后证书照片下架，分销身份失效；已可提现佣金仍可提现。</p>`),
    footer(B('联系门店','secondary',act('contact-store')),B('查看提成台账','primary',go('t-income')))));
  add('t-left','tech',techGroup,'离职结果','交接完成','账号转普通用户；展示订单已改派、提成已结清和佣金提现入口。','12 §2 · 04 §2',() => result('离职交接已完成','账号已转为普通用户，技师接单和分销推广资格已关闭。',
    card(kv('已接订单','全部已改派') + kv('当月提成','已结清') + kv('证书照片','已下架') + kv('可提现佣金','¥186.40')),
    [B('提现佣金','secondary',go('u-withdraw')),B('进入用户首页','primary',go('u-home'))]));

  add('t-service-info','tech',orderGroup,'客服介入','补充现场说明','中止后可补充证据，24 小时内核实，核实前暂停分账。','02 §9 · 05 §1',() => screen('客服介入',
    notice('warm','headset','订单已进入客服介入。可以离开现场；如仍有危险，继续使用安全求助或直接拨打 110。核实前暂停分账。') +
    orderShort() + form('staff-service-info',card(kv('中止原因','用户提出不当要求') + area('现场说明','serviceInfo','请说明现场情况、已采取措施和离开时间') + file('补充图片（最多 6 张）','serviceEvidence','image/*','multiple'))) +
    card(`<div class="staff-links">${B(I('shield-alert')+'安全求助','ghost-red',go('u-sos'))}${B('直接拨打 110','secondary',act('dial-110'))}</div>`),
    footer(B('联系集团客服','secondary',act('contact-support')),B('提交说明','primary',act('staff-service-info-submit')))));
  add('t-service-info-sent','tech',orderGroup,'客服介入','说明已提交','说明留存，等待客服核实，现场求助继续可用。','02 §9 · 05 §1',() => result('说明已提交','集团客服将在中止后的 24 小时内核实双方说明与服务记录。',orderShort() + notice('gray','info','核实前不预判责任，不自动扣费或结算。需要补充信息时，客服会联系你。'),
    [B('安全求助','ghost-red',go('u-sos')),B('返回工作台','primary',go('t-work'))],'warm','headset'));
  add('t-complaint-info','tech',orderGroup,'售后投诉','补充说明','技师能查看投诉内容并补充证据，不显示完成后的详细地址。','11 §1 · 05 §4',() => screen('售后投诉',
    card(kv('订单尾号','0117') + kv('投诉类型','时长不足') + kv('用户诉求','退款 ¥98.00') + `<div class="staff-record">用户反馈：实际服务约 50 分钟，比预约 60 分钟少了约 10 分钟。</div>`) +
    notice('gray','info','门店先处理售后，用户不接受可申请集团介入。你可以补充服务经过、打卡时间与证据。') +
    form('staff-complaint',card(area('服务经过','complaintInfo','请说明开始、结束时间及提前结束原因') + file('补充图片（最多 6 张）','complaintEvidence','image/*','multiple'))),
    footer(B('提交说明','primary',act('staff-complaint-submit')))));
  add('t-complaint-sent','tech',orderGroup,'售后投诉','说明已提交','显示已提交时间，后续结果由门店或集团通知。','11 §1',() => result('售后说明已提交','门店和集团客服可查看你的说明，处理结果会通知你。',card(kv('订单尾号','0117') + kv('提交时间','10月3日 14:20') + kv('售后状态','门店处理中')),[B('返回工作台','primary',go('t-work'))]));

  add('t-extension-wait','tech',orderGroup,'加钟等待支付','锁定 5 分钟','未支付前保持原结束时间，技师不能连续叠加发起加钟。','02 §7',() => techDetail('14:20',hero('等待用户支付加钟','新增 30 分钟 · ¥149。后续时段保留 <b>04分36秒</b>，付款前仍按原订单结束时间服务。','warm','timer'),
    [customerCard(true),techServiceCard(),card(kv('原结束时间','15:00') + kv('支付后结束时间','15:30') + kv('本次加钟','30 分钟 · ¥149.00') + kv('已支付加钟次数','0 / 2') + notice('gray','info','超时自动放弃本次加钟并释放锁定时段；不会影响正在进行的主订单。'))],
    footer(B('安全求助','ghost-red',go('u-sos')),B('再次发起加钟','secondary','disabled'),B('结束服务','secondary',go('t-finish')))));
  add('t-extension-expired','tech',orderGroup,'加钟结果','支付超时','超时释放后续时段，主订单继续，不能显示为加钟成功。','02 §7',() => result('本次加钟已过期','用户未在 5 分钟内付款，后续时段已释放。主订单继续，仍按 15:00 结束。',orderShort(),[B('返回服务中','primary',go('t-o-serving'))],'gray','timer-off'));
  add('t-noshow-confirm','tech',orderGroup,'标记用户爽约','到达超过 15 分钟','只有到达满 15 分钟且联系不上用户才可提交，需店长确认。','02 §8 · 11 §4',() => screen('标记用户爽约',
    notice('warm','user-x','13:58 到达，当前 14:14，已等待 16 分钟。提交后由店长联系核实，未确认前不自动扣费。') +
    orderShort() + form('staff-noshow',card(kv('联系记录','14:00、14:08 已拨打虚拟号码，未接听') +
    consent('noshowChecked','已等待至少 15 分钟，且多次联系仍联系不上用户。') + area('现场说明','noshowReason','请说明等待和联系情况') + file('现场凭证（选填）','noshowEvidence','image/*','multiple'))) +
    `<p class="staff-note">店长确认后，扣费 ¥59.60、退款 ¥238.40，并计入用户爽约次数。</p>`,
    footer(B('联系客户','secondary',act('contact-customer')),B('提交店长确认','primary',act('staff-noshow-submit')))));
  add('t-noshow-wait','tech',orderGroup,'爽约核实','店长待确认','待确认时不提前扣费，保留联系与求助。','02 §8',() => result('等待店长核实','店长将联系用户并核实到达、等待与通话记录。确认前不会按爽约结算。',orderShort(),[B('安全求助','ghost-red',go('u-sos')),B('联系门店','secondary',act('contact-store'))],'warm','hourglass'));
  add('t-noshow-result','tech',orderGroup,'爽约结果','店长已确认','显示扣费、退款及技师补偿，完成后隐藏客户详细地址。','02 §8 · 03 §6.3 · 05 §4',() => result('用户爽约已确认','订单已取消，用户扣费和退款按取消规则处理。',
    card(kv('订单尾号','0132') + kv('实付金额','¥298.00') + kv('用户扣费','¥59.60') + kv('原路退款','¥238.40') + kv('技师补偿','¥29.80 · 待结算') + kv('确认人','张店长')),
    [B('查看收入','secondary',go('t-income')),B('返回工作台','primary',go('t-work'))]));
  add('t-noshow-rejected','tech',orderGroup,'爽约结果','未成立','展示核实理由，继续履约或联系客服，不自动扣费。','02 §8',() => result('本次爽约未成立','用户已与门店联系，尚未达到无法服务的情况，请与店长确认下一步。',
    card(kv('订单尾号','0132') + `<div class="staff-record">核实说明：用户已到门口，请联系后继续服务。未执行取消扣费，也未计入爽约次数。</div>`),
    [B('联系门店','secondary',act('contact-store')),B('返回到达页','primary',go('t-o-arrived'))],'warm','info'));

  const appealForm = (kind) => screen(kind === 'review' ? '评价申诉' : '处罚申诉',
    card(kind === 'review' ? `${kv('订单尾号','0117')}${kv('评价','2 星 · 9月30日')}<div class="staff-record">“迟到了几分钟”</div>` : `${kv('处罚','警告 · 迟到')}${kv('处理时间','9月12日')}${kv('处理门店','天俪·示例门店')}`) +
    notice('gray','scale',kind === 'review' ? '1–2 星评价可在 7 天内申诉一次。门店初审、集团终审；成立后隐藏评价并移出评分。' : '每次处罚结果可以申诉一次，由集团复核。审核期间按原处理状态执行。') +
    form(`staff-${kind}-appeal`,card(area('申诉理由',`${kind}AppealReason`,'请说明事实及希望复核的内容') + file('证明图片（最多 6 张）',`${kind}AppealEvidence`,'image/*','multiple'))),
    footer(B('提交申诉','primary',act(`staff-${kind}-appeal-submit`))));
  add('t-review-appeal','tech',orderGroup,'评价申诉','填写材料','每单差评 7 天内只能申诉一次，提供理由与证据。','11 §3',() => appealForm('review'));
  add('t-review-appeal-wait','tech',orderGroup,'评价申诉进度','审核中','门店初审后集团终审，不能重复提交。','11 §3',() => result('评价申诉审核中','已提交至门店初审，随后由集团终审。此条评价不能重复申诉。',
    card(kv('订单尾号','0117') + kv('提交时间','10月2日 14:20') + kv('审核进度','门店初审中')),[B('返回档案','primary',go('t-profile'))],'warm','hourglass'));
  add('t-review-appeal-accepted','tech',orderGroup,'评价申诉结果','成立 · 已隐藏','终审成立后隐藏评价，移出近 90 天评分。','11 §3',() => result('评价申诉成立','集团终审已通过，该条评价已隐藏，不再计入评分。',
    card(kv('订单尾号','0117') + kv('审核结果','成立') + `<div class="staff-record">核实依据：定位和到达打卡显示按时到达，原评价中的迟到内容与记录不符。</div>`),[B('查看我的档案','primary',go('t-profile'))]));
  add('t-review-appeal-rejected','tech',orderGroup,'评价申诉结果','维持原评价','显示集团终审理由，不能再次申诉同一评价。','11 §3',() => result('维持原评价','集团已终审，本条评价继续展示并计入评分，不可再次申诉。',
    card(kv('订单尾号','0117') + `<div class="staff-record">核实理由：到达打卡和通话记录支持用户反馈，现有证据不足以撤销评价。</div>`),[B('返回档案','primary',go('t-profile'))],'gray','file-check'));
  add('t-penalty-appeal','tech',orderGroup,'处罚申诉','填写材料','每次处罚可向集团申诉一次。','11 §2',() => appealForm('penalty'));
  add('t-penalty-appeal-wait','tech',orderGroup,'处罚申诉进度','集团复核中','处罚审核中仍按原处罚状态执行，不能重复提交。','11 §2',() => result('处罚申诉复核中','集团将核实处罚依据和申诉材料，结果会通过消息通知。',
    card(kv('原处罚','警告 · 迟到') + kv('当前状态','集团复核中') + kv('申诉次数','1 / 1')),[B('返回档案','primary',go('t-profile'))],'warm','scale'));
  add('t-penalty-appeal-result','tech',orderGroup,'处罚申诉结果','撤销处罚','保留复核记录，撤销处罚；停单恢复须满足其他资格。','11 §2 · 12 §2',() => result('集团已撤销本次处罚','已更正处罚记录，原处理和申诉记录保留备查。',
    card(kv('原处罚','警告 · 迟到') + `<div class="staff-record">复核说明：预约变更通知未及时送达，已核实为系统通知异常，不计入技师投诉次数。</div>`) + notice('gray','info','如同时因保单到期或其他处罚停单，仍需满足对应恢复条件。'),[B('查看档案','primary',go('t-profile'))]));

  add('s-alerts','store',storeGroup,'门店告警','求助、售后与异常待办','安全求助优先，独立列出售后和爽约待确认。','01 §5.4 · 05 §1 · 11 §1',() => page({time:'14:20',header:nav('门店告警',false),body:
    `<div class="detail"><section class="sos-alert" role="alert"><div class="alert-heading">${I('siren')}安全求助 · 待接报<time>01:52 后升级</time></div><p>林师傅 · 订单尾号 0126 · 雅园小区</p><p class="sub">门店与集团同时接报；接报后继续联系处理并记录结果。</p><div class="actions">${B('立即接报','white',act('store-sos-ack'))}${B('直接拨打 110','ghost',act('dial-110'))}</div></section>` +
    card(`<div class="card-title">售后待办 ${badge('2','warm')}</div><div class="list-row"><div class="grow">尾号 0117 · 时长不足<p>用户诉求退款 ¥98 · 剩余 18小时40分</p></div>${B('处理','soft',go('s-aftersale'))}</div><div class="list-row"><div class="grow">尾号 0109 · 技师态度<p>集团介入中 · 可补充说明</p></div>${B('补充','secondary',go('s-aftersale-supplement'))}</div>`) +
    card(`<div class="card-title">履约异常</div><div class="list-row"><div class="grow">用户爽约待确认 · 尾号 0132<p>技师已到达 16 分钟，联系记录已提交</p></div>${B('核实','soft',go('s-noshow-review'))}</div><div class="list-row"><div class="grow">未按时出发 · 尾号 0144<p>周师傅 · 已过预约开始时间</p></div>${B('改派','secondary',go('s-reassign-nearby'))}</div>`) +
    card(`<div class="card-title">人员待办</div><div class="list-row"><div class="grow">紧急请假 · 林师傅<p>今天全天 · 2 笔受影响订单</p></div>${B('审批','soft',go('s-schedule'))}</div>`) + '</div>',tabs:tabbar('store','告警','告警')}));

  const reassign = designated => screen(designated ? '指定技师改派' : '已接订单改派',
    card(kv('订单尾号',designated ? '0161' : '0144') + kv('原技师','林师傅') + kv('预约时间','今天 17:00–18:00') + kv('派单方式',designated ? '指定技师' : '就近安排')) +
    form('staff-reassign',card(`<div class="card-title">同门店可用技师</div><label class="staff-radio"><input type="radio" name="nextTech" value="chen" checked required><span>陈师傅 ${badge('可约','good')}<small>1.8km · ★4.8 · 符合性别偏好 · 保单有效</small></span></label><label class="staff-radio"><input type="radio" name="nextTech" value="zhou"><span>周师傅 ${badge('可约','good')}<small>3.1km · 新技师 · 保单有效</small></span></label><label class="staff-radio"><input type="radio" name="nextTech" disabled><span>李师傅 ${badge('时段冲突')}<small>16:30–18:30 已有订单，不能选择</small></span></label>` +
    area('改派原因','reassignReason','请填写原技师无法服务的原因')) + notice('warm','repeat',designated ? '指定技师订单：提交后用户需在 15 分钟内同意，且不能超过本轮派单截止；拒绝或超时自动全额退款。同意后门店派单直接进入已接单。' : '就近安排订单：无需用户确认，新技师须符合性别偏好；门店改派成功后直接进入已接单，并通知用户和技师。')),
    footer(B(designated ? '发送用户确认' : '确认改派','primary',act(designated ? 'store-reassign-designated' : 'store-reassign-nearby'))));
  add('s-reassign-designated','store',storeGroup,'指定技师改派','选择新技师','同门店改派，选中可用技师后发给用户确认。','02 §5',() => reassign(true));
  add('s-reassign-nearby','store',storeGroup,'已接订单改派','就近安排','新技师满足用户偏好，门店改派成功后直接已接单并通知双方。','02 §5',() => reassign(false));
  add('s-reassign-wait','store',storeGroup,'改派进度','待用户确认','15 分钟确认，不得将待确认显示为改派成功。','02 §5',() => result('等待用户确认改派','用户剩余 14分32秒；拒绝或超时则全额退款。',card(kv('订单尾号','0161') + kv('原技师','林师傅') + kv('待确认技师','陈师傅') + kv('原预约时间','今天 17:00–18:00')),[B('返回今日订单','primary',go('s-orders'))],'warm','hourglass'));
  add('s-reassign-result','store',storeGroup,'改派进度','已接单','门店派单直接生效，指定改派需先取得用户同意。','02 §3、§5',() => result('派单已完成','门店已确认陈师傅履约，订单进入已接单，已通知用户与技师。',card(kv('订单尾号','0161') + kv('技师','陈师傅') + kv('状态','已接单 · 待出发') + kv('预约时间','今天 17:00–18:00')),[B('返回派单','primary',go('s-dispatch'))]));
  add('s-reassign-refunded','store',storeGroup,'改派结果','用户拒绝或超时','指定技师改派未获同意，取消订单并全额退款。','02 §5',() => result('改派未获确认','订单已取消并发起全额原路退款，锁定的新时段已释放。',card(kv('订单尾号','0161') + kv('取消原因','用户未同意更换指定技师') + kv('退款金额','¥298.00') + kv('退款状态','处理中')),[B('返回今日订单','primary',go('s-orders'))],'gray','rotate-ccw'));

  add('s-reschedule-apply','store',storeGroup,'门店发起改约','填写方案','门店改约需用户同意，不占用户改约次数，拒绝时保持原约。','02 §6 · 12 §1',() => screen('门店发起改约',
    orderShort() + form('staff-store-reschedule',card(field('新日期','storeRescheduleDate','2026-10-03','date','required') + select('同价可约时段','storeRescheduleSlot',[['14:00','14:00–15:00 · ¥298'],['16:00','16:00–17:00 · ¥298']]) +
    select('技师','storeRescheduleTech',[['lin','林师傅 · 保单有效'],['chen','陈师傅 · 保单有效']]) + area('改约原因','storeRescheduleReason','请说明门店无法按原约服务的原因')) +
    notice('warm','calendar-clock','提交后等待用户 15 分钟确认，不占用户改约次数；用户拒绝或超时，保持原预约。门店确实无法履约时需按门店原因取消并全额退款。')),
    footer(B('发送改约方案','primary',act('store-reschedule-submit')))));
  add('s-reschedule-wait','store',storeGroup,'门店改约进度','待用户确认','旧预约保持，待用户同意后才执行改约。','02 §6',() => result('等待用户确认改约','剩余 14分32秒；用户拒绝或超时保持原预约。',
    card(kv('订单尾号','0132') + kv('原时间','10月2日 14:00–15:00') + kv('方案时间','10月3日 14:00–15:00') + kv('价格','¥298.00 · 不变') + kv('用户改约次数','不占用')),
    [B('返回今日订单','primary',go('s-orders'))],'warm','hourglass'));
  add('s-reschedule-result','store',storeGroup,'门店改约结果','用户已同意','新时段生效后技师重新接单，记录改约发起方。','02 §6',() => result('用户已同意改约','新预约已生效，技师需重新确认接单。',card(kv('订单尾号','0132') + kv('新预约时间','10月3日 14:00–15:00') + kv('技师','林师傅 · 待重新接单') + kv('发起方','门店') + kv('用户改约次数','未占用')),[B('返回今日订单','primary',go('s-orders'))]));
  add('s-reschedule-rejected','store',storeGroup,'门店改约结果','原预约保持','拒绝或超时保留原约，若门店无法履约需全额退款。','02 §6 · 12 §1',() => result('用户未接受改约','原预约继续有效，请按原时间安排履约。',orderShort() + notice('warm','info','若门店无法按原约服务，需按门店原因取消并全额退款，不能强制更改时间。'),[B('选择技师改派','secondary',go('s-reassign-nearby')),B('返回订单','primary',go('s-orders'))],'warm','calendar-check'));

  add('s-aftersale-reject','store',storeGroup,'驳回售后申请','理由必填','填写核实依据，提交后仍需用户确认，保留集团介入。','11 §1',() => screen('驳回售后申请',
    card(kv('订单尾号','0117') + kv('用户诉求','退款 ¥98.00') + kv('问题类型','时长不足')) +
    form('staff-aftersale-reject',card(area('驳回理由','aftersaleRejectReason','请说明核实依据，不能只写“不予退款”') + file('核实凭证（选填）','aftersaleRejectEvidence','image/*','multiple'))) +
    notice('gray','info','提交后用户 48 小时内可接受或申请集团介入；没有操作视为接受。集团裁决为最终结果。'),
    footer(B('提交驳回结果','primary',act('store-aftersale-reject')))));
  add('s-aftersale-wait','store',storeGroup,'售后处理进度','待用户确认','低于用户诉求的方案或驳回都等待用户确认，不能直接结案。','11 §1 · 03 §6.2',() => result('等待用户确认方案','用户 48 小时内可接受或申请集团介入，未操作视为接受。',
    card(kv('订单尾号','0117') + kv('用户诉求','退款 ¥98.00') + kv('门店方案','退款 ¥49.67') + kv('处理状态','待用户确认') + `<p class="staff-note">用户接受后执行退款；未确认前不扣减退款款项，不提前显示售后完成。</p>`),[B('返回告警列表','primary',go('s-alerts'))],'warm','hourglass'));
  add('s-aftersale-reject-wait','store',storeGroup,'售后处理进度','驳回待用户确认','驳回结果等待用户接受或集团介入，显示理由。','11 §1',() => result('驳回结果已发送','用户 48 小时内可接受或申请集团介入，当前售后尚未完成。',card(kv('订单尾号','0117') + kv('方案','驳回退款诉求') + `<div class="staff-record">驳回理由已送达用户，可在售后记录中查看。</div>`),[B('返回告警列表','primary',go('s-alerts'))],'warm','hourglass'));
  add('s-aftersale-supplement','store',storeGroup,'集团介入','补充门店说明','集团裁决前可补充材料，裁决后自动执行结果。','11 §1',() => screen('集团介入',notice('warm','scale','集团客服正在核实，48 小时内裁决。门店需执行最终裁决，可在裁决前补充材料。') +
    card(kv('订单尾号','0109') + kv('用户诉求','技师态度问题') + kv('当前进度','集团核实中')) + form('staff-store-supplement',card(area('门店说明','storeSupplement','说明核实经过及门店处理依据') + file('补充证据（最多 6 张）','storeSupplementEvidence','image/*','multiple'))),footer(B('提交补充材料','primary',act('store-aftersale-supplement')))));
  add('s-aftersale-supplement-sent','store',storeGroup,'集团介入','材料已提交','门店材料补充留存，等待集团最终裁决。','11 §1',() => result('补充材料已提交','集团客服可查看本次补充内容，最终裁决会通知门店。',card(kv('订单尾号','0109') + kv('状态','集团介入中')),[B('返回告警列表','primary',go('s-alerts'))]));

  add('s-leave-approved','store',storeGroup,'紧急请假结果','已批准','批准立即停止该时段接单，受影响已接单进入待派单。','12 §2',() => result('紧急请假已批准','林师傅今天停止接新单。2 笔已接订单已进入待派单池，请尽快处理。',
    card(kv('请假时段','10月2日 全天') + kv('原因','身体不适') + kv('受影响订单','0132 · 14:00；0158 · 17:00') + kv('审批人','张店长')),
    [B('返回排班','secondary',go('s-schedule')),B('处理待派单','primary',go('s-dispatch'))]));
  add('s-leave-reject','store',storeGroup,'驳回紧急请假','理由必填','驳回说明送达技师，保留原排班与已有订单。','12 §2',() => screen('驳回紧急请假',card(kv('技师','林师傅') + kv('请假时段','10月2日 全天') + kv('原因','身体不适')) +
    form('staff-leave-reject',card(area('驳回说明','leaveRejectReason','请填写与技师沟通后的处理说明'))),footer(B('确认驳回','primary',act('store-leave-reject')))));
  add('s-leave-rejected','store',storeGroup,'紧急请假结果','已驳回','告知技师原排班与已有订单保持，不能误显示自动改派。','12 §2',() => result('紧急请假已驳回','已发送理由给技师，原排班与已有订单保持。请继续关注其履约与安全情况。',card(kv('技师','林师傅') + kv('请假时段','10月2日 全天') + kv('结果','驳回说明已发送')),[B('返回排班','primary',go('s-schedule'))],'gray','calendar-x'));

  add('s-noshow-review','store',storeGroup,'用户爽约核实','店长待确认','核实到达15分钟和通话记录后才可确认，未成立时不扣费。','02 §8 · 11 §4',() => screen('用户爽约核实',
    orderShort() + card(kv('到达打卡','13:58 · 定位已记录') + kv('发起时间','14:14 · 等待 16 分钟') + kv('联系记录','14:00、14:08 拨打，未接听') + `<div class="staff-record">技师说明：已在门口等待，多次联系未接，尚未开始服务。</div>`) +
    form('staff-noshow-review',card(area('门店核实说明','noshowStoreReason','记录联系用户情况、核实依据及处理结论') + consent('noshowVerified','已核实到达后等待至少 15 分钟且联系不上用户。'))) +
    notice('warm','info','确认成立后取消订单：扣费 ¥59.60，退款 ¥238.40，计入用户爽约次数；未成立时不执行此扣费。'),
    footer(B('联系用户','secondary',act('contact-customer')),B('未成立','secondary',act('store-noshow-reject')),B('确认爽约','primary',act('store-noshow-approve')))));
  add('s-noshow-result','store',storeGroup,'用户爽约结果','已确认','显示核实结果和退款进度，取消单分账后仍显示取消。','02 §8 · 03 §6.3',() => result('用户爽约已确认','订单已取消，退款处理中。取消补偿分账后仍保留已取消的履约结果。',card(kv('订单尾号','0132') + kv('扣费','¥59.60') + kv('退款','¥238.40 · 处理中') + kv('爽约次数','已计入本次') + kv('处理人','张店长')),[B('返回告警','primary',go('s-alerts'))]));
  add('s-noshow-rejected','store',storeGroup,'用户爽约结果','未成立','取消爽约申请并通知技师，保留订单履约状态。','02 §8',() => result('爽约申请未成立','已向技师发送核实说明，订单保持已到达，继续安排履约。',card(kv('订单尾号','0132') + kv('取消扣费','未执行') + kv('爽约次数','不增加')),[B('返回告警','primary',go('s-alerts'))],'gray','file-check'));

  // 主交互脚本消费这份声明：先校验真实表单，再跳到结果状态。
  window.STAFF_ACTIONS = {
    'staff-onboarding-submit': {form:'staff-onboarding',target:'t-onboarding',extra:'identityPassed;insuranceDates;validPolicy;files'},
    'staff-identity-submit': {form:'staff-identity',target:'t-onboarding-edit',extra:'identity18;separateConsents;setIdentityPassed'},
    'staff-supplement-submit': {form:'staff-supplement',target:'t-onboarding',extra:'files'},
    'staff-roster-save': {form:'staff-roster',target:'t-schedule',extra:'startBeforeEnd;breakOutsideAcceptedOrders'},
    'staff-leave-submit': {form:'staff-leave',target:'t-schedule',extra:'startBeforeEnd;urgentMustBeToday'},
    'staff-service-info-submit': {form:'staff-service-info',target:'t-service-info-sent',extra:'max6Images'},
    'staff-complaint-submit': {form:'staff-complaint',target:'t-complaint-sent',extra:'max6Images'},
    'staff-noshow-submit': {form:'staff-noshow',target:'t-noshow-wait',extra:'arrival15Minutes;max6Images'},
    'staff-review-appeal-submit': {form:'staff-review-appeal',target:'t-review-appeal-wait',extra:'oneAppeal;max6Images'},
    'staff-penalty-appeal-submit': {form:'staff-penalty-appeal',target:'t-penalty-appeal-wait',extra:'oneAppeal;max6Images'},
    'store-reassign-designated': {form:'staff-reassign',target:'s-reassign-wait',extra:'validTech;saveTechSnapshot'},
    'store-reassign-nearby': {form:'staff-reassign',target:'s-reassign-result',extra:'validTech;saveTechSnapshot'},
    'store-reschedule-submit': {form:'staff-store-reschedule',target:'s-reschedule-wait',extra:'validSlot;saveRescheduleSnapshot'},
    'store-aftersale-reject': {form:'staff-aftersale-reject',target:'s-aftersale-reject-wait',extra:'saveReason'},
    'store-aftersale-supplement': {form:'staff-store-supplement',target:'s-aftersale-supplement-sent',extra:'max6Images'},
    'store-leave-reject': {form:'staff-leave-reject',target:'s-leave-rejected',extra:'saveReason'},
    'store-noshow-approve': {form:'staff-noshow-review',target:'s-noshow-result',extra:'arrival15Minutes;saveReason'},
    'store-noshow-reject': {form:'staff-noshow-review',target:'s-noshow-rejected',extra:'reasonOnly;saveReason'}
  };
})();
