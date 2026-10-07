// Original KEY/session runtime. The app owns actual producer/source guards.
// A held capability is created per lock callback and expires before the next one.
import {createPrivacyUploadTabs} from './privacy-upload-tabs.mjs';
import {lifecycleFingerprint as hash} from './organization-lifecycle-projection.mjs';

const fail=message=>{throw Error(message);};
export function createAppSessionRuntime({key,storage,sessionStorage,locks,currentContext,scopeForDraft,listStoredRefs,technicalTransition,revisionPlan,initialHandover,id}={}) {
  if(typeof key!=='string'||!key||!storage||!sessionStorage||typeof currentContext!=='function'||typeof scopeForDraft!=='function')fail('原草稿运行依赖尚未接入。');
  let queue=Promise.resolve(),registered=false,tabs;
  const reliable=()=>typeof locks?.request==='function';
  const load=()=>{let raw,value;try{raw=storage.getItem(key);if(!raw)fail('原账本缺失，草稿保留待核。');value=JSON.parse(raw);}catch(error){fail('原账本读取失败，草稿保留：'+error.message);}if(value?.schema!==5)fail('原账本版本不兼容，草稿保留。');return value;};
  const commit=(next,{expectedStateToken}={})=>{if(hash(load())!==expectedStateToken)fail('原账本已变化，本次草稿事实待核。');const raw=JSON.stringify(next);storage.setItem(key,raw);if(storage.getItem(key)!==raw)fail('草稿账本实际持久回读不一致。');};
  async function withMutation(action,{requireLock=false}={}){
    if(typeof action!=='function')fail('原事务回调缺失。');
    const run=async coordinated=>{
      let alive=true;const owned=new Set();
      const check=()=>{if(!alive)fail('原 KEY 持锁上下文已结束。');};
      const held=work=>{check();if(!coordinated)fail('当前环境没有可靠的同源存储锁，附件和覆盖核验暂不可用。');const operation=Promise.resolve().then(()=>{check();return work();});owned.add(operation);operation.then(()=>owned.delete(operation),()=>owned.delete(operation));return operation;};
      Object.defineProperty(held,'assertActive',{value:check});Object.freeze(held);
      const bound=tabs.bindMutation(held);
      const capability=Object.freeze({coordinated,load:()=>{check();return load();},commit:(next,options)=>{check();return commit(next,options);},
        uncoordinated:async writer=>{check();if(coordinated)fail('已协调原事务必须使用准确协议 writer。');let writerAlive=true;const guard=()=>{check();if(!writerAlive)fail('原普通 writer上下文已结束。');};const view=Object.freeze({getItem:key=>{guard();return sessionStorage.getItem(key);},setItem:(key,value)=>{guard();sessionStorage.setItem(key,value);},removeItem:key=>{guard();sessionStorage.removeItem(key);}});try{return await writer(view);}finally{writerAlive=false;}},
        held,tabs:bound,ensureRegistered:async()=>{check();if(!coordinated)return{status:'uncoordinated'};if(!registered){await bound.register();registered=true;}check();return{status:'registered'};}});
      try{return await action(capability);}finally{alive=false;while(owned.size)await Promise.allSettled([...owned]);}
    };
    if(reliable())return locks.request(key,()=>run(true));
    if(requireLock)fail('当前环境没有可靠的同源存储锁，附件和覆盖核验暂不可用。');
    return run(false);
  }
  const enqueue=action=>{const next=queue.then(action);queue=next.catch(()=>{});return next;};
  tabs=createPrivacyUploadTabs({key,load,commit,sessionStorage,currentContext:()=>({...currentContext(),writerProtocolVersion:1}),scopeForDraft,
    withMutation:work=>withMutation(()=>work(),{requireLock:true}),listStoredRefs:listStoredRefs||(()=>fail('原文件库清单尚未接入。')),technicalTransition,revisionPlan,initialHandover,id});
  const initialize=()=>enqueue(()=>withMutation(async cap=>cap.ensureRegistered()));
  const mutate=(kind,writer,options)=>enqueue(()=>withMutation(async cap=>{await cap.ensureRegistered();return cap.coordinated?cap.tabs.mutate(kind,writer,options):{result:await cap.uncoordinated(writer),status:'uncoordinated',revision:null};}));
  const restoreScoped=(keys,reader)=>enqueue(()=>withMutation(async cap=>{await cap.ensureRegistered();if(cap.coordinated)return cap.tabs.restoreScoped(keys,reader);const raw=currentContext(),state=load(),allowed=new Map();for(const key of keys){const value=sessionStorage.getItem(key);if(value!=null)scopeForDraft({state,actor:raw.actor,originScope:raw.originScope,identity:tabs.identity(),key,value,operation:'restore'});allowed.set(key,value);}const view=Object.freeze({getItem:key=>{if(!allowed.has(key))fail('只能恢复当前原草稿。');return allowed.get(key);}});return{result:await(reader||((s)=>Object.fromEntries(keys.map(key=>[key,s.getItem(key)]))))(view),status:'uncoordinated',receipt:null};}));
  const transition=kind=>enqueue(()=>withMutation(async cap=>{if(!cap.coordinated)fail('未协调身份写须使用原普通入口，不能登记覆盖。');return cap.tabs.transition(kind);}));
  return Object.freeze({identity:tabs.identity,reliable,load,withMutation,enqueue,flush:()=>queue,initialize,mutate,restoreScoped,transition,resumeSource:tabs.resumeSource,coverage:()=>enqueue(()=>tabs.coverage())});
}
