'use strict';
window.SAFE_EXPORT_NAME=value=>String(value).replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g,'、').replace(/\s*、\s*/g,'、').replace(/[ .]+$/g,'').normalize('NFC');
window.SCREEN_GROUPS=[...new Set(window.SCREENS.map(s=>s.group))];
const roleCounts={user:0,tech:0,store:0};
const files=new Set();
window.SCREENS.forEach((screen,index)=>{const prefix=screen.role==='user'?'U':screen.role==='tech'?'T':'S';screen.no=prefix+String(++roleCounts[screen.role]).padStart(2,'0');screen.file=window.SAFE_EXPORT_NAME(screen.no+'-'+screen.title+'-'+screen.state+'.png');screen.ref=screen.ref||'预约版-v0.4 需求说明';screen.displayOrder=index;if(files.has(screen.file.toLowerCase()))throw new Error('导出名称重复');files.add(screen.file.toLowerCase());});
