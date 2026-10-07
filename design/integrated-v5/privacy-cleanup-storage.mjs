// Same-origin, exact-key IndexedDB I/O. This adapter never enumerates another origin.
const stores = Object.freeze({ invoice:{db:'tianli-integrated-invoice-files-v1',store:'files',pattern:/^invoice-file:[a-f0-9]{64}$/}, media:{db:'tianli-integrated-media-v1',store:'images',pattern:/^media:[a-f0-9]{64}$/} });
const clone = v => v == null ? v : structuredClone(v);
export function createPrivacyCleanupStorage({ indexedDB = globalThis.indexedDB, originScope, releaseRef } = {}) {
  if (!indexedDB?.open || typeof originScope!=='string' || !originScope.trim()) throw Error('清理存储须绑定当前origin与实际IndexedDB');
  const connections=new Map();
  const library = (name,ref) => {const result=stores[name];if(!result||ref!=null&&!result.pattern.test(ref))throw Error('文件库或准确引用无效');return result;};
  async function open(name,journal=false) {
    const dbName=journal?'tianli-integrated-privacy-cleanup-v1':library(name).db;
    if(connections.has(dbName))return connections.get(dbName);
    const promise=new Promise((resolve,reject)=>{
      const request=indexedDB.open(dbName,1);
      request.onupgradeneeded=()=>{if(journal)request.result.createObjectStore('jobs');else {request.transaction.abort();reject(Error('原文件库尚不存在；清理不能建立替代空库'));}};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(Error(journal?'持久清理journal无法打开':'原文件库无法打开，不能把读取失败当已删除'));
    });
    connections.set(dbName,promise);try{return await promise;}catch(error){connections.delete(dbName);throw error;}
  }
  async function readStoredRef(name,ref) {
    const definition=library(name,ref),db=await open(name);
    return new Promise((resolve,reject)=>{const tx=db.transaction(definition.store,'readonly'),request=tx.objectStore(definition.store).get(ref);let value;
      request.onsuccess=()=>{value=request.result;};request.onerror=()=>reject(Error('原附件回读失败'));
      tx.oncomplete=()=>resolve(value??null);tx.onerror=tx.onabort=()=>reject(Error('原附件回读事务失败'));
    });
  }
  async function hasStoredRef(name,ref){return (await readStoredRef(name,ref))!==null;}
  async function listStoredRefs(name) {
    const definition=library(name),db=await open(name);
    return new Promise((resolve,reject)=>{const tx=db.transaction(definition.store,'readonly'),request=tx.objectStore(definition.store).getAllKeys();let keys;
      request.onsuccess=()=>{keys=request.result;};request.onerror=()=>reject(Error('文件引用目录读取失败'));
      tx.oncomplete=()=>resolve((keys||[]).map(ref=>({ref,library:name,valid:definition.pattern.test(String(ref))})));tx.onerror=tx.onabort=()=>reject(Error('文件目录事务失败'));
    });
  }
  async function deleteStoredRef(name,ref,{beforeDelete}={}) {
    const definition=library(name,ref);if(typeof beforeDelete!=='function')throw Error('删除前缺少当前原来源和权限核验');const db=await open(name);let existed=false;
    await new Promise((resolve,reject)=>{const tx=db.transaction(definition.store,'readwrite'),store=tx.objectStore(definition.store),request=store.get(ref);let reason;
      request.onsuccess=()=>{try{if(beforeDelete()!==true)throw Error('当前清理权限或来源已变化');existed=request.result!=null;if(existed)store.delete(ref);}catch(error){reason=error;tx.abort();}};
      request.onerror=()=>{reason=Error('删除前原文件读取失败');tx.abort();};tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(reason||Error('原附件删除事务失败，不能标记已删'));
    });
    const result={library:name,ref,originScope,transactionCommitted:true,status:existed?'deleted_unverified':'absence_unverified',existed};
    try {result.absent=!(await hasStoredRef(name,ref));result.status=result.absent?(existed?'deleted':'already_absent'):'delete_not_absent';}catch(error){result.readbackError=error.message;}
    if(result.absent&&releaseRef){try{await releaseRef(name,ref);result.cacheReleased=true;}catch(error){result.cacheReleased=false;result.cacheError=error.message;}}
    return result;
  }
  async function getJob(id) {
    if(typeof id!=='string'||!id)throw Error('清理单编号无效');const db=await open(null,true);
    return new Promise((resolve,reject)=>{const tx=db.transaction('jobs','readonly'),request=tx.objectStore('jobs').get(id);let value;request.onsuccess=()=>{value=request.result;};request.onerror=()=>reject(Error('清理journal读取失败'));tx.oncomplete=()=>resolve(clone(value)??null);tx.onerror=tx.onabort=()=>reject(Error('清理journal读取事务失败'));});
  }
  async function saveJob(job,expectedRevision) {
    if(!job||typeof job.id!=='string'||!job.id||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||job.revision!==expectedRevision+1||job.originScope!==originScope)throw Error('清理journal版本或当前origin无效');
    const db=await open(null,true);
    await new Promise((resolve,reject)=>{const tx=db.transaction('jobs','readwrite'),store=tx.objectStore('jobs'),request=store.get(job.id);let reason;
      request.onsuccess=()=>{if((request.result?.revision??0)!==expectedRevision){reason=Error('清理journal已更新，不能覆盖原执行证据');tx.abort();return;}store.put(clone(job),job.id);};request.onerror=()=>{reason=Error('原清理journal读取失败');tx.abort();};tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(reason||Error('清理journal持久写入失败，未确认准备/结果'));});return clone(job);
  }
  return {originScope,listStoredRefs,readStoredRef,hasStoredRef,deleteStoredRef,getJob,saveJob};
}
