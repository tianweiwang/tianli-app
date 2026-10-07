const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const prepared=JSON.parse(fs.readFileSync(path.join(__dirname,'prepared-release.json'),'utf8'));
const root=prepared.site;
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.md':'text/plain; charset=utf-8','.json':'application/json; charset=utf-8'};
http.createServer((req,res)=>{
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
  if(pathname==='/favicon.ico'){res.writeHead(204);return res.end();}
  if(pathname==='/tianli'){res.writeHead(301,{Location:'/tianli/'});return res.end();}
  if(!pathname.startsWith('/tianli/')){res.writeHead(404);return res.end();}
  let file=path.resolve(root,'.'+pathname.slice('/tianli'.length));
  if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
  if(fs.existsSync(file)&&fs.statSync(file).isDirectory()){
    if(!pathname.endsWith('/')){res.writeHead(301,{Location:encodeURI(pathname+'/')});return res.end();}
    file=path.join(file,'index.html');
  }
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
}).listen(4185,'127.0.0.1',()=>console.log('Prepared release: http://127.0.0.1:4185/tianli/'));
