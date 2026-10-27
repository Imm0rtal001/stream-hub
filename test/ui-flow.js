const vm=require('vm'),fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','lib','ui.html'),'utf8');
const code=html.match(/<script>([\s\S]*)<\/script>/)[1];
const calls=[];
const PROFILES=process.argv[2]!=='nostore';
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
  const body=p==='/api/profile'?{id:'a'.repeat(18),secret:'b'.repeat(48)}:p==='/api/status'?{version:'1.6.0',profiles:PROFILES,serverTmdbKey:true}:p==='/api/providers'?{providers:[{id:'a',name:'A.',version:'1',enabled:true,settings:[],domains:[]}]}:{};
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
  if(PROFILES){
    ok(calls.includes('POST /api/profile'),'a permanent profile is created automatically on first visit');
    ok(run('profile')&&run('profile.id').length===18,'profile is remembered');
    ok(urls.all().some(e=>String(e._v||'').includes('/u/'+'a'.repeat(18)+'/manifest.json')),'install links use the permanent /u/ link');
    const puts=()=>calls.filter(c=>c.startsWith('PUT ')).length;
    ok(puts()===0,'nothing is sent before a change');
    run("cfg.sort='quality'; onChange()");
    run("cfg.timeoutMs=30000; onChange()");
    await new Promise(r=>setTimeout(r,1200));
    ok(puts()===1,'rapid changes are saved automatically in one debounced request, got '+puts());
    ok(run('profileDirty')===false,'dirty flag clears after the save');
    ok(run('saveState.text').startsWith('Saved automatically'),'status says saved automatically');
    run("cfg.maxPerProvider=5; onChange()");
    await new Promise(r=>setTimeout(r,1200));
    ok(puts()===2,'a later change is saved too');
  } else {
    ok(!calls.some(c=>c.startsWith('POST ')),'no profile is created without a server store');
    const before=run('snap.scope');
    run("cfg.sort='quality'; onChange()");
    ok(run('snap.scope')!==before,'without a store the link regenerates by itself on change');
    ok(txt().includes('reinstall'),'tells the person to reinstall because Stremio keeps the old link');
  }
})();
