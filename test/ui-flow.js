const vm=require('vm'),fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','lib','ui.html'),'utf8');
const code=html.match(/<script>([\s\S]*)<\/script>/)[1];
const calls=[];
class El{
  constructor(tag){this.nodeType=1;this.tag=tag;this.kids=[];this.attrs={};this.classList={add(){},remove(){},toggle(){}};this.style={};this._text='';}
  set textContent(v){this._text=String(v);this.kids=[];} get textContent(){return this._text+this.kids.map(k=>k.textContent??String(k)).join(' ');}
  append(...k){this.kids.push(...k);} replaceChildren(...k){this.kids=k.flat();} before(){} replaceWith(){} remove(){} select(){} click(){}
  setAttribute(k,v){this.attrs[k]=v;} addEventListener(){} get childNodes(){return this.kids;}
  set value(v){this._v=v;} get value(){return this._v??'';}
  all(){return [this,...this.kids.flatMap(k=>k.all?k.all():[])];}
}
const store={}; const sel={};
const document={createElement:t=>new El(t),createTextNode:t=>({textContent:String(t),nodeType:3}),querySelector:s=>sel[s]=sel[s]||new El('div'),addEventListener(){},body:new El('body'),execCommand(){}};
const fetchMock=async(p,o={})=>{calls.push((o.method||'GET')+' '+p);
  const body=p==='/api/status'?{version:'1.5.0',profiles:true,serverTmdbKey:true}:p==='/api/providers'?{providers:[{id:'a',name:'A.',version:'1',enabled:true,settings:[],domains:[]}]}:{};
  return {ok:true,status:200,json:async()=>body};};
const ctx=vm.createContext({document,localStorage:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
 location:{origin:'https://hub.test',pathname:'/',hash:'',},history:{replaceState(){}},fetch:fetchMock,navigator:{},addEventListener(){},prompt(){},confirm(){return true},
 TextEncoder,TextDecoder,btoa,atob,Uint8Array,URL,Blob:class{},console,setTimeout,clearTimeout});
vm.runInContext(code,ctx);
const run=s=>vm.runInContext(s,ctx);
(async()=>{
  await new Promise(r=>setTimeout(r,50));
  const urls=sel['#urls'];
  const txt=()=>urls.all().map(e=>e.textContent).join('|');
  const ok=(c,m)=>{console.log(c?'PASS':'FAIL',m); if(!c) process.exitCode=1;};
  ok(run('snap')&&run('snap').scope.startsWith('/c/'),'a link is generated on load');
  ok(!txt().includes('settings changed'),'no out-of-date notice at first');
  const before=run('snap.scope');
  run("cfg.sort='quality'; onChange()");
  ok(txt().includes('settings changed'),'notice appears after a setting changes');
  ok(run('snap.scope')===before,'link does NOT change by itself');
  await new Promise(r=>setTimeout(r,1500));
  ok(!calls.some(c=>/^(POST|PUT) /.test(c)),'no save request is ever sent automatically: '+JSON.stringify(calls));
  run('generateLink()');
  ok(run('snap.scope')!==before,'Generate new link makes a new link');
  ok(!txt().includes('settings changed'),'notice clears after generating');
  ok(run('typeof saveTimer')==='undefined','no autosave timer exists');
})();
