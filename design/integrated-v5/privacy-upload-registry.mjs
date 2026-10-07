// Internal runtime adapter. Root supplies the existing origin lock and the
// original purpose/source guards. This module never grants a business right.
import { resolveAccountActor } from './staff-accounts.mjs';
import { validateInvoiceFile } from './invoice-files.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';
import { collectPrivacyFileReferences } from './privacy-cleanup-inventory.mjs';
import { lifecycleFingerprint } from './organization-lifecycle-projection.mjs';

export const PRIVACY_UPLOAD_PURPOSES = Object.freeze([
  'care-evidence', 'qualification-evidence', 'service-invoice', 'commerce-invoice',
  'service-finance', 'service-extra', 'service-promotion', 'organization-identity',
  'catalog-image', 'legacy-inline-image'
]);
const PURPOSES = new Set(PRIVACY_UPLOAD_PURPOSES);
const SOURCES = new Set(['booking','goods','care-case','qualification-profile','qualification-draft',
  'service-invoice','commerce-invoice','service-extra-evidence','service-refund-shortage',
  'service-extra-recovery','service-extra-offset','service-finance-recovery','service-finance-entry','service-finance-composition',
  'service-promotion-agreement','service-promoter','service-promotion-risk',
  'service-promotion-withdrawal','service-promotion-recovery','organization-identity','tech',
  'catalog-product','catalog-sku','catalog-store','catalog-service','catalog-region','catalog-draft']);
const MEDIA_TYPES = new Set(['image/png','image/jpeg','image/webp']);
const clone = value => structuredClone(value);
const hash = lifecycleFingerprint;
const FAILURE_CODES = new Set(['invalid_context','source_missing','ledger_unavailable','actor_unavailable','invalid_scope','cancellation_missing','scope_changed','invalid_file','attachment_missing','runtime_missing','reservation_changed','commit_unverified','clock_changed','file_mismatch','storage_failed']);
const failureCode = error => FAILURE_CODES.has(error?.code)?error.code:'storage_failed';
const rows = state => state.privacyUploadReservations || [];
const same = (a,b) => hash(a) === hash(b);
const fail = (code,message,facts) => { const error = new Error(message); error.code = code; if(facts)error.facts=clone(facts); throw error; };
function text(value,label,max=200) {
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\x00-\x1f]/.test(value))fail('invalid_context',`${label}无效。`);
  return value;
}
function unique(list,id,label,key='id') {
  const found=(Array.isArray(list)?list:[]).filter(row=>row?.[key]===id);
  if(found.length!==1)fail('source_missing',`${label}缺失或编号不唯一。`);
  return found[0];
}
function ledger(state) {
  if(!state||typeof state!=='object'||!Number.isSafeInteger(state.now)||state.now<0||state.privacyUploadReservations!=null&&!Array.isArray(state.privacyUploadReservations))fail('ledger_unavailable','当前真实账本或上传登记无法读取。');
  return state;
}
function author(state,raw) {
  const actor=resolveAccountActor(state,raw);
  if(!actor||!['user','tech','store','group','manager'].includes(actor.role))fail('actor_unavailable','当前真实上传身份缺失。');
  if(actor.role==='user')unique(state.users,actor.userId,'当前本人');
  if(actor.role==='tech')unique(state.techs,actor.techId,'当前原技师');
  if(['store','manager'].includes(actor.role))unique(state.stores,actor.storeId,'当前原门店');
  const result={role:actor.role,actorMode:actor.sessionId?'work-session':actor.role==='user'?'personal':'demo-role'};
  for(const key of ['job','accountId','sessionId','grantId'])if(actor[key]!=null)result[key]=text(actor[key],key);
  if(actor.role==='user')result.userId=actor.userId;
  if(actor.role==='tech')result.techId=actor.techId;
  if(['store','manager'].includes(actor.role))result.storeId=actor.storeId;
  return {actor,by:result}; // User UI hints and accountName are not copied.
}
function scope(context,value,operation) {
  if(!value||!PURPOSES.has(value.purpose)||!['invoice','media'].includes(value.library)||!SOURCES.has(value.source?.kind))fail('invalid_scope','真实上传用途或原来源尚未接入。');
  if((['catalog-image','legacy-inline-image'].includes(value.purpose))!==(value.library==='media'))fail('invalid_scope','上传用途与原文件库不一致。');
  const result={purpose:value.purpose,library:value.library,command:text(value.command,'原命令'),
    source:{kind:value.source.kind,id:text(value.source.id,'原来源编号')},sourceToken:hash(value.sourceToken),
    subjectBinding:{subjects:[]},selection:{}};
  if(value.sourceToken==null||value.sourceToken==='')fail('invalid_scope','原来源核验摘要缺失。');
  if(!Array.isArray(value.subjects)||!value.subjects.length)fail('invalid_scope','真实资料主体来源缺失。');
  for(const subject of value.subjects) {
    if(!subject||!['user','tech','store','group','public'].includes(subject.kind))fail('invalid_scope','资料主体类别无效。');
    const id=text(subject.id,'资料主体编号');
    if(subject.kind==='user')unique(context.state.users,id,'资料本人');
    if(subject.kind==='tech')unique(context.state.techs,id,'资料技师');
    if(subject.kind==='store')unique(context.state.stores,id,'资料门店');
    if(subject.kind==='group'&&id!=='group')fail('invalid_scope','集团资料主体无效。');
    if(subject.kind==='public'&&id!==result.source.id)fail('invalid_scope','公共图来源串号。');
    if(result.subjectBinding.subjects.some(old=>old.kind===subject.kind&&old.id===id))fail('invalid_scope','资料主体重复。');
    result.subjectBinding.subjects.push({kind:subject.kind,id});
  }
  for(const key of ['tabId','instanceId','generation'])result.selection[key]=text(value.selection?.[key],key);
  if(!/^sha256:[a-f0-9]{64}$/.test(value.selection?.formKeyDigest||''))fail('invalid_scope','真实草稿key摘要缺失。');
  result.selection.formKeyDigest=value.selection.formKeyDigest;
  if(context.by.role==='user'&&['booking','goods'].includes(result.source.kind)) {
    const root=unique(context.state[result.source.kind==='booking'?'bookings':'goods'],result.source.id,'原本人交易');
    if(root.userId!==context.by.userId)fail('invalid_scope','原交易不是该真实上传本人。');
    result.userId=context.by.userId;
    if(privacyUseClosed(context.state,result.userId))result.closureId=closedRightsBinding(context.state,context.actor,result.source.kind,result.source.id).closureId;
  } else if(context.by.role==='user'&&privacyUseClosed(context.state,context.by.userId))fail('invalid_scope','已关闭本人须从准确既有交易根选择附件。');
  if(value.userId!=null&&value.userId!==result.userId||value.closureId!=null&&value.closureId!==result.closureId)fail('invalid_scope','上传本人或关闭来源不能由载荷另行指定。');
  if(operation==='cancel') {
    if(!['clear-selection','replace-selection','abandon-draft'].includes(value.cancellation?.kind))fail('cancellation_missing','须有真实原选择解除事件，失权不能当作取消。');
    result.cancellation={id:text(value.cancellation.id,'选择解除事件'),kind:value.cancellation.kind};
  }
  return result;
}
function binding(value) {
  const {cancellation,...stable}=value;return stable;
}
function currentSelection(row) {
  if(row.activeClaim==null)return row.selection;
  const claim=row.activeClaim,chosen=claim.selection;
  if(claim.protocolVersion!==1||!Number.isSafeInteger(claim.version)||claim.version<1||!chosen||!/^sha256:[a-f0-9]{64}$/.test(chosen.formKeyDigest||''))fail('scope_changed','原上传续接能力损坏。');
  for(const key of ['tabId','instanceId','generation'])text(chosen[key],key);
  return chosen;
}
function matching(row,current,{resuming=false}={}) {
  const stable={purpose:row.purpose,library:row.library,command:row.command,source:row.source,sourceToken:row.sourceToken,
    subjectBinding:row.subjectBinding,...(row.userId?{userId:row.userId}:{}),...(row.closureId?{closureId:row.closureId}:{})};
  const {selection:chosen,...domain}=binding(current.scope),expected=currentSelection(row);
  if(!same(stable,domain)||!same(row.uploadedBy,current.by)||row.originScope!==current.originScope||(!resuming&&!same(chosen,expected))||resuming&&chosen.formKeyDigest!==expected.formKeyDigest)fail('scope_changed','当前身份、原来源、标签或选择代次已变化。');
}
async function bytesFor(file,library) {
  if(!(file instanceof Blob)||!Number.isSafeInteger(file.size)||file.size<1)fail('invalid_file','请选择真实非空文件。');
  if(library==='invoice')return validateInvoiceFile(file);
  if(!MEDIA_TYPES.has(file.type))fail('invalid_file','原图片格式须为PNG、JPEG或WebP。');
  return new Uint8Array(await file.arrayBuffer());
}
async function fileHash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function pathValue(state,path) {
  if(!Array.isArray(path)||!path.length||path.some(key=>!['string','number'].includes(typeof key)||['__proto__','constructor','prototype'].includes(String(key))))fail('attachment_missing','原附着槽路径无效。');
  return path.reduce((value,key)=>value?.[key],state);
}

export function createPrivacyUploadRegistry(deps={}) {
  for(const key of ['withMutation','load','currentContext','scopeFor','commit','save','read'])if(typeof deps[key]!=='function')fail('runtime_missing',`上传登记内部${key}接口尚未接入。`);
  const load=()=>ledger(deps.load());
  function context(operation,row) {
    const state=load(),raw=deps.currentContext();
    if(!raw||raw.viewError)fail('actor_unavailable','当前读取或身份来源已失效。');
    const resolved=author(state,raw.actor),originScope=text(raw.originScope,'当前origin');
    let parsed;try{parsed=new URL(originScope);}catch{fail('invalid_context','当前origin无效。');}
    if(parsed.origin!==originScope)fail('invalid_context','当前origin须为准确同源。');
    const current={...raw,state,...resolved,originScope};
    const actual=deps.scopeFor(current,operation,row?clone(row):undefined);
    if(actual?.then)fail('invalid_scope','当前原来源守卫必须同步读取。');
    return {...current,scope:scope(current,actual,operation)};
  }
  async function persist(state,row,previous) {
    const next=clone(state),list=next.privacyUploadReservations??=[];
    if(previous) {
      const old=unique(list,row.id,'原上传登记');if(!same(old,previous))fail('reservation_changed','原上传登记版本或来源已变化。');
      list[list.indexOf(old)]=clone(row);
    } else {if(list.some(old=>old?.id===row.id))fail('reservation_changed','上传登记编号已占用。');list.push(clone(row));}
    await deps.commit(next,{expectedStateToken:hash(state)});
    const observed=unique(rows(load()),row.id,'持久上传登记');
    if(!same(observed,row))fail('commit_unverified','上传登记实际回读不一致。');
    return clone(observed);
  }
  async function fact(original,status,detail) {
    const state=load(),old=unique(rows(state),original.id,'原上传登记');
    if(!same(old,original)||old.status!=='preparing')fail('reservation_changed','原上传登记已变化，实际I/O仍待核对。');
    const at=state.now;if(at<old.createdAt)fail('clock_changed','当前账本时间早于原上传事实。');
    const next={...clone(old),version:old.version+1,status,...detail,
      ...(status==='saved'?{savedAt:at}:{failedAt:at}),
      transitions:[...old.transitions,{version:old.version+1,status,at,ioOutcome:detail.ioOutcome,code:detail.code||null}]};
    return persist(state,next,old);
  }
  async function save(file) {
    return deps.withMutation(async()=>{
      const first=context('save'),firstBinding=binding(first.scope),firstBy=first.by;
      const bytes=await bytesFor(file,first.scope.library),digest=await fileHash(bytes);
      const fresh=context('save');if(!same(firstBinding,binding(fresh.scope))||!same(firstBy,fresh.by)||first.originScope!==fresh.originScope)fail('scope_changed','保存前当前身份或原选择来源已变化。');
      const ref=(fresh.scope.library==='invoice'?'invoice-file:':'media:')+digest;
      const reservation={id:text((deps.id||(()=>crypto.randomUUID()))(),'新上传登记编号'),version:1,protocolVersion:1,status:'preparing',
        originScope:fresh.originScope,uploadedBy:clone(fresh.by),...clone(binding(fresh.scope)),createdAt:fresh.state.now,ref,
        file:{ref,name:'登记附件',type:file.type,size:bytes.byteLength},nameDigest:hash(String(file.name||'')),
        transitions:[{version:1,status:'preparing',at:fresh.state.now,ioOutcome:'not_started',code:null}]};
      await persist(fresh.state,reservation);
      let started=false,stored=false,result;
      try {
        const before=context('save',reservation);matching(reservation,before);
        if(!same(unique(rows(before.state),reservation.id,'原上传登记'),reservation))fail('reservation_changed','原上传登记已变化。');
        const snapshot=new Blob([bytes],{type:file.type});Object.defineProperty(snapshot,'name',{value:String(file.name||'')});
        started=true;result=await deps.save(reservation.library,snapshot);stored=true;
        const saved=reservation.library==='invoice'?result:{ref:result,name:String(file.name||''),type:file.type,size:bytes.byteLength};
        if(!saved||saved.ref!==ref||saved.type!==file.type||saved.size!==bytes.byteLength)fail('file_mismatch','原保存返回的实际文件引用或元数据不一致。');
        let usable=true;try{matching(reservation,context('save',reservation));}catch{usable=false;}
        const actual=await deps.read(reservation.library,clone(saved));
        if(!(actual instanceof Blob)||actual.type!==file.type||actual.size!==bytes.byteLength||await fileHash(await actual.arrayBuffer())!==digest)fail('file_mismatch','原文件实际回读内容与本次选择不一致。');
        try{matching(reservation,context('save',reservation));}catch{usable=false;}
        const recorded=await fact(reservation,'saved',{ioOutcome:'stored_verified',usable,code:usable?null:'scope_changed'});
        if(!usable)fail('scope_changed','文件已保存并登记；当前身份或原选择已变化，不能回填。',{reservationId:recorded.id,status:recorded.status,version:recorded.version,ioOutcome:recorded.ioOutcome});
        return {id:recorded.id,version:recorded.version,status:recorded.status,file:clone(saved)};
      } catch(error) {
        if(error.facts)throw error;
        let observed;try{observed=unique(rows(load()),reservation.id,'原上传登记');}catch{}
        if(observed&&same(observed,reservation)) {
          try {observed=await fact(reservation,'failed',{ioOutcome:stored?'stored_unverified':started?'write_unverified':'not_started',usable:false,code:failureCode(error)});}catch(journalError){fail('result_commit_failed','上传实际I/O结果未能持久回读；原preparing保留待核。',{reservationId:reservation.id,status:'preparing',ioOutcome:stored?'stored_unverified':started?'write_unverified':'not_started',resultCode:failureCode(journalError)});}
        }
        fail(failureCode(error),'本次上传未能完成回填；真实登记与I/O状态已保留待核。',{reservationId:reservation.id,status:observed?.status||'unknown',version:observed?.version||null,ioOutcome:observed?.ioOutcome||(stored?'stored_unverified':started?'write_unverified':'not_started')});
      }
    });
  }
  function resumeProof(current,row,{previous=currentSelection(row),reservationVersion=row.version}={}) {
    if(typeof deps.resumeFor!=='function')fail('resume_missing','原草稿实际回读和续接来源尚未接入。');
    const pointer=deps.resumeFor(current,clone(row)),selected=current.scope.selection,tabs=current.state.privacyUploadTabs||[];
    if(!pointer||pointer.then||pointer.instanceId!==selected.instanceId||pointer.tabId!==selected.tabId||selected.instanceId===previous.instanceId)fail('resume_missing','须有新document自己的实际草稿回读。');
    const own=unique(tabs,selected.instanceId,'新document登记'),receipt=unique(own.scopedReceipts,pointer.receiptId,'精确草稿回读');
    const {actorMode,...by}=current.by,revision=Math.max(1,...(current.state.privacyUploadTabRevisions||[]).filter(item=>item.originScope===current.originScope).map(item=>item.revision));
    if(own.tabId!==selected.tabId||own.originScope!==current.originScope||own.protocolVersion!==1||receipt.protocolVersion!==1||receipt.instanceId!==selected.instanceId||receipt.tabId!==selected.tabId||receipt.originScope!==current.originScope||receipt.authorDigest!==hash(by)||receipt.revision!==revision||receipt.readbackVerified!==true||receipt.acknowledged!==false||hash(receipt)!==pointer.sourceToken)fail('resume_missing','原精确回读实例、作者或revision已变化。');
    const prior=receipt.predecessor;
    if(!prior||prior.instanceId!==previous.instanceId||prior.tabId!==previous.tabId)fail('resume_missing','无法证明这份草稿是当前原选择的直接后继。');
    const old=unique(tabs,prior.instanceId,'原document登记'),oldReceipt=unique(old.receipts,prior.receiptId,'原草稿回读');
    if(old.tabId!==prior.tabId||old.originScope!==current.originScope||old.protocolVersion!==1||old.version!==prior.version||old.manifest?.digest!==prior.manifestDigest||oldReceipt.readbackVerified!==true||oldReceipt.manifestDigest!==prior.manifestDigest||hash(oldReceipt)!==prior.receiptToken)fail('resume_missing','原document草稿或回读来源已变化。');
    const entry=unique(receipt.entries,selected.formKeyDigest,'当前原草稿','keyDigest'),oldEntry=unique(old.manifest.entries,selected.formKeyDigest,'原实例草稿','keyDigest');
    const selectedFact=(entry.selections||[]).filter(item=>item.reservationId===row.id),priorFact=(oldEntry.selections||[]).filter(item=>item.reservationId===row.id);
    if(!same(entry,oldEntry)||selectedFact.length!==1||priorFact.length!==1||!same(selectedFact[0],priorFact[0]))fail('resume_missing','实际草稿与原登记侧记不一致。');
    const fact=selectedFact[0];
    if(fact.version!==reservationVersion||fact.ref!==row.ref||fact.instanceId!==previous.instanceId||fact.generation!==previous.generation||fact.formKeyDigest!==previous.formKeyDigest||![entry.source,...(entry.roots||[])].some(source=>same(source,row.source))||!row.subjectBinding.subjects.every(subject=>entry.subjects?.some(actual=>same(subject,actual)))||!entry.refs?.some(ref=>ref.ref===row.ref&&ref.library===row.library))fail('resume_missing','实际草稿不能证明该次原选择、文件和归属。');
    return clone(pointer);
  }
  async function resume(id,version) {
    return deps.withMutation(async()=>{
      const row=unique(rows(load()),id,'原上传登记');
      if(row.status!=='saved'||row.usable!==true||row.ioOutcome!=='stored_verified')fail('reservation_changed','只有当前已实际保存且仍可用的原选择能续接。');
      const first=context('resume',row),replay=row.activeClaim&&same(row.activeClaim.selection,first.scope.selection),prior=replay?{previous:row.activeClaim.previousSelection,reservationVersion:row.activeClaim.previousReservationVersion}:undefined;
      if(row.version!==version&&!(replay&&row.activeClaim.previousReservationVersion===version))fail('reservation_changed','原选择已被其他实例续接或变更。');
      if(replay&&(!prior.previous||!Number.isSafeInteger(prior.reservationVersion)))fail('resume_missing','原续接重试来源缺失。');
      matching(row,first,{resuming:!replay});const pointer=resumeProof(first,row,prior),chosen=clone(first.scope.selection);
      if(replay&&!same(pointer,row.activeClaim.sourceReceipt))fail('resume_missing','续接重试必须使用原同一实际回读。');
      const recheck=()=>{const current=context('resume',row);if(!same(unique(rows(current.state),id,'原上传登记'),row))fail('reservation_changed','原选择已被其他实例续接或变更。');matching(row,current,{resuming:!replay});if(!same(current.scope.selection,chosen)||!same(resumeProof(current,row,prior),pointer))fail('resume_missing','续接期间实际草稿回读来源已变化。');return current;};
      const actual=await deps.read(row.library,clone(row.file));recheck();
      if(!(actual instanceof Blob)||actual.size!==row.file.size||actual.type!==row.file.type)fail('file_mismatch','原续接文件缺失或元数据变化。');
      const bytes=await actual.arrayBuffer();recheck();const digest=await fileHash(bytes),current=recheck();
      if(row.ref!==(row.library==='invoice'?'invoice-file:':'media:')+digest)fail('file_mismatch','原续接文件字节与登记不一致。');
      if(replay)return{id:row.id,version:row.version,status:row.status,claim:clone(row.activeClaim)};
      const at=current.state.now;if(at<row.savedAt)fail('clock_changed','续接时间早于原上传事实。');
      const claim={protocolVersion:1,version:(row.activeClaim?.version||0)+1,selection:chosen,previousSelection:clone(currentSelection(row)),previousReservationVersion:row.version,sourceReceipt:pointer,at},receipt={id:text((deps.id||(()=>crypto.randomUUID()))(),'续接回执编号'),claimVersion:claim.version,previousSelectionDigest:hash(currentSelection(row)),sourceReceipt:pointer,at};
      if(rows(current.state).some(item=>item.resumeReceipts?.some(old=>old.id===receipt.id)))fail('reservation_changed','续接回执编号重复。');
      const updated={...clone(row),version:row.version+1,activeClaim:claim,resumeReceipts:[...(row.resumeReceipts||[]),receipt],transitions:[...row.transitions,{version:row.version+1,status:row.status,at,ioOutcome:row.ioOutcome,code:null,operation:'resume'}]};
      const saved=await persist(current.state,updated,row);const after=context('resume',saved);matching(saved,after);if(!same(deps.resumeFor(after,clone(saved)),pointer))fail('resume_missing','续接提交后实际草稿来源已变化。');
      return{id:saved.id,version:saved.version,status:saved.status,claim:clone(saved.activeClaim)};
    });
  }
  function stageAttach(nextState,ids) {
    ledger(nextState);
    if(typeof deps.attachmentFor!=='function'||!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length)fail('attachment_missing','原附着槽核验尚未接入或登记编号重复。');
    const staged=[];
    for(const id of ids) {
      const original=unique(rows(load()),id,'原上传登记'),current=context('attach',original);matching(original,current);
      if(original.status!=='saved'||original.usable!==true||original.ioOutcome!=='stored_verified')fail('attachment_missing','只有该次已实际核验保存的选择可以附着。');
      const row=unique(rows(nextState),id,'原clone上传登记');if(!same(row,original))fail('reservation_changed','原clone上传登记已变化。');
      const slots=deps.attachmentFor(nextState,current.actor,clone(row));
      if(slots?.then||!Array.isArray(slots)||!slots.length)fail('attachment_missing','原新增附件槽未核实。');
      const sources=slots.map(slot=>{
        if(!SOURCES.has(slot.source?.kind))fail('attachment_missing','原附着来源类别无效。');
        const actual=pathValue(nextState,slot.path),file=typeof actual==='string'?{ref:actual}:actual;
        if(file?.ref!==row.ref||row.library==='invoice'&&(file.size!==row.file.size||file.type!==row.file.type))fail('attachment_missing','原附着槽实际文件串号或元数据变化。');
        if(slot.path[0]==='privacyUploadReservations')fail('attachment_missing','上传登记不能充当业务附着槽。');
        if(slot.sourceToken==null||slot.sourceToken==='')fail('attachment_missing','原附着来源摘要缺失。');
        return {source:{kind:slot.source.kind,id:text(slot.source.id,'原附着来源编号')},slot:text(slot.slot,'原附着槽'),path:clone(slot.path),sourceToken:hash(slot.sourceToken)};
      });
      if(new Set(sources.map(hash)).size!==sources.length)fail('attachment_missing','原附着槽重复。');
      if(nextState.now<row.createdAt)fail('clock_changed','原附着事实时间无效。');
      staged.push({row,value:{...clone(row),status:'attached',version:row.version+1,attachedAt:nextState.now,attachedBy:clone(current.by),attachedSources:sources,
        transitions:[...row.transitions,{version:row.version+1,status:'attached',at:nextState.now,ioOutcome:row.ioOutcome,code:null}]}});
    }
    // Validate every item before changing the caller's business clone.
    for(const {row,value} of staged)Object.assign(row,value);
    return staged.map(({value})=>({id:value.id,version:value.version,status:value.status}));
  }
  async function cancel(id,version) {
    return deps.withMutation(async()=>{
      const state=load(),row=unique(rows(state),id,'原上传登记'),current=context('cancel',row);matching(row,current);
      if(row.version!==version||!['saved','failed','preparing'].includes(row.status))fail('reservation_changed','上传登记版本或状态已变化。');
      const graph=collectPrivacyFileReferences(state);
      if(state.now<row.createdAt)fail('clock_changed','取消事实时间无效。');
      if(graph.issues.length||graph.references.some(item=>item.ref===row.ref)) {
        const pending={...clone(row),version:row.version+1,usable:false,cancellationStatus:'pending_review',selectionReleasedAt:state.now,
          selectionReleasedBy:clone(current.by),cancellationSource:current.scope.cancellation,
          transitions:[...row.transitions,{version:row.version+1,status:row.status,at:state.now,ioOutcome:row.ioOutcome||'unverified',code:'reference_retained'}]};
        await persist(state,pending,row);
        fail('reference_retained','原选择解除事件已记录；文件仍有原业务、历史、政策或未知用途，取消登记待核。',
          {reservationId:pending.id,status:pending.status,version:pending.version,cancellationStatus:'pending_review'});
      }
      const updated={...clone(row),status:'cancelled',version:row.version+1,cancelledAt:state.now,cancelledBy:clone(current.by),cancellationSource:current.scope.cancellation,
        transitions:[...row.transitions,{version:row.version+1,status:'cancelled',at:state.now,ioOutcome:row.ioOutcome||'unverified',code:null}]};
      const saved=await persist(state,updated,row);
      return {id:saved.id,version:saved.version,status:saved.status};
    });
  }
  return Object.freeze({save,resume,stageAttach,cancel});
}
