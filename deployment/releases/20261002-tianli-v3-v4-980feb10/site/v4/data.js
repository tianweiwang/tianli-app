'use strict';
(() => {
  const stores=[
    {id:'xingfu',name:'天俪·幸福里门店',area:'幸福里片区',address:'幸福路128号',lat:31.231,lng:121.475,hours:'09:00–23:00',phone:'400-800-0132'},
    {id:'silver',name:'天俪·银杏门店',area:'银杏片区',address:'银杏路66号',lat:31.25,lng:121.50,hours:'09:00–23:00',phone:'400-800-0161'},
    {id:'yuan',name:'天俪·雅园门店',area:'雅园片区',address:'雅园路20号',lat:31.215,lng:121.46,hours:'09:00–23:00',phone:'400-800-0109'}
  ];
  const services=[{id:'relax',name:'舒缓放松',duration:60,day:298,night:328,description:'全身舒缓 · 日常放松',icon:'hand'},{id:'neck',name:'肩颈舒缓',duration:45,day:198,night:228,description:'肩颈放松 · 适合久坐人群',icon:'activity'}];
  const techs=[
    {id:'lin',name:'林师傅',storeId:'xingfu',rating:4.9,count:126,services:['relax','neck'],lat:31.238,lng:121.478,available:true},
    {id:'chen',name:'陈师傅',storeId:'xingfu',rating:4.8,count:88,services:['neck'],lat:31.246,lng:121.481,available:true},
    {id:'zhou',name:'周师傅',storeId:'xingfu',rating:null,count:3,services:['relax','neck'],lat:31.222,lng:121.49,available:true},
    {id:'ma',name:'马师傅',storeId:'silver',rating:4.9,count:53,services:['relax','neck'],lat:31.251,lng:121.5,available:true},
    {id:'gao',name:'高师傅',storeId:'silver',rating:4.8,count:42,services:['relax','neck'],lat:31.247,lng:121.505,available:true},
    {id:'su',name:'苏师傅',storeId:'yuan',rating:4.9,count:67,services:['relax','neck'],lat:31.216,lng:121.461,available:true}
  ];
  const regions=[{id:'home',name:'幸福里片区',lat:31.23,lng:121.47},{id:'silver',name:'银杏片区',lat:31.25,lng:121.50},{id:'yuan',name:'雅园片区',lat:31.215,lng:121.46},{id:'outside',name:'其他区域',lat:32,lng:122}];
  const distance=(a,b)=>{const radians=n=>n*Math.PI/180,dlat=radians(b.lat-a.lat),dlng=radians(b.lng-a.lng);return 6371*2*Math.atan2(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dlng/2)**2),Math.sqrt(1-(Math.sin(dlat/2)**2+Math.cos(radians(a.lat))*Math.cos(radians(b.lat))*Math.sin(dlng/2)**2)));};
  const find=(items,id)=>items.find(item=>item.id===id)||items[0];
  const region=id=>find(regions,id);
  const store=id=>find(stores,id),tech=id=>find(techs,id),service=id=>find(services,id);
  const appointmentStart=s=>new Date(s.date+'T'+s.slot+':00+08:00').getTime();
  const overlapsLeave=(s,techId)=>{const leave=s.leaveDetails;if(s.leaveStatus!=='approved'||!leave||leave.techId!==techId)return false;const begin=new Date(leave.startDate+'T'+leave.start+':00+08:00').getTime(),end=new Date(leave.endDate+'T'+leave.end+':00+08:00').getTime(),start=appointmentStart(s);return start<end&&start+(s.duration+(s.extensionPayments?.length||0)*30)*60000>begin;};
  techs.forEach(t=>t.gender=['chen','ma','su'].includes(t.id)?'female':'male');
  const minutes=time=>Number(time.slice(0,2))*60+Number(time.slice(3));
  const available=(s,techId)=>{const t=techs.find(t=>t.id===techId);if(!t||!t.available||overlapsLeave(s,techId))return false;const start=appointmentStart(s),end=start+(s.duration+(s.extensionPayments?.length||0)*30)*60000,from=minutes(s.slot),until=from+(s.duration+(s.extensionPayments?.length||0)*30),schedule=s.schedules?.[techId]||(s.staffTechId===techId?s.schedule:null)||{start:'09:00',end:'23:00',breakStart:'12:00',breakEnd:'13:00'};if(!Number.isFinite(start)||from<minutes(schedule.start)||until>minutes(schedule.end))return false;if(schedule.breakStart&&schedule.breakEnd&&from<minutes(schedule.breakEnd)&&until>minutes(schedule.breakStart))return false;const busy=s.busyBookings||[{techId:'chen',date:s.date,slot:'14:30',duration:60}];return !busy.some(b=>{if(b.techId!==techId||b.orderNo===s.orderNo)return false;const begin=appointmentStart(b),finish=begin+(b.duration||60)*60000;return start<finish&&end>begin;});};
  const eligibleTechs=s=>techs.filter(t=>t.storeId===s.storeId&&t.services.includes(s.serviceId)&&(s.genderPreference==='any'||!s.genderPreference||t.gender===s.genderPreference)&&distance(s.location||region(s.regionId),store(s.storeId))<=20&&available(s,t.id)).map(t=>({...t,distance:distance(s.location||region(s.regionId),t)})).sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
  const nearest=s=>eligibleTechs(s)[0];
  const price=(id,slot)=>service(id)[slot>='21:00'?'night':'day'];
  window.BookingData={stores,techs,services,regions,store,tech,service,region,distance,eligibleTechs,nearest,price,appointmentStart,overlapsLeave,available,minutes};
})();
