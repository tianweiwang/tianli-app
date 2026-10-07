// Reuse the existing panels and forms. Facts and authority come from domain projections.
import {fulfilmentView,fulfilmentPolicyView} from './fulfilment.mjs';
import {resolveAccountActor} from './staff-accounts.mjs';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const d=v=>v==null?'未记录':new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const inputDate=v=>v==null?'':new Date(Number(v)+8*3600000).toISOString().slice(0,19);
const FACT={location:'实际地点与覆盖',departure:'内部出发事实',arrival:'内部到达事实',contact:'预约联系事实',cancel:'取消事实',late:'迟到事实',noshow:'爽约事实',exception:'其他履约异常'};
const STATUS={'pending-tech':'待原技师确认',reported:'已登记，待核实',confirmed:'原技师已确认',verified:'客服已核实',disputed:'有分歧，待核实',pending:'待确认安全离开',contacting:'待联系核实',escalated:'已升级集团，待接管',handling:'责任人核实中',awaiting_verification:'技师已确认，安全事项待核实',resolved:'安全事项已核实结案'};
const ENDING={normal:'正常完成',early:'提前结束',interrupted:'服务中止'};
const OUTCOME={success:'实际联系成功',failed:'实际联系失败',unknown:'结果未知，继续跟进'};
const COVERAGE={inside:'覆盖内',outside:'覆盖外',unknown:'未核实'};
const COLLECTOR={'tech-only':'技师登记事实','store-only':'门店内部记录','tech-store-confirm':'技师登记；门店补录须原技师确认'};
const panel=(title,body)=>`<section class="panel management-panel"><h2>${e(title)}</h2>${body}</section>`;
const note=(text,warning=false)=>`<p class="notice${warning?' warning':''}" role="status">${e(text)}</p>`;
const row=(label,text)=>`<div class="row"><span class="muted">${e(label)}</span><span>${e(text)}</span></div>`;
const field=(label,name,value='',type='text',attrs='required maxlength="1000"')=>`<label class="field"><span>${e(label)}</span><input type="${e(type)}" name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
const area=(label,name)=>`<label class="field wide"><span>${e(label)}</span><textarea name="${e(name)}" rows="3" required maxlength="1000"></textarea></label>`;
const select=(label,name,options,value='')=>`<label class="field"><span>${e(label)}</span><select name="${e(name)}" required><option value=""${value===''?' selected':''}>请选择</option>${options.map(([v,t])=>`<option value="${e(v)}"${String(v)===String(value)?' selected':''}>${e(t)}</option>`).join('')}</select></label>`;
const link=(label,path,cls='secondary')=>`<a class="${e(cls)}" href="#${e(path)}">${e(label)}</a>`;
const detail=(label,body)=>`<details class="action-details"><summary>${e(label)}</summary><div class="stack">${body}</div></details>`;
const form=(type,payload,body,label)=>`<form class="stack" data-command="${e(type)}" data-payload="${e(JSON.stringify(payload))}"><div class="form-grid">${body}</div><div class="actions"><button type="submit" class="primary">${e(label)}</button></div></form>`;
const head=(title,body,tools='')=>`<header class="page-head"><div><h1>${e(title)}</h1><p>${e(body)}</p></div><div class="actions">${tools}</div></header>`;
const history=items=>items?.length?detail('处理历史',`<ol class="timeline">${items.map(x=>`<li><p>${e(x.action)}${x.by?.accountName?` · ${e(x.by.accountName)}`:''}</p><time>${e(d(x.at))}</time></li>`).join('')}</ol>`):'';
const author=a=>a?.accountName || ({tech:'技师本人',store:'本店主管',manager:'本店店长',group:'集团客服',user:'预约本人',system:'系统'})[a?.role] || '原作者';
const can=(options,command)=>!options?.canCommand || options.canCommand(command);
const base=(v,extra={})=>({bookingId:v.bookingId,bookingToken:v.bookingToken,version:v.version,...extra});
const timeField=(value,label='实际发生时间')=>field(label,'occurredAt',inputDate(value),'datetime-local','required step="1"');
function positionFields(){return select('位置依据方式','positionMode',[['none','不记录位置'],['manual','实际地点人工说明'],['gps','已取得真实定位结果'],['failed','定位失败，保留人工替代依据']],'none')+field('实际地点说明（人工或定位必填）','place','','text','maxlength="500"')+field('真实纬度（选填，须单独同意）','lat','','number','min="-90" max="90" step="any"')+field('真实经度（选填，须单独同意）','lng','','number','min="-180" max="180" step="any"')+field('定位失败及人工替代说明（失败时必填）','positionFailure','','text','maxlength="500"')+field('最后已知点采样时间（失败沿用坐标时必填）','lastKnownAt','','datetime-local','step="1"');}
function factFields(s,kind){return (kind?field('事实类型','kind',kind,'hidden',''):select('履约事实类型','kind',Object.entries(FACT)))+timeField(s.now)+area('事实依据与说明','evidence')+positionFields()+select('实际覆盖核验结果（地点事实必填）','coverage',Object.entries(COVERAGE),'unknown')+field('实际覆盖核验依据（地点事实必填）','coverageBasis','','text','maxlength="1000"');}
function notices(s,a,v,options){
  let body=v.notices.map(n=>`<article class="case-card">${row('告知内容',n.summary)}${row('实际结果',OUTCOME[n.outcome] || '继续人工核实')}${row('实际联系时间',d(n.occurredAt))}${row('登记时间',d(n.recordedAt))}${n.evidence?row('结果依据',n.evidence):''}${n.ack?note('预约本人已确认阅读。'):n.canAck&&can(options,'fulfilment.notice-ack')?form('fulfilment.notice-ack',base(v,{noticeId:n.id,version:n.version}),'','我已阅读此告知'):''}</article>`).join('');
  if(v.canNotify&&can(options,'fulfilment.notice-record'))body+=detail('登记预约联系或异常告知',note('按实际业务告知预约联系与异常。失败或未知结果须继续人工联系；Demo 不连接电话、短信或微信通知渠道。')+form('fulfilment.notice-record',base(v,{version:v.noticeVersion}),select('告知类型','kind',[['contact','预约联系'],['exception','预约异常']])+select('实际联系渠道','channel',[['phone','电话'],['sms','短信'],['subscription','微信订阅消息'],['in-app','程序内告知']])+select('实际联系结果','outcome',Object.entries(OUTCOME))+timeField(s.now)+area('实际告知内容','summary')+area('通知实际结果依据','evidence'),'保存实际告知记录'));
  return body?panel('预约联系与异常告知',body):'';
}
function facts(s,a,v,options){
  let body=v.facts.map(f=>{
    let content=`<article class="case-card"><div class="row"><h3>${e(FACT[f.kind] || f.kind)}</h3><span class="tag">${e(f.replacedBy?'已被后续事实更正':STATUS[f.status] || f.status)}</span></div>${row('实际发生时间',d(f.occurredAt))}${row('实际记录时间',d(f.recordedAt))}${row('实际作者',author(f.recordedBy))}${f.evidence?row('事实依据',f.evidence):''}${f.position.hidden?note('按当前权限隐藏历史地点及事实明细。'):row('实际地点',f.position.place || '未记录')}${f.position.failureReason?row('定位失败与替代',f.position.failureReason):''}${f.position.lat!=null?row('实际经纬度',`${f.position.lat}, ${f.position.lng}`):''}${f.coverage?row('覆盖核验',`${COVERAGE[f.coverage.result]} · ${f.coverage.basis}`):''}${f.replacesFactId?row('更正原事实',f.replacesFactId):''}${f.replacedBy?row('后续更正事实',f.replacedBy):''}`;
    for(const c of f.confirmations || [])content+=row('原技师意见',`${c.decision==='accept'?'确认实际发生':'不同意补录'}${c.reason?' · '+c.reason:''} · ${d(c.at)}`);
    for(const c of f.verifications || [])content+=row('客服核实',`${c.decision==='verified'?'已核实':'保留分歧'}${c.evidence?' · '+c.evidence:''} · ${d(c.at)}`);
    const p=base(v,{factId:f.id});
    if(f.canConfirm&&can(options,'fulfilment.fact-confirm'))content+=form('fulfilment.fact-confirm',p,select('确认门店补录','decision',[['accept','确认实际发生'],['reject','不同意，保留分歧']])+area('确认意见','reason'),'提交本人确认');
    if(f.canVerify&&can(options,'fulfilment.fact-verify'))content+=detail('核实事实',form('fulfilment.fact-verify',p,select('事实核实结论','decision',[['verified','证据已核实'],['disputed','仍有分歧，保留跟进']])+area('核实证据','evidence'),'保存核实结论'));
    if(f.canCorrect&&can(options,'fulfilment.fact-correct'))content+=detail('追加更正事实',note('更正追加记录，保留原事实、作者及确认历史。')+form('fulfilment.fact-correct',p,factFields(s,f.kind)+area('更正依据','reason'),'保存更正事实'));
    return content+'</article>';
  }).join('');
  if(!v.facts.length)body+=note('尚无实际履约事实；预约片区与门店坐标不能代替实际地点。');
  if(!v.policy)body+=note('采集分工尚未发布，请先完成规则决定及配置。',true);
  if(v.canRecord&&can(options,'fulfilment.fact-record'))body+=detail('登记实际履约事实',note(v.policy.collectorMode==='tech-store-confirm'&&['store','manager'].includes(a.role)?'本店补录提交后，等待原技师明确确认；客服核实不能替代其意见。':'记录真实发生时间与实际依据，不能通过此表修改原预约状态。')+form('fulfilment.fact-record',base(v),factFields(s),'保存实际事实'));
  return panel('内部履约事实',body+history(v.history));
}
function consent(v,options){if(!v.canLocationConsent||!can(options,'fulfilment.location-consent'))return '';return detail('位置用途决定',note('精确位置用于实际履约核验和安全处理，需技师本人单独同意。撤回后停止新增坐标；已产生事实及处理记录按适用保留规则办理。Demo 未接入设备定位，坐标只接受真实采样结果。')+note(v.locationConsent.active?'当前已同意位置用途。':'当前未同意位置用途。')+form('fulfilment.location-consent',base(v,{version:v.locationConsent.version}),select('本人位置用途决定','active',[['true','同意上述位置用途'],['false','不同意或撤回同意']])+area('位置用途与撤回说明','basis'),'保存本人决定'));}
function departure(s,a,v,options){
  const x=v.departure;if(!x){if(!v.unknownDeparture)return '';let body=note('历史订单未采集安全离开事实，待核实。');const source=v.endingSource;
    if(source?.available)body+=row('原结束类型',ENDING[source.endingKind])+row('原实际结束时间',d(source.endingAt))+row('原服务技师来源',source.techId)+row('原技师来源记录时间',d(source.sourceRecordedAt))+row('原来源引用',source.sourceReference);
    else if(source)body+=note(source.reason,true);
    if(v.canRecognizeHistory&&can(options,'fulfilment.departure-history'))body+=detail('补认历史安全核实事项',note('本次只绑定原结束与原技师来源，建立待核实事项。尚未确认实际安全离开，不会自动结案；后续按真实联系或现场核实证据办理。')+form('fulfilment.departure-history',base(v,{version:0,endingSourceToken:source.sourceToken}),area('原结束与原技师来源核对依据','sourceEvidence')+area('历史补认说明','reason'),'建立历史待核实事项'));
    return panel('安全离开',body);}
  const p=base(v,{departureId:x.id,version:x.version});
  let body=row('原结束类型',ENDING[x.endingKind])+row('原服务结束时间',d(x.endingAt))+row('安全离开进度',x.status==='confirmed'?'实际技师已确认安全离开':STATUS[x.status] || x.status)+row('安全联系时间',x.contactDueAt==null?'未设置，由人工值班跟进':d(x.contactDueAt))+row('集团升级时间',x.escalationDueAt==null?'未设置，由人工判断升级':d(x.escalationDueAt));
  if(x.safeLeftFact)body+=row('实际安全离开时间',d(x.safeLeftFact.occurredAt))+row('实际离开记录时间',d(x.safeLeftFact.recordedAt));
  if(x.historicalRecognition)body+=row('历史事项实际登记时间',d(x.historicalRecognition.recordedAt))+(x.historicalRecognition.sourceEvidence?row('原结束与技师核对依据',x.historicalRecognition.sourceEvidence):'')+(x.historicalRecognition.reason?row('历史补认说明',x.historicalRecognition.reason):'');
  if(x.help)body+=note(`已有离开前求助：${x.help.reason}。安全确认后仍须责任人核实。`,true);
  if(x.owner)body+=row('当前责任人',`${x.owner.accountName}${x.ownerValid===false?' · 工作授权已失效，须重新接管':''}`);
  if(!['confirmed','resolved'].includes(x.status))body+=note(x.availableDuty.length?`当前值班：${x.availableDuty.map(r=>r.accountName).join('、')}。渠道失败或结果未知时，须继续电话及人工核实。`:'当前无有效值班安排。请联系门店主管或集团客服人工处理；存在即时危险时直接拨打110。',!x.availableDuty.length);
  if(x.canHelp)body+=`<div class="actions"><a class="secondary" href="tel:110">紧急拨打110</a></div>`;
  if(x.canConfirm&&can(options,'fulfilment.departure-confirm'))body+=detail('记录实际安全离开',form('fulfilment.departure-confirm',p,select('实际离开情况','safeLeft',[['true','本人实际已经安全离开'],['false','尚未安全离开']])+timeField(s.now,'实际安全离开时间')+area('安全离开事实说明','evidence')+positionFields(),'提交安全离开事实'));
  if(x.canHelp&&can(options,'fulfilment.departure-help'))body+=detail('离开前求助',note('求助后保持人工联系；登记不表示求助消息已送达。遇到即时危险请直接拨打110。',true)+form('fulfilment.departure-help',p,area('求助情况','reason')+positionFields(),'提交离开前求助'));
  if(x.contacts.length)body+=detail('实际联系记录',x.contacts.map(c=>`<article>${row('联系结果',OUTCOME[c.outcome])}${row('安全核实结果',({'safe-left':'实际确认安全离开','not-left':'仍未离开',unknown:'尚未核实'})[c.safetyOutcome])}${row('记录时间',d(c.at))}${c.evidence?row('核实依据',c.evidence):''}</article>`).join(''));
  if(x.canContact&&can(options,'fulfilment.departure-contact'))body+=detail('记录人工联系结果',form('fulfilment.departure-contact',p,select('实际联系方式','channel',[['phone','电话'],['sms','短信'],['subscription','微信订阅消息'],['in-app','程序内联系']])+select('实际联系结果','outcome',Object.entries(OUTCOME))+select('联系核实安全结果','safetyOutcome',[['safe-left','联系成功并实际确认安全离开'],['not-left','联系成功但尚未离开'],['unknown','尚未核实']])+timeField(s.now,'实际联系时间')+area('实际联系与核实依据','evidence'),'保存联系记录'));
  if(x.canEscalate&&can(options,'fulfilment.departure-escalate'))body+=detail('人工升级集团核实',form('fulfilment.departure-escalate',p,area('升级依据','reason'),'升级集团核实'));
  if(x.canTakeover&&can(options,'fulfilment.departure-takeover'))body+=detail('以当前值班岗位接管',form('fulfilment.departure-takeover',p,area('接管依据','reason'),'本人接管安全核实'));
  if(x.canResolve&&can(options,'fulfilment.departure-resolve'))body+=detail('依据实际安全事实结案',note('本项结案只处理安全离开。原求助、服务争议和资金仍由各自流程办理。')+form('fulfilment.departure-resolve',p,select('实际安全核实方式','method',[...(x.safeLeftFact?[['tech-confirmation','沿用技师实际离开确认']]:[]),...(x.contacts.some(c=>c.outcome==='success'&&c.safetyOutcome==='safe-left')?[['contact-confirmation','实际联系成功，已确认安全离开']]:[]),['onsite-verification','已经实际现场核实']])+timeField(x.safeLeftFact?.occurredAt || s.now,'核实的实际安全离开时间')+area('安全结案核实依据','evidence'),'保存安全核实结案'));
  if(x.resolution)body+=row('核实安全时间',d(x.resolution.occurredAt))+row('实际结案记录时间',d(x.resolution.recordedAt));
  if(v.sourceIssues.length)body+=note(`原事项仍需独立跟进：${v.sourceIssues.map(x=>x.id).join('、')}。`);
  return panel('安全离开确认与核实',body+history(x.history));
}
export function fulfilmentBookingPanel(s,rawActor,bookingId,ui={},options={}){
  let a,v;try{a=resolveAccountActor(s,rawActor);v=fulfilmentView(s,a,bookingId);}catch(error){return panel('履约记录暂不可用',note(error.message,true));}if(!v)return '';
  if(a.role==='user')return notices(s,a,v,options);
  return facts(s,a,v,options)+consent(v,options)+departure(s,a,v,options)+notices(s,a,v,options);
}
function policies(s,a,v){
  let body=note('先完成业务分工与安全责任决定，再按真实批准内容发布。没有政策时不开放采集与通知，不生成新的默认联系时限。',true);
  if(v.canPublish)for(const storeId of [null,...v.storeIds]){const ps=v.policies.filter(p=>p.storeId===storeId),last=ps.sort((a,b)=>b.version-a.version)[0];body+=detail(`发布${storeId?(s.stores || []).find(x=>x.id===storeId)?.name || storeId:'集团通用'}规则`,form('fulfilment.policy-publish',{storeId,version:last?.version || 0},select('事实采集分工','collectorMode',Object.entries(COLLECTOR))+select('用户联系与异常通知','noticeMode',[['appointment-exception','记录预约联系与异常告知'],['none','暂不启用告知记录']])+select('普通未确认是否暂停结算','blockUnconfirmed',[['true','暂停，直至实际核实'],['false','按已批准规则人工跟进']])+field('联系分钟（未决定可留空）','departureContactMinutes','','number','min="0" step="1"')+field('升级分钟（未决定可留空）','escalateMinutes','','number','min="0" step="1"')+field('规则生效时间','effectiveAt',inputDate(s.now),'datetime-local','required step="1"')+area('规则依据','basis')+area('发布说明','reason'),'发布明确规则'));}
  body+=v.policies.map(p=>`<article class="case-card"><h3>${e(p.storeId?(s.stores || []).find(x=>x.id===p.storeId)?.name || p.storeId:'集团通用')} · 版本 ${e(p.version)}</h3>${row('分工',COLLECTOR[p.collectorMode])}${row('通知',p.noticeMode==='appointment-exception'?'预约联系与异常告知':'未启用')}${row('普通未确认结算',p.blockUnconfirmed?'暂停待核实':'按规则人工跟进')}${row('联系与升级分钟',`${p.departureContactMinutes??'未设置'} / ${p.escalateMinutes??'未设置'}`)}${row('规则依据',p.basis)}${row('生效时间',d(p.effectiveAt))}${row('实际发布人',author(p.publishedBy))}</article>`).join('');
  return panel('履约与安全规则',body);
}
function duty(s,a,v){
  let body=note('值班责任关联实际启用工作账号及岗位授权。没有名单时使用人工联系兜底，不能提交自由文本姓名充当值班人。');
  for(const c of v.candidates)body+=detail(`安排 ${c.accountName} · ${c.scope==='group'?'集团客服':(s.stores || []).find(x=>x.id===c.storeId)?.name || c.storeId}`,form('fulfilment.duty-save',{version:0,scope:c.scope,storeId:c.storeId,accountId:c.accountId,grantId:c.grantId},field('值班开始时间','startAt','','datetime-local','required step="1"')+field('值班结束时间','endAt','','datetime-local','required step="1"')+select('值班是否启用','enabled',[['true','启用本安排'],['false','登记暂不启用安排']])+area('值班安排依据','reason'),'保存实际值班安排'));
  if(!v.candidates.length)body+=note('暂无对应已启用工作授权，请先由账号管理员维护实际人员。',true);
  for(const r of v.rosters)body+=`<article class="case-card">${row('值班人',r.accountName)}${row('值班范围',r.scope==='group'?'集团客服':(s.stores || []).find(x=>x.id===r.storeId)?.name || r.storeId)}${row('完整值班时段',`${d(r.startAt)} 至 ${d(r.endAt)}`)}${row('安排状态',!r.enabled?'已停用':!r.valid?'账号或授权已失效':r.active?'当前有效值班':'不在当前时段')}${detail('调整此值班安排',form('fulfilment.duty-save',{id:r.id,version:r.version,scope:r.scope,storeId:r.storeId,accountId:r.accountId,grantId:r.grantId},field('值班开始时间','startAt',inputDate(r.startAt),'datetime-local','required step="1"')+field('值班结束时间','endAt',inputDate(r.endAt),'datetime-local','required step="1"')+select('值班是否启用','enabled',[['true','启用'],['false','停用']])+area('值班安排依据','reason'),'保存值班变更'))}${history(r.history)}</article>`;
  return panel('实际人工值班',body);
}
export function fulfilmentUiView(s,rawActor,route=[],ui={},options={}){
  if(route[0]!=='fulfilment')return null;let a;try{a=resolveAccountActor(s,rawActor);}catch(error){return panel('工作会话已失效',note(error.message,true));}
  const role=a.role==='manager'?'store':a.role,prefix=`/${role}/fulfilment`,v=fulfilmentPolicyView(s,a);
  if(route.length===2&&!['policies','duty'].includes(route[1])){const bookingId=decodeURIComponent(route[1]);if(!fulfilmentView(s,a,bookingId))return panel('预约不存在或无权读取','');return head(a.role==='user'?'预约联系记录':'履约与安全记录',bookingId,link('返回预约订单',`/${role}/${a.role==='user'?'booking':'bookings'}/${encodeURIComponent(bookingId)}`)+(['store','group'].includes(role)?link('返回履约列表',prefix):''))+fulfilmentBookingPanel(s,a,bookingId,ui,options);}
  if(a.role==='tech'&&route.length===1){const list=(s.bookings || []).map(b=>({b,view:fulfilmentView(s,a,b.id)})).filter(x=>x.view);return head('我的履约与安全记录','按本人实际服务来源查看记录。',link('返回我的预约','/tech/bookings'))+panel('本人预约记录',list.length?list.map(({b,view:x})=>`<article class="case-card"><div class="row"><h3>${e(b.id)}</h3>${link('查看本单记录',prefix+'/'+encodeURIComponent(b.id))}</div>${row('履约事实',`${x.facts.length} 条`)}${row('安全离开',x.unknownDeparture?'历史未采集，待核实':x.departure?x.departure.status==='confirmed'?'本人已确认实际离开':STATUS[x.departure.status] || '待核实':'服务结束后独立记录')}${!x.policy?note('本店采集分工未发布，事实登记暂未开放。'):''}</article>`).join(''):note('当前身份暂无本人预约记录。'));}
  if(!v)return panel('当前岗位无权读取履约管理','');
  const tools=link('履约记录',prefix)+link('规则与分工',prefix+'/policies')+link('人工值班',prefix+'/duty');
  if(route[1]==='policies')return head('履约与安全规则','按已批准规则明确采集、通知与安全责任。',tools)+policies(s,a,v);
  if(route[1]==='duty')return head('人工值班安排','按实际工作账号、范围与时段安排责任。',tools)+duty(s,a,v);
  const list=(s.bookings || []).map(b=>({b,view:fulfilmentView(s,a,b.id)})).filter(x=>x.view);
  return head('履约事实与安全离开','记录实际发生的事实，跟进独立安全责任。',tools)+panel('预约记录',list.length?list.map(({b,view:x})=>`<article class="case-card"><div class="row"><h3>${e(b.id)}</h3>${link('查看事实与安全',prefix+'/'+encodeURIComponent(b.id))}</div>${row('履约事实',`${x.facts.length} 条`)}${row('安全离开',x.unknownDeparture?'历史未采集，待核实':x.departure?x.departure.status==='confirmed'?'实际技师已确认':STATUS[x.departure.status] || '待核实':'服务结束后独立记录')}${x.blockers.length?note(x.blockers.join('；'),true):''}</article>`).join(''):note('当前范围暂无预约。'));
}
