// Narrow bridge for actual app selections. Draft metadata is evidence only;
// capabilities and the held-lock registry never survive this document instance.
import { createPrivacyUploadRegistry } from './privacy-upload-registry.mjs';
import { privacyUploadScope, privacyUploadAttachmentSlots, preparePrivacyInlineUpload } from './privacy-upload-scope.mjs';
import { lifecycleFingerprint as hash } from './organization-lifecycle-projection.mjs';

const clone=value=>structuredClone(value);
const identity=actor=>Object.fromEntries(['role','job','userId','techId','storeId','accountId','sessionId','grantId'].map(key=>[key,actor?.[key]??null]));
const fail=message=>{throw new Error(message);};
export function createAppUploadRuntime({key,storage,locks,sessionRuntime,currentContext,saveFile,readFile,saveImage,readImage,id=()=>crypto.randomUUID()}={}) {
  const {instanceId,tabId}=sessionRuntime?.identity()||{instanceId:id(),tabId:id()},forms=new WeakMap(),knownForms=new Map();
  function load(){const raw=storage.getItem(key);if(!raw)fail('原上传账本缺失，请保留草稿并重新核对。');let value;try{value=JSON.parse(raw);}catch{fail('原上传账本无法读取。');}if(value.schema!==5)fail('原上传账本版本不兼容。');return value;}
  function commit(next,{expectedStateToken}){if(hash(load())!==expectedStateToken)fail('原账本已变化，本次上传事实待核。');const raw=JSON.stringify(next);storage.setItem(key,raw);if(storage.getItem(key)!==raw)fail('上传账本持久回读不一致。');}
  async function locked(action){
    if(sessionRuntime)return sessionRuntime.withMutation(async cap=>{await cap.ensureRegistered();return action(cap.held);},{requireLock:true});
    if(typeof locks?.request!=='function')fail('当前环境没有可靠的同源存储锁，附件暂不能保存；原资料与草稿保留。');
    return locks.request(key,async()=>{
      let active=true;
      const held=work=>{if(!active)fail('原上传持锁上下文已结束。');return work();};
      try{return await action(held);}finally{active=false;}
    });
  }
  function context(entry,operation){
    const fresh=currentContext();
    if(fresh?.viewError||entry.released||!entry.active(operation)||hash(identity(fresh.actor))!==entry.actorToken||fresh.originScope!==entry.origin||fresh.route!==entry.route)fail('页面、身份或原选择已变化；文件事实保留待核，请从当前原记录重新选择。');
    return fresh;
  }
  function registry(entry,held,attachment,operation){return createPrivacyUploadRegistry({
    withMutation:held,load:()=>{held.assertActive?.();return load();},commit:(next,options)=>{held.assertActive?.();return commit(next,options);},currentContext:()=>{held.assertActive?.();return context(entry,operation);},
    scopeFor:(current,operation)=>({...privacyUploadScope(current.state,current.actor,entry.command,entry.payload(),{selection:entry.selection,field:entry.field,legacyProof:entry.legacyProof}),...(operation==='cancel'?{cancellation:entry.cancellation}:{})}),
    save:(library,file)=>library==='invoice'?saveFile(file):saveImage(file),read:(library,file)=>library==='invoice'?readFile(file):readImage(file),
    attachmentFor:attachment,resumeFor:entry.resumeReceipt?()=>sessionRuntime.resumeSource(entry.resumeReceipt):undefined,id
  });}
  function entries(form){let found=forms.get(form);if(!found){found=[];forms.set(form,found);}return found;}
  function make({command,field,formKey,payload,active}){
    const original=currentContext();if(original?.viewError)fail('当前账本读取失败，不能选择附件。');
    return {command,field,payload,active,actorToken:hash(identity(original.actor)),origin:original.originScope,route:original.route,
      selection:{tabId,instanceId,generation:id(),formKeyDigest:hash(formKey)},reservation:null};
  }
  async function save(form,file,options){
    const entry=make(options);entries(form).push(entry);knownForms.set(options.formKey,form);
    try{const result=await locked(held=>registry(entry,held).save(file));entry.reservation={id:result.id,version:result.version,status:result.status,ref:result.file.ref};entry.rowToken=hash(load().privacyUploadReservations.find(row=>row.id===result.id));return result.file;}
    catch(error){if(error.facts?.reservationId)entry.reservation={id:error.facts.reservationId,version:error.facts.version,status:error.facts.status};throw error;}
  }
  async function releaseEntries(chosen,kind){
    for(const entry of chosen){
      // An unsuccessful restore never acquired this document's claim. Replacing
      // that draft must not cancel the former instance's original selection.
      if(entry.resumeReceipt&&!entry.published){entry.released=true;continue;}
      if(!entry.reservation){entry.released=true;continue;}
      const row=load().privacyUploadReservations?.find(row=>row.id===entry.reservation.id);
      if(row?.status==='attached'){entry.released=true;continue;}
      entry.cancellation={id:id(),kind};
      try{const result=await locked(held=>registry(entry,held,undefined,'cancel').cancel(entry.reservation.id,entry.reservation.version));entry.reservation={...entry.reservation,...result};}
      catch(error){if(error.code!=='reference_retained')throw error;entry.reservation={...entry.reservation,version:error.facts.version,status:error.facts.status,cancellationStatus:'pending_review'};}
      entry.released=true;
    }
  }
  async function release(form,field,kind){return releaseEntries(entries(form).filter(entry=>!entry.released&&(field==null||entry.field===field)),kind);}
  function begin(form,field){
    const original=new Set(entries(form));
    return async()=>{
      const added=entries(form).filter(entry=>!original.has(entry)&&entry.field===field&&!entry.released);
      for(const entry of added)context(entry);
      await releaseEntries([...original].filter(entry=>entry.field===field&&!entry.released),'replace-selection');
      for(const entry of added)entry.published=true;
    };
  }
  function metadata(form){return entries(form).filter(entry=>entry.reservation&&(!entry.resumeReceipt||entry.published)).map(entry=>({...entry.reservation,field:entry.field,instanceId,generation:entry.selection.generation,released:!!entry.released,published:!!entry.published}));}
  function rebind(form,options,savedMetadata){
    const previous=knownForms.get(options.formKey);if(!previous||previous===form)return false;
    const stored=(savedMetadata||[]).filter(item=>item.instanceId===instanceId);
    if(hash(stored)!==hash(metadata(previous)))return false;
    const prior=entries(previous),current=load();
    try{
      for(const entry of prior.filter(item=>item.published&&!item.released)){
        const candidate={...entry,payload:options.payload,active:options.active};const live=context(candidate),row=current.privacyUploadReservations?.find(row=>row.id===entry.reservation.id);
        if(!row||hash(row)!==entry.rowToken)fail('原上传登记已变化。');
        const scope=privacyUploadScope(current,live.actor,entry.command,options.payload(),{selection:entry.selection,field:entry.field});
        if(hash(scope.source)!==hash(row.source)||hash(scope.sourceToken)!==row.sourceToken||hash({subjects:scope.subjects})!==hash(row.subjectBinding))fail('原草稿上传来源已变化。');
      }
    }catch{return false;}
    for(const entry of prior){entry.payload=options.payload;entry.active=options.active;}
    forms.set(form,prior);knownForms.set(options.formKey,form);return true;
  }
  async function resume(form,options,savedMetadata,receipt){
    if(!sessionRuntime||!receipt)fail('旧草稿尚无可核验的原标签来源，请保留资料并重新选择附件。');
    const selected=(savedMetadata||[]).filter(item=>item.published&&!item.released);
    if(!selected.length)return false;
    if(new Set(selected.map(item=>item.id)).size!==selected.length)fail('原附件侧记重复，保留草稿待核。');
    for(const item of selected){
      let entry=entries(form).find(entry=>entry.resumeReceipt===receipt&&entry.reservation?.id===item.id);
      if(!entry){entry=make({...options,field:item.field});entry.resumeReceipt=receipt;entry.reservation={id:item.id,version:item.version,status:item.status,ref:item.ref};entries(form).push(entry);}
      const resumed=await locked(held=>registry(entry,held,undefined,'resume').resume(item.id,item.version));
      entry.reservation={...entry.reservation,version:resumed.version,status:resumed.status};entry.published=true;
      entry.rowToken=hash(load().privacyUploadReservations.find(row=>row.id===item.id));knownForms.set(options.formKey,form);
    }
    return true;
  }
  function originalResult(before,next,command,payload,result){
    if(result!==undefined)return result;
    const domain=command.startsWith('care.')?['serviceCareRequests','serviceCareCases','resultId']:command.startsWith('qualification.')?['techQualificationRequests','techQualifications','profileId']:command.startsWith('invoice.')?['serviceInvoiceRequests','serviceInvoices','invoiceId']:command==='finance.recovery-receive'?['serviceFinanceRequests','serviceFinanceRecoveries','resultId']:null;
    if(!domain)return result;
    const [requests,container,idKey]=domain,old=before[requests]||[];
    const added=(next[requests]||[]).filter(row=>row.requestId===payload.requestId&&!old.some(prior=>hash(prior)===hash(row)));
    if(added.length!==1)fail('本次原业务提交没有唯一新增请求事实，附件继续保留待核。');
    const actual=(next[container]||[]).filter(row=>row.id===added[0][idKey]);
    if(actual.length!==1)fail('本次原请求的实际结果缺失或不唯一。');
    return actual[0]; // Scope adapter still verifies full request, author and root.
  }
  function stage(form,before,next,payload,result,{command,galleryFields}={}){
    const selected=entries(form).filter(entry=>!entry.released&&entry.published&&entry.reservation);
    if(!selected.length)return;
    if(!(sessionRuntime?sessionRuntime.reliable():typeof locks?.request==='function'))fail('当前环境没有可靠的同源存储锁，附件暂不能附着。');
    for(const entry of selected){
      if(entry.command!==command)fail('提交命令与原文件选择不一致。');
      const row=before.privacyUploadReservations?.find(row=>row.id===entry.reservation.id);
      if(row?.status==='attached'){
        context(entry,'attach');
        if(hash(row.activeClaim?.selection||row.selection)!==hash(entry.selection))fail('原选择已由其他实例续接，请重新核对当前草稿。');
        const key=command.startsWith('care.')?'serviceCareRequests':command.startsWith('qualification.')?'techQualificationRequests':command.startsWith('invoice.')?'serviceInvoiceRequests':command.startsWith('commerce-invoice.')?'commerceInvoiceRequests':command.startsWith('service-extra.')?'serviceExtraRequests':command.startsWith('service-promotion.')?'servicePromotionRequests':command.startsWith('finance.')?'serviceFinanceRequests':'managementRequests';
        if(!(before[key]||[]).some(request=>request.requestId===payload.requestId)||hash(before[key]||[])!==hash(next[key]||[]))fail('已附着的旧选择不能用于新的提交，请重新选择附件。');
        continue; // Actual original reduce replay made no new request.
      }
      if(row?.status!=='saved'||!row.usable)fail('本次附件尚未完整核验，请重新选择；原文件事实保留待核。');
      const actual=originalResult(before,next,entry.command,payload,result);
      registry(entry,()=>fail('附着阶段不能再次申请或绕过原事务锁。'),(after,actor,reservation)=>privacyUploadAttachmentSlots(before,after,actor,entry.command,payload,actual,reservation,{field:entry.field,galleryFields}),'attach').stageAttach(next,[row.id]);
    }
  }
  async function migratePublicInline(){
    const initial=load(),paths=[];
    for(const container of ['products','skus','stores','services','regions'])for(let i=0;i<(initial[container]||[]).length;i++){
      const row=initial[container][i];if(typeof row.image==='string'&&row.image.startsWith('data:image/'))paths.push([container,i,'image']);
      if(container==='products')for(let j=0;j<(row.gallery||[]).length;j++)if(typeof row.gallery[j]==='string'&&row.gallery[j].startsWith('data:image/'))paths.push([container,i,'gallery',j]);
    }
    const pending=[];
    for(const path of paths)try{await locked(async held=>{
      const entry=make({command:'media.legacy-externalize',field:path.slice(2).join(':'),formKey:key+':'+path.join(':'),payload:()=>({}),active:()=>true});
      const prepared=await preparePrivacyInlineUpload({currentContext:()=>({...context(entry),state:load()}),path,selection:entry.selection});entry.legacyProof=prepared.proof;
      const saved=await registry(entry,held).save(prepared.file),before=load(),next=clone(before);
      let parent=next;for(const part of path.slice(0,-1))parent=parent[part];parent[path.at(-1)]=saved.file.ref;
      registry(entry,held,(after,actor,reservation)=>privacyUploadAttachmentSlots(before,after,actor,entry.command,{},null,reservation,{legacyProof:prepared.proof})).stageAttach(next,[saved.id]);
      commit(next,{expectedStateToken:hash(before)});
    });}catch{pending.push(path);}
    return {migrated:paths.length-pending.length,pending};
  }
  return Object.freeze({save,begin,release,rebind,resume,metadata,stage,migratePublicInline});
}
