// Report projections deliberately omit contacts, locations, case bodies and files.
import { resolveAccountActor, actorAccountFields } from './staff-accounts.mjs';
import { serviceFinanceView } from './service-finance.mjs';
import { techIncomeView } from './tech-income.mjs';
import { careView } from './service-care.mjs';
import { qualificationView } from './tech-qualification.mjs';
import { workTaskView } from './work-tasks.mjs';
import { goodsSummary } from './engine.mjs';
const clone = value => structuredClone(value);
const fail = message => { throw new Error(message); };
const col = (key,label,format='text') => ({key,label,format});
const base = [col('id','业务编号'),col('storeId','门店'),col('status','状态'),col('at','记录时间','date')];
const amounts = [col('paidCents','成功实付','money'),col('refundedCents','成功实退','money'),col('netCents','净额','money')];
const financeJobs = ['finance','store-finance'];
const supportJobs = ['support','store-manager'];
export function reportStatusLabel(type,value) {
  const common={unpaid:'待支付',waiting:'待确认',confirmed:'已确认',active:'进行中',done:'已完成',cancelled:'已取消',closed:'已关闭',pending:'待处理',approved:'已通过',rejected:'已驳回',processing:'处理中',success:'成功',failed:'失败待处理',open:'待处理',handling:'处理中',resolved:'已结案',paused:'已暂停',revoked:'已撤销',expired:'已过期',requested:'待受理',waiting_user:'等待用户',waiting_staff:'等待处理',offered:'待确认方案',withdrawn:'已撤回'};
  const specific={goods:{paid:'待发货',shipped:'待收货',received:'已收货'},bills:{review:'待门店核对',disputed:'差异待处理',confirmed:'待付款',processing:'付款待核查',failed:'付款失败',paid:'已付',adjusted:'调整后待重核'},recoveries:{open:'待追回',closed:'已追回结清'},invoices:{pending:'待开票',issued:'已开票',red_pending:'待红冲',red:'已红冲'},tasks:{open:'待处理',waiting:'等待其他方',done:'已办或已结束'},qualifications:{approved:'已授权',pending:'待审核',rejected:'已驳回',paused:'已暂停',revoked:'已撤销'}};
  return specific[type]?.[value]??common[value]??value??'—';
}
export const REPORT_TYPES = {
  bookings:{label:'预约收退款',jobs:[...financeJobs,...supportJobs],route:'bookings',dateLabel:'预约创建时间',columns:[...base,col('techId','技师'),...amounts]},
  goods:{label:'商品收退款',jobs:[...financeJobs,'warehouse','support','store-manager'],route:'goods',dateLabel:'商品订单创建时间',columns:[...base,...amounts,col('commissionCents','按原规则佣金预估','money'),col('commissionPaidCents','累计成功结佣','money')]},
  bills:{label:'商品佣金账单',jobs:financeJobs,route:'bills',dateLabel:'账单创建时间',columns:[...base,col('amountCents','账单金额','money'),col('cashCents','实际现金支付','money'),col('offsetCents','实际抵扣','money')]},
  recoveries:{label:'商品佣金追回',jobs:financeJobs,route:'recoveries',dateLabel:'追回形成时间',columns:[...base,col('orderId','商品订单'),col('amountCents','应追回','money'),col('receivedCents','已追回','money'),col('remainingCents','剩余','money')]},
  serviceFinance:{label:'服务分账',jobs:financeJobs,route:'service-finance',dateLabel:'支付成功时间',columns:[...base,col('bookingId','预约'),col('paymentId','支付'),...amounts,col('platformCents','平台服务费H','money'),col('promotionStoreCents','门店承担推广成本Cs','money'),col('pendingAdditionalCents','待补差额','money'),col('totalReturnPendingCents','待回退差额','money'),col('splitPaidCents','累计成功分账','money'),col('returnedCents','累计成功回退','money')]},
  techIncome:{label:'技师提成台账',jobs:financeJobs,route:'service-finance',dateLabel:'提成形成时间',columns:[...base,col('bookingId','预约'),col('techId','技师'),col('amountCents','当前应计','money'),col('paidCents','实际发放','money'),col('recoveredCents','实际追回','money'),col('payableCents','可发放','money')]},
  inventory:{label:'商品库存流水',jobs:['warehouse','operations'],route:'inventory',dateLabel:'库存变动时间',columns:[col('id','流水编号'),col('skuId','SKU'),col('kind','变动类型'),col('at','变动时间','date'),col('before','变动前','number'),col('delta','变动数量','number'),col('after','变动后','number'),col('orderId','关联订单')]},
  care:{label:'质量反馈案件',jobs:supportJobs,route:'care',dateLabel:'案件创建时间',columns:[...base,col('bookingId','预约'),col('dueAt','办理期限','date')]},
  followups:{label:'人工回访',jobs:supportJobs,route:'care',dateLabel:'回访创建时间',columns:[...base,col('bookingId','预约'),col('dueAt','联系期限','date')]},
  invoices:{label:'服务发票',jobs:financeJobs,route:'invoices',dateLabel:'申请创建时间',columns:[...base,col('bookingId','预约'),col('amountCents','申请金额','money'),col('issuedCents','当前开票金额','money')]},
  qualifications:{label:'项目独立授权',jobs:['operations','support','store-manager'],route:'qualifications',dateLabel:'授权记录时间',columns:[...base,col('techId','技师'),col('serviceId','项目')]},
  tasks:{label:'统一事项',jobs:[...financeJobs,...supportJobs,'operations','warehouse'],route:'tasks',dateLabel:'事项创建时间',columns:[...base,col('category','类别'),col('sourceId','来源编号'),col('dueAt','原办理期限','date'),col('ownerLabel','当前责任'),col('overdue','已逾期')]}
};
function actor(s,raw) {
  const a=resolveAccountActor(s,raw);
  if (!['group','store'].includes(a?.role)||a.job==='account-admin') fail('当前身份无权查看经营报表。');
  if (a.role==='store'&&!(s.stores||[]).some(x=>x.id===a.storeId)) fail('授权门店不存在。');
  return a;
}
function permitted(a,type) {
  const d=REPORT_TYPES[type]; if (!d) return false;
  if (!a.accountId && (a.role==='store'||!a.job||a.job==='all')) return type!=='inventory'||a.role==='group';
  return d.jobs.includes(a.job) && (a.role==='group'?!a.job.startsWith('store-'):a.job.startsWith('store-'));
}
export function availableReports(s,raw) { const a=actor(s,raw);return Object.entries(REPORT_TYPES).filter(([t])=>permitted(a,t)).map(([id,d])=>({id,label:d.label})); }
function dateBoundary(value,end=false) {
  if (!value) return null;
  const parsed=Date.parse(value+'T00:00:00Z');
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==value) fail('请选择有效日期。');
  return Date.parse(value+'T00:00:00+08:00')+(end?86400000:0);
}
function normalize(a,p={}) {
  const type=p.type||'tasks'; if (!permitted(a,type)) fail('当前岗位无权查看或导出该类报表。');
  const from=dateBoundary(p.from),until=dateBoundary(p.to,true); if(from!=null&&until!=null&&from>=until) fail('结束日期不能早于开始日期。');
  const size=Number(p.size==null||p.size===''?20:p.size),page=Number(p.page==null||p.page===''?1:p.page);
  if(![10,20,50,100].includes(size)||!Number.isSafeInteger(page)||page<1) fail('分页参数无效。');
  const q=String(p.q||'').trim(),status=String(p.status||''),store=String(p.store||'');
  if(q.length>100||status.length>80||store.length>80) fail('查询条件过长。');
  if(a.role==='store'&&store&&store!==a.storeId) fail('不能查询其他门店的报表。');
  return {type,from:p.from||'',to:p.to||'',fromAt:from,untilAt:until,q,status,store:a.role==='store'?a.storeId:store,size,page};
}
function sourceRows(s,a,type) {
  const scoped=r=>a.role==='group'||r.storeId===a.storeId;
  if(type==='bookings') return (s.bookings||[]).filter(scoped).map(b=>{ const payments=[b.payment,...(b.extensions||[])].filter(p=>p?.status==='success'); const paidCents=payments.reduce((n,p)=>n+p.amountCents,0),refundedCents=payments.reduce((n,p)=>n+(p.refundedCents||0),0);return {id:b.id,storeId:b.storeId,techId:b.techId,status:b.status,at:b.createdAt,paidCents,refundedCents,netCents:paidCents-refundedCents,path:`/${a.role}/booking/${b.id}`}; });
  if(type==='goods') return (s.goods||[]).filter(o=>a.role==='group'||o.source?.storeId===a.storeId).map(o=>{const x=goodsSummary(s,o);return {id:o.id,storeId:o.source?.storeId||'',status:o.status,at:o.createdAt,paidCents:x.actualPaidCents??(o.payment?.status==='success'?o.paidCents:0),refundedCents:x.refundedCents,netCents:x.netCents,commissionCents:o.payment?.status==='success'?x.commissionCents:0,commissionPaidCents:o.commissionPaidCents||0,path:`/${a.role}/goods/${o.id}`};});
  if(type==='bills') return (s.bills||[]).filter(scoped).map(b=>({id:b.id,storeId:b.storeId,status:b.status,at:b.createdAt,amountCents:b.amountCents,cashCents:b.status==='paid'?(b.cashPaidCents??b.amountCents):0,offsetCents:b.offsetSettledCents||0,path:`/${a.role}/bills/${b.id}`}));
  if(type==='recoveries') return (s.recoveries||[]).filter(scoped).map(r=>({id:r.id,orderId:r.orderId,storeId:r.storeId,status:r.status,at:r.createdAt??r.events?.[0]?.at??null,amountCents:r.amountCents,receivedCents:r.recoveredCents,remainingCents:Math.max(0,r.amountCents-r.recoveredCents),path:`/${a.role}/recoveries`}));
  if(type==='serviceFinance') return serviceFinanceView(s,a).entries.map(r=>({...r,at:r.paidAt??null,path:`/${a.role}/service-finance/entry/${r.id}`}));
  if(type==='techIncome') return techIncomeView(s,a).entries.map(r=>({...r,at:r.earnedAt??null,path:`/${a.role}/booking/${r.bookingId}`}));
  if(type==='inventory') return (s.inventoryLedger||[]).map(r=>({...r,path:`/group/inventory/${r.skuId}`}));
  if(type==='care'||type==='followups') return careView(s,a)[type==='care'?'cases':'followups'].map(r=>({...r,at:r.createdAt,path:`/${a.role}/care/${type==='care'?'case':'followup'}/${r.id}`}));
  if(type==='invoices') return (s.serviceInvoices||[]).filter(scoped).map(r=>({id:r.id,storeId:r.storeId,bookingId:r.bookingId,status:r.status,at:r.createdAt,amountCents:r.amount,issuedCents:r.issued&&!r.red?r.amount:0,path:`/${a.role}/invoices/${r.id}`}));
  if(type==='qualifications') { const v=qualificationView(s,a); return (v.technicians||[]).flatMap(p=>(p.grants||[]).flatMap(r=>(r.serviceIds||[]).map(serviceId=>({id:r.id+':'+serviceId,storeId:p.storeId,techId:p.techId,serviceId,status:r.status,at:r.requestedAt??r.createdAt??r.grantedAt,path:`/${a.role}/qualifications/${p.techId}`})))); }
  return workTaskView(s,a).tasks.map(r=>({...r,at:r.createdAt,path:r.route}));
}
function safeRow(row,definition) {
  const result=Object.fromEntries(definition.columns.map(c=>[c.key,row[c.key]??null]));
  if (typeof row.path==='string'&&/^\/(group|store)\/[A-Za-z0-9_/-]+$/.test(row.path)) result.path=row.path;
  return result;
}
export function reportView(s,raw,p={}) {
  const a=actor(s,raw),f=normalize(a,p),definition=REPORT_TYPES[f.type];
  let rows=sourceRows(s,a,f.type).map(r=>safeRow(r,definition));
  if(f.store) {if(!(s.stores||[]).some(x=>x.id===f.store)) fail('查询门店不存在。');rows=rows.filter(r=>r.storeId===f.store);}
  rows=rows.filter(r=>(!f.status||r.status===f.status)&&(!f.q||Object.values(r).some(v=>String(v??'').toLowerCase().includes(f.q.toLowerCase())))&&(f.fromAt==null||(Number.isFinite(r.at)&&r.at>=f.fromAt))&&(f.untilAt==null||(Number.isFinite(r.at)&&r.at<f.untilAt))).sort((x,y)=>(y.at??-1)-(x.at??-1)||String(x.id).localeCompare(String(y.id)));
  const summaries=definition.columns.filter(c=>c.format==='money').map(c=>({key:c.key,label:c.label,cents:rows.reduce((n,r)=>n+(Number.isSafeInteger(r[c.key])?r[c.key]:0),0),unknown:rows.filter(r=>!Number.isSafeInteger(r[c.key])).length}));
  const pages=Math.max(1,Math.ceil(rows.length/f.size)),page=Math.min(f.page,pages),token=JSON.stringify([a.accountId||'',a.sessionId||'',a.grantId||'',a.role,a.job||'',a.storeId||'',{...f,page:1},rows]);
  return {type:f.type,label:definition.label,dateLabel:definition.dateLabel,columns:clone(definition.columns),filters:{...f,page},rows:clone(rows.slice((page-1)*f.size,page*f.size)),allRows:clone(rows),total:rows.length,page,pages,summaries,token};
}
export const csvCell=value=>'"'+String(value??'').replace(/^(\s*[=+\-@]|[\t\r])/,"'$1").replace(/"/g,'""')+'"';
export function reportCsv(model) {
  const headers=model.columns.map(c=>csvCell(c.label)).join(',');
  const rows=model.allRows.map(r=>model.columns.map(c=>{
    if(c.format==='money'&&Number.isSafeInteger(r[c.key]))return '"'+(r[c.key]/100).toFixed(2)+'"';
    if(c.format==='number'&&Number.isSafeInteger(r[c.key]))return '"'+r[c.key]+'"';
    const value=c.key==='status'?reportStatusLabel(model.type,r[c.key]):c.format==='date'?(Number.isFinite(r[c.key])?new Date(r[c.key]+8*3600000).toISOString().replace('T',' ').slice(0,19)+' +08:00':'时间待核对'):c.format==='money'?'金额待核对':r[c.key];
    return csvCell(value);
  }).join(','));
  return '\uFEFF'+[headers,...rows].join('\r\n')+'\r\n';
}
export function reportExport(s,raw,p={},ctx={}) {
  const a=actor(s,raw),m=reportView(s,a,p);
  if(p.token!==m.token) fail('报表数据或授权已变化，请重新筛选核对后再导出。');
  const reason=String(p.reason||'').trim();if(!reason||reason.length>300) fail('请填写导出用途（最多300字）。');
  const requestId=String(p.requestId||'').trim();if(!requestId||requestId.length>200)fail('缺少有效导出提交标识。');
  const who=JSON.stringify([a.role,a.job||'',a.storeId||'',a.accountId||'']),digest=JSON.stringify({...m.filters,token:m.token,reason});
  s.reportExportRequests??=[];
  const previous=s.reportExportRequests.find(r=>r.who===who&&r.requestId===requestId);
  if(previous){if(previous.digest!==digest)fail('同一提交标识不能用于不同报表导出。');return {id:previous.id,filename:previous.filename,content:reportCsv(m)};}
  s.reportExports??=[]; const record={id:ctx.id?.('EX')||'EX'+(++s.seq),type:m.type,at:s.now,rows:m.total,fields:m.columns.map(c=>c.key),filters:clone(m.filters),reason,actor:{role:a.role,job:a.job||null,storeId:a.storeId||null,...actorAccountFields(a)}};
  s.reportExports.push(record);ctx.log?.(record,`经营报表导出 · ${m.label} · ${m.total}条`);
  const filename=`天俪_${m.label}_${new Date(s.now+8*3600000).toISOString().slice(0,10)}.csv`;
  s.reportExportRequests.push({who,requestId,digest,id:record.id,filename});
  return {id:record.id,filename,content:reportCsv(m)};
}
