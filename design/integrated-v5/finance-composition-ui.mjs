// Original-entry classification forms. Reading this panel never changes cash or audit state.
import { resolveAccountActor, actorAccountFields, canAccountView } from './staff-accounts.mjs';
import { serviceFinanceCompositionFingerprint as digest } from './service-finance-composition.mjs';
import { serviceFinanceCompositionReview, authorizedServiceFinanceCompositionFile } from './service-finance-composition-review.mjs';

const e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number.isSafeInteger(value)?'¥'+(value/100).toFixed(2):'待核对';
const date=value=>Number.isSafeInteger(value)?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3}):'待核对';
const row=(title,value)=>`<div class="row"><span class="muted">${e(title)}</span><span>${value}</span></div>`;
const note=(text,warn=false)=>`<p class="notice${warn?' warning':''}" role="status">${e(text)}</p>`;
const hidden=(name,value)=>`<input type="hidden" name="${e(name)}" value="${e(value)}">`;
const field=(title,name,required=false,max='')=>`<label class="field"><span>${e(title)}</span><input type="number" name="${e(name)}" value="" ${required?'required ':''}min="0" step="0.01" data-unit="yuan"${max!==''?` max="${e(max)}"`:''}></label>`;
const input=(title,name,max)=>`<label class="field wide"><span>${e(title)}</span><input type="text" name="${e(name)}" value="" required maxlength="${max}"></label>`;
const area=(title,name)=>`<label class="field wide"><span>${e(title)}</span><textarea name="${e(name)}" required maxlength="1000" rows="3"></textarea></label>`;
const states={confirmable:'待补核本笔组成','query-original':'先查询原现金结果','source-incomplete':'原资金事实待核','composition-conflict':'原组成存在冲突','confirmed':'本笔已有有效组成'};
const invoiceStates={pending:'待开票',issued:'已开票',rejected:'已驳回',red_pending:'待红冲',red:'已红冲'};
const upload=()=>`<div class="field wide"><label class="field"><span>逐笔分类依据文件（必填，PDF / PNG / JPEG，最大5 MiB）</span><input type="file" data-invoice-upload accept="application/pdf,image/png,image/jpeg" required></label>${hidden('fileRef','')}${hidden('fileName','')}${hidden('fileType','')}${hidden('fileSize','')}<p class="small muted" data-invoice-upload-status role="status">请选择本机实际文件；只填写依据编号或文件名不能提交。</p></div>`;

function sourceKeys(s,entryId){
  const matches=(s.serviceFinanceEntries||[]).filter(x=>x.id===entryId);if(matches.length!==1)return [];
  const entry=matches[0],keys=[];
  for(const [kind,rows] of [['split',[entry.split,...(entry.splitHistory||[])]],['return',entry.returns||[]]])for(const cash of rows.filter(Boolean))if(cash.id&&['success','processing','failed'].includes(cash.status)&&cash.amountCents!==0)keys.push(`${kind}:${cash.id}`);
  for(const debt of (s.serviceFinanceRecoveries||[]).filter(x=>x.entryId===entryId))for(const record of debt.records||[])if(debt.id&&record.id&&record.amountCents!==0)keys.push(`recovery:${debt.id}:${record.id}`);
  return [...new Set(keys)];
}
function allocationSources(view){
  const fact=view.facts;if(fact?.direction!=='return')return [];
  return (view.allocationSources||[]).filter(source=>source.known&&Number.isSafeInteger(source.hRemainingCents)&&Number.isSafeInteger(source.csRemainingCents)&&source.hRemainingCents+source.csRemainingCents>0&&source.actualAt<=fact.actualAt
    &&(!fact.incomeSourceId||source.incomeSourceId===fact.incomeSourceId&&source.incomeRequestNo===fact.incomeRequestNo)
    &&(fact.recoveryType!=='offline-adjustment'||source.sourceKind==='recovery'&&source.recoveryType==='unshared-release'));
}
function allocationFields(sources){
  return `<div class="wide">${note('逐行填写本次明确退回的原收入H/Cs。未填写行不分配金额；合计须与本笔H/Cs一致。')}${sources.map((source,i)=>`<section class="panel management-panel"><h3>原收入 ${e(source.incomeRequestNo)}</h3>${row('原收入编号',e(source.incomeSourceId))}${row('原实际发生时间',e(date(source.actualAt)))}${row('扣除其他成功退回及未知占额后平台费H',money(source.hRemainingCents))}${row('扣除其他成功退回及未知占额后推广款Cs',money(source.csRemainingCents))}${hidden(`compositionIncome:${i}`,source.incomeSourceId)}${hidden(`compositionReference:${i}`,source.incomeRequestNo)}<div class="management-grid">${field('本次从该原收入退回H（元）',`compositionH:${i}`,false,source.hRemainingCents/100)}${field('本次从该原收入退回Cs（元）',`compositionCs:${i}`,false,source.csRemainingCents/100)}</div></section>`).join('')}</div>`;
}
function form(actor,view){
  const reconcile=view.canReconcile,command=reconcile?'finance.composition-reconcile':'finance.composition-confirm',sources=allocationSources(view);
  if(view.facts.direction==='return'&&!sources.length)return note('本笔原收入组成或其他回退占额尚未核清。请先在本页核定原收入或查询其他原回退，不能默认分配H/Cs。',true);
  const payload={id:view.entryId,version:view.entryVersion,sourceKey:view.sourceKey,sourceToken:view.sourceToken,...(reconcile?{supersedes:view.supersedes}:{})};
  const identity=digest({role:actor.role,job:actor.job,...actorAccountFields(actor)}),key=`finance-composition:${identity}:${view.entryId}:${view.sourceKey}:${view.entryVersion}:${view.sourceToken}:${command}`;
  const fields=field('本笔平台费H（元）','hCents',true,view.facts.normalCents/100)+field('本笔推广款Cs（元）','csCents',true,view.facts.normalCents/100)+field('有据的保留Cs（元，可空）','retainedCsCents')+(sources.length?allocationFields(sources):'')+input('逐笔历史分类依据编号','basisReference',120)+area('逐笔历史分类依据说明','basisDescription')+area(reconcile?'更正原因':'补核原因','reason')+upload();
  return `<details class="action-details"><summary>${reconcile?'明确更正本笔组成':'补核本笔组成'}</summary>${note(reconcile?'核对下列原候选后，依据实际凭据明确更正；旧核定、原现金及已开票历史保留。':'按本笔真实历史分类填写H/Cs，合计须等于本笔正常现金，不按当前规则或比例倒算。')}<form class="management-form" data-management-form="${e(key)}" data-command="${command}" data-payload="${e(JSON.stringify(payload))}" data-live-version="${e(view.entryVersion)}" data-confirm="${e(reconcile?'确认依据实际凭据更正所示全部原候选？原现金和旧核定保留，原月票按原规则重新核对。':'确认已核实本笔真实历史分类与附件？本次只追加组成核定，原现金不变。')}"><div class="management-grid">${fields}</div><p class="management-draft-note small muted" role="status">未提交内容保留在当前标签页，提交成功后清除。</p><div class="actions"><button type="submit" class="primary">${reconcile?'提交明确更正':'提交本笔补核'}</button><button type="button" class="secondary" data-command="ui.management-discard">放弃本页草稿</button></div></form></details>`;
}
function fileBlock(s,actor,record,index,file){
  try{authorizedServiceFinanceCompositionFile(s,actor,record.id,`evidence:${index}`,file.ref);}catch{return note('原核定依据的来源或附件槽已变化，须先核原账。',true);}
  return `<div data-invoice-file="${e(file.ref)}" data-invoice-domain="service-finance-composition" data-invoice-id="${e(record.id)}" data-invoice-slot="${e(`evidence:${index}`)}"><p class="order-number">${e(file.name)} · ${e(file.type)}</p><div class="actions"><button type="button" class="btn secondary" data-invoice-action="view" aria-expanded="false" disabled>查看原分类依据</button><a class="btn secondary" data-invoice-action="download">下载原分类依据</a></div><p class="small muted" data-invoice-file-status role="status">正在读取实际文件；读取成功后可查看。</p><section class="invoice-inline-preview" data-invoice-preview role="region" aria-label="原分类依据" hidden><div class="invoice-preview-heading"><h3>原分类依据</h3><button type="button" class="btn secondary" data-invoice-action="close-preview">关闭预览</button></div><p class="small muted" data-invoice-preview-status role="status"></p><div data-invoice-preview-content></div></section></div>`;
}
function history(s,actor,view){
  const ids=new Set((view.candidates||[]).filter(x=>x.key.startsWith('ledger:')).map(x=>x.id)),records=(s.serviceFinanceCompositions||[]).filter(x=>ids.has(x.id));
  if(!records.length)return '';
  return `<details class="action-details"><summary>原核定与更正历史</summary><ol class="timeline">${[...records].reverse().map(record=>`<li>${row('原核定编号 / 版本',e(`${record.id} · v${record.version}`))}${row('核定时间',e(date(record.recordedAt)))}${row('原核定平台费H / 推广款Cs',e(money(record.hCents)+' / '+money(record.csCents)))}${row('依据编号',e(record.basisReference||'待核对'))}${row('历史分类依据说明',e(record.basisDescription))}${row('核对原因',e(record.reason))}${record.reconciliation?note('本条保存明确替代关系，旧核定仍保留。'):''}${(record.evidenceRefs||[]).map((file,index)=>fileBlock(s,actor,record,index,file)).join('')}</li>`).join('')}</ol></details>`;
}
function cashCard(s,actor,view){
  const fact=view.facts,canForm=view.canConfirm||view.canReconcile;
  let body=row('办理状态',e(states[view.state]||'原资料待核'));
  if(fact)body+=row('原实际凭据编号',e(fact.actualReference))+row('原正常现金',money(fact.normalCents))+row('原现金方向',e(fact.direction==='income'?'集团收入':'退回门店'))+row('原实际发生时间',e(date(fact.actualAt)));
  body+=(view.blockers||[]).map(x=>note(x.reason,true)).join('');
  if(view.state==='query-original')body+=note('本笔结果须沿原渠道请求查询，补核不能宣布现金成功。',true);
  const active=(view.candidates||[]).filter(candidate=>(view.supersedes||[]).some(ref=>ref.key===candidate.key&&ref.token===candidate.token));
  if(active.length)body+=`<details class="action-details"><summary>本次须核对的原组成候选</summary>${active.map(x=>row('原候选编号 / 版本',e(`${x.id} · ${x.version==null?'原请求':`v${x.version}`}`))+row('原候选H / Cs',e(money(x.hCents)+' / '+money(x.csCents)))).join('')}</details>`;
  if(canForm&&view.invoiceImpacts?.length)body+=`<details class="action-details"><summary>原门店月票</summary>${view.invoiceImpacts.map(x=>row(`${x.id} · ${x.month}`,e(invoiceStates[x.status]||'办理状态待核'))).join('')}${note('提交后由原月票规则重核实际H依据，已开票文件与历史保留。')}</details>`;
  if(canForm)body+=form(actor,view);
  else if(fact&&view.state==='confirmed')body+=note('本笔已有有效组成；当前岗位未获明确更正权限。');
  body+=history(s,actor,view);
  const title=({'split':'原分账现金','return':'原回退现金','recovery':'原实际回款'})[String(view.sourceKey).split(':')[0]]||'原现金';
  return `<article class="list-card"><h3>${e(title)}</h3>${row('原现金来源',e(view.sourceKey))}${body}</article>`;
}
export function financeCompositionReviewPanel(s,rawActor,entryId){
  let actor;try{actor=resolveAccountActor(s,rawActor);if(actor.role!=='group'||!['finance','all'].includes(actor.job)||!canAccountView(actor,'service-finance'))return '';}catch{return '';}
  let keys;try{keys=sourceKeys(s,entryId);}catch{return `<section class="panel management-panel"><h2>逐笔现金组成补核</h2>${note('原现金来源容器无效，请先核原账。',true)}</section>`;}
  if(!keys.length)return '';
  return `<section class="panel management-panel"><h2>逐笔现金组成补核</h2>${keys.map(key=>cashCard(s,actor,serviceFinanceCompositionReview(s,actor,entryId,key))).join('')}</section>`;
}
