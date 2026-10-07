import { qualificationEvidenceRefs, qualificationUploadScope } from './tech-qualification.mjs';
import { saveInvoiceFile } from './invoice-files.mjs';

export function parseQualificationFormEvidence(value) {
  return qualificationEvidenceRefs(typeof value==='string'?JSON.parse(value||'[]'):value);
}
export async function saveQualificationUpload(files,type,payload,{currentContext,saveFile=saveInvoiceFile}={}) {
  if(typeof currentContext!=='function'||typeof saveFile!=='function')throw Error('当前资格凭证选择来源或保存接口尚未接入');
  const p=structuredClone(payload),readScope=()=>{const context=currentContext();if(!context?.state||!context.actor)throw Error('当前资格凭证选择来源已失效');return qualificationUploadScope(context.state,context.actor,type,p);};
  const original=readScope(),recheck=()=>{if(JSON.stringify(readScope())!==JSON.stringify(original))throw Error('账号、原技师、资格档案或凭证来源已变化，请重新选择。');};
  const chosen=Array.from(files||[]);
  if(!chosen.length)throw Error('请选择实际资格凭证文件。');
  if(chosen.some(file=>!(file instanceof Blob)||!['application/pdf','image/png','image/jpeg'].includes(file.type)||!Number.isSafeInteger(file.size)||file.size<1||file.size>5*1024*1024))throw Error('请选择每份5 MiB以内的完整PDF、PNG或JPEG凭证。');
  const saved=[];
  for(const file of chosen){recheck();saved.push(await saveFile(file));recheck();qualificationEvidenceRefs(saved);}
  recheck();return qualificationEvidenceRefs(saved);
}
