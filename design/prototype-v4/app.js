'use strict';
window.renderBooking=()=>{
  const runtime=window.BookingRuntime,id=runtime.getScreen(),render=window.ScreenRenderers[id],app=document.getElementById('app');
  if(!render){app.innerHTML=window.UI.page({title:'页面不存在',body:window.UI.hero('页面暂不可用','请返回预约首页。'),foot:window.UI.footer(window.UI.link('返回首页','u-home','primary full'))});document.body.dataset.ready='1';return;}
  app.innerHTML=render(runtime.renderState());
  if(runtime.isLive())for(const input of app.querySelectorAll('input,textarea,select')){const saved=runtime.getState().drafts[id]?.[input.name];if(saved===undefined||input.type==='file')continue;if(input.type==='checkbox')input.checked=!!saved;else if(input.type==='radio')input.checked=input.value===saved;else input.value=saved;}
  app.querySelectorAll('[data-action="finish-appointment"]').forEach(button=>{const s=runtime.renderState();if(document.querySelector('[name="finishType"]:checked')?.value==='normal')button.disabled=s.stage!=='active'||s.elapsed<s.duration+s.extensionPayments.length*30;});
  document.title='天俪 · '+window.SCREENS.find(s=>s.id===id).title;lucide.createIcons();document.body.dataset.ready='1';
};
document.addEventListener('DOMContentLoaded',()=>{window.renderBooking();if(window.BookingRuntime.isLive())window.BookingRuntime.save();});
