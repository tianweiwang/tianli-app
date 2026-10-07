import { careEvidenceRefs, careUploadScope } from './service-care.mjs';
import { resolveAccountActor, assertAccountCommand } from './staff-accounts.mjs';
import { privacyUseClosed } from './privacy.mjs';
import { closedRightsBinding } from './privacy-closed-rights.mjs';
import { saveInvoiceFile } from './invoice-files.mjs';

export function parseCareFormEvidence(value) {
  return careEvidenceRefs(typeof value === 'string' ? JSON.parse(value || '[]') : value);
}
const userScope=(s,a,kind,id)=>{if(privacyUseClosed(s,a.userId))closedRightsBinding(s,a,kind,id);};
export async function saveCareUpload(files,type,payload,{currentContext,saveFile=saveInvoiceFile}={}) {
  if(typeof currentContext!=='function')throw new Error('当前图片选择来源未接入');
  const readScope=()=>{
    const context=currentContext();
    if(!context?.state||!context.actor)throw new Error('当前图片选择来源已失效');
    const actor=resolveAccountActor(context.state,context.actor);assertAccountCommand(actor,type);
    return careUploadScope(context.state,actor,type,payload,{assertUserScope:userScope});
  };
  const original=readScope();
  const recheck=()=>{if(JSON.stringify(readScope())!==JSON.stringify(original))throw new Error('身份、原预约、案件或图片数量已变化，请重新选择。');};
  const chosen=Array.from(files || []);
  if(!chosen.length||chosen.length>original.available)throw new Error(`本次请选择1至${original.available}张图片；案件合计最多6张。`);
  if(chosen.some(f=>!['image/png','image/jpeg'].includes(f.type)||!Number.isSafeInteger(f.size)||f.size<1||f.size>5*1024*1024))throw new Error('请选择每张5 MiB以内的完整PNG或JPEG图片。');
  const saved=[];
  for(const file of chosen){recheck();saved.push(await saveFile(file));recheck();careEvidenceRefs(saved);if(saved.some(f=>original.existingRefs.includes(f.ref)))throw new Error('已提交的原图片不能重复，请选择新的证据。');}
  recheck();return careEvidenceRefs(saved);
}
