/* =========================================================
   SOLARTOUCH Project Hub
   One codebase, three storage backends:
   - Firebase (GitHub Pages build, firebase-config.js filled in)
   - Claude artifact (window.claude runtime)
   - Demo (in-memory, nothing saved)
   ========================================================= */
(function(){
'use strict';
const CFG=window.SOLARTOUCH_CONFIG||{};
const FBCFG=CFG.firebase||{};
const LOGO=window.SOLARTOUCH_LOGO||'logo.png';
const ADMIN_EMAILS=(CFG.adminEmails||[]).map(e=>String(e).toLowerCase());

/* ---------- domain ---------- */
const STAGES=[
  {k:'lead',   t:'รับงาน / ลูกค้าใหม่',           s:'รับงาน',           g:'sales'},
  {k:'quote',  t:'สำรวจหน้างาน / เสนอราคา',       s:'สำรวจ/เสนอราคา',   g:'sales'},
  {k:'deal',   t:'ลูกค้าอนุมัติ',                 s:'อนุมัติ',           g:'sales'},
  {k:'install',t:'ติดตั้งแล้วเสร็จ',               s:'ติดตั้งแล้วเสร็จ',    g:'permit'},
  {k:'grid',   t:'ยื่นขนานไฟกับการไฟฟ้า',          s:'ยื่นขนาน',          g:'permit'},
  {k:'done',   t:'COD · ขนานไฟสำเร็จ',             s:'COD',              g:'done'}
];
// jobs saved before the 6-step flow (no sv:2) are mapped onto the new steps
const LEGACY_STAGE={lead:'lead',survey:'quote',quote:'quote',deal:'deal',permit:'deal',install:'deal',grid:'install',inspect:'grid',done:'done'};
function normJob(j){if(!j||j.sv===2)return j;const k=LEGACY_STAGE[j.stage]||'lead';const st=j.steps||{};
  const steps={lead:st.lead,quote:st.quote||st.survey,deal:st.deal||st.permit||st.install,install:st.grid,grid:st.inspect,done:st.done};Object.keys(steps).forEach(x=>steps[x]==null&&delete steps[x]);
  return{...j,stage:k,steps,_legacy:true}}
const LEGACY_INST={survey:'quote',permit:'deal',install:'deal',grid:'install',inspect:'grid'};
const SIDX=Object.fromEntries(STAGES.map((s,i)=>[s.k,i]));
const STAGE_COLOR=i=>i<3?'var(--blue)':i<5?'var(--orange)':'var(--good)';
const STAGE_HEX=i=>i<3?'#1E4FD6':i<5?'#F0661A':'#11905A';
const DOCS=[
  {a:'เอกสารลูกค้า', items:[
    ['idcard','สำเนาบัตรประชาชนเจ้าของบ้าน'],
    ['house','สำเนาทะเบียนบ้าน / เอกสารสิทธิ์ที่ดิน'],
    ['bill','ใบแจ้งค่าไฟล่าสุด (เลขผู้ใช้ไฟ / CA)']]},
  {a:'ท้องถิ่น (อบต. / เทศบาล)', items:[
    ['struct','หนังสือรับรองโครงสร้างหลังคา ลงนามวิศวกรโยธา'],
    ['local','แจ้งดัดแปลงอาคาร (แบบ อ.1 / หนังสือรับแจ้ง)']]},
  {a:'กกพ. (ERC)', items:[
    ['erc','แจ้งขอยกเว้นใบอนุญาตผลิตไฟฟ้า']]},
  {a:'การไฟฟ้า (กฟภ. / กฟน.)', items:[
    ['sld','Single Line Diagram ลงนามวิศวกรไฟฟ้า'],
    ['license','สำเนาใบอนุญาต กว. ของวิศวกรผู้ลงนาม'],
    ['spec','สเปกอินเวอร์เตอร์ (อยู่ในบัญชีการไฟฟ้า) และแผง'],
    ['form','แบบคำร้องขอเชื่อมต่อระบบผลิตไฟฟ้า'],
    ['photo','รูปถ่ายงานติดตั้งเสร็จสมบูรณ์']]}
];
const DOC_KEYS=DOCS.flatMap(g=>g.items.map(i=>i[0]));
const PHOTO_CATS=[
  ['overview','ภาพรวมการติดตั้ง'],
  ['firmware','Firmware Inverter'],
  ['ct','Zero Export Controller – จุดคล้อง CT'],
  ['zeroset','Zero Export Controller – การตั้งค่ากันย้อน'],
  ['tie','จุดเชื่อมต่อขนานไฟ'],
  ['combiner','ตู้ Combiner Box']
];
const PCAT=Object.fromEntries(PHOTO_CATS);
const APPT={survey:['สำรวจหน้างาน','#1E4FD6'],install:['ติดตั้ง','#F0661A'],utility:['การไฟฟ้า','#0A2350'],meet:['นัดลูกค้า','#11905A'],other:['อื่นๆ','#7783A0']};
const ROOFS=['เมทัลชีท','กระเบื้องลอนคู่','กระเบื้องซีแพค / CPAC','กระเบื้องดินเผา','ดาดฟ้าคอนกรีต'];
const KWH_PER_KWP_DAY=3.8, ONLINE_MS=75000, HEARTBEAT_MS=30000;
const TH_DOW=['อา','จ','อ','พ','พฤ','ศ','ส'];

/* ---------- state ---------- */
const S={fin:new Map(),bonus:new Map(),settings:null,permsDoc:null,roleMap:{},ownerId:null,previewRole:'',baseWrite:true,payFilter:'open',bMonth:'all',bTab:'crew',jobs:new Map(),loaded:false,mode:'connecting',view:'dash',open:null,tab:'info',q:'',stageFilter:'',pmFilter:'',
  me:null,email:'',isAdmin:false,member:false,canWrite:true,peers:[],prof:{},team:new Set(),members:[],drawerDirty:false,
  photos:[],photoJob:null,photosLoaded:false,cal:null,calSel:null,mapStage:'',lb:null};
let BK=null;      // storage backend
let dl=null;      // artifact downloads capability (null elsewhere)
let FB=null;      // firebase auth handles

/* ---------- utils ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(+n||0).toLocaleString('th-TH');
const fmt1=n=>(+n||0).toLocaleString('th-TH',{maximumFractionDigits:1});
const dTH=t=>t?new Date(t).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'}):'–';
const tTH=t=>t?new Date(t).toLocaleString('th-TH',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
const ymd=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const parseYmd=s=>{const [y,m,d]=String(s).split('-').map(Number);return new Date(y,m-1,d)};
const dLong=s=>parseYmd(s).toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short',year:'2-digit'});
function ago(t){if(!t)return'';const m=Math.round((Date.now()-t)/60000);if(m<1)return'เมื่อสักครู่';if(m<60)return m+' นาทีที่แล้ว';const h=Math.round(m/60);if(h<24)return h+' ชม.ที่แล้ว';return Math.round(h/24)+' วันที่แล้ว'}
const days=t=>t?Math.floor((Date.now()-t)/86400000):0;
function deepMerge(a,b){for(const k in b){const v=b[k];if(v&&typeof v==='object'&&!Array.isArray(v)&&a[k]&&typeof a[k]==='object'&&!Array.isArray(a[k]))deepMerge(a[k],v);else a[k]=(v&&typeof v==='object')?JSON.parse(JSON.stringify(v)):v}return a}
function toast(m){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(toast.h);toast.h=setTimeout(()=>t.hidden=true,3000)}
const rid=p=>(p||'x')+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
function hue(s){let h=0;for(const c of String(s))h=(h*31+c.charCodeAt(0))%360;return h}
function nm(id){if(!id)return'ยังไม่กำหนด';const p=S.prof[id];if(p&&p.name)return p.name;wantProfile(id);return id===S.me?'คุณ':'สมาชิกทีม'}
function av(id,cls=''){if(!id)return'';const p=S.prof[id]||{};wantProfile(id);if(p.photo)return `<img class="av ${cls}" src="${esc(p.photo)}" alt="" referrerpolicy="no-referrer">`;
  const n=(p.name||p.email||'?').trim();return `<span class="av ini ${cls}" style="background:hsl(${hue(id)} 55% 42%)">${esc(n.charAt(0).toUpperCase())}</span>`}
function avName(name,cls=''){return `<span class="av ini ${cls}" style="background:hsl(${hue(name)} 40% 50%)">${esc((name||'?').charAt(0))}</span>`}
const pmName=j=>j.pm?nm(j.pm):(j.pmName||'');
const pmAv=(j,cls)=>j.pm?av(j.pm,cls):j.pmName?avName(j.pmName,cls):'';

function quoteTotals(j){const items=j.quote?.items||[];const sub=items.reduce((a,i)=>a+(+i.q||0)*(+i.p||0),0);const disc=Math.max(0,+j.quote?.discount||0);const net=Math.max(0,sub-disc);const vat=net*0.07;return{sub,disc,net,vat,total:net+vat}}
function estimate(j){const kw=+j.kw||0;const tariff=+(j.quote?.tariff??4.2)||4.2;const day=kw*KWH_PER_KWP_DAY;const month=day*30;const yearSave=day*365*tariff;const {total}=quoteTotals(j);return{month,monthSave:month*tariff,payback:yearSave?total/yearSave:0,ppw:kw?total/(kw*1000):0,tariff}}
function permitProg(j){const p=j.permits||{};const d=DOC_KEYS.filter(k=>p[k]?.done).length;return{d,n:DOC_KEYS.length,pct:Math.round(d/DOC_KEYS.length*100)}}
function photoProg(j){const c=j.photos||{};const d=PHOTO_CATS.filter(([k])=>(c[k]||0)>0).length;return{d,n:PHOTO_CATS.length}}
function stagePill(k){const s=STAGES[SIDX[k]]||STAGES[0];return `<span class="pill p-${s.g}">${esc(s.s)}</span>`}
const hasLoc=j=>j.lat!=null&&j.lat!==''&&Number.isFinite(+j.lat)&&Number.isFinite(+j.lng)&&!(+j.lat===0&&+j.lng===0);
const gmapsUrl=j=>hasLoc(j)?`https://www.google.com/maps/search/?api=1&query=${+j.lat},${+j.lng}`:(j.mapUrl||'');
const gdirUrl=j=>hasLoc(j)?`https://www.google.com/maps/dir/?api=1&destination=${+j.lat},${+j.lng}`:(j.mapUrl||'');

/* parse a pasted Google Maps link or "lat, lng" */
function parseLoc(txt){let s=String(txt||'').trim();try{s=decodeURIComponent(s)}catch{}if(!s)return null;
  const pats=[/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,/@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,/[?&](?:q|query|ll|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,/^\s*\(?\s*(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*\)?\s*$/,/(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{2,3}\.\d{4,})/];
  for(const p of pats){const m=s.match(p);if(m){const a=+m[1],b=+m[2];if(Math.abs(a)<=90&&Math.abs(b)<=180)return{lat:+a.toFixed(6),lng:+b.toFixed(6)}}}
  return null}

function buildItems(j){
  const kw=Math.max(1,+j.kw||5),W=580,n=Math.ceil(kw*1000/W),three=j.phase==='3',hyb=j.type==='hybrid';
  const inv=kw<=3?28000:kw<=5?36000:kw<=10?(three?62000:58000):(three?95000:90000);
  return[
    {d:`แผงโซลาร์ Mono ${W}W (Tier 1) รับประกันประสิทธิภาพ 25 ปี`,q:n,u:'แผง',p:3900},
    {d:`อินเวอร์เตอร์ ${hyb?'Hybrid':'On-Grid'} ${kw} kW ${three?'3':'1'} เฟส (อยู่ในบัญชีการไฟฟ้า)`,q:1,u:'เครื่อง',p:Math.round(inv*(hyb?1.35:1))},
    ...(hyb?[{d:'แบตเตอรี่ลิเธียม LFP 5 kWh',q:1,u:'ชุด',p:55000}]:[]),
    {d:'รางอะลูมิเนียมและอุปกรณ์ยึดหลังคา',q:n,u:'ชุด',p:950},
    {d:'ตู้ DC/AC Protection (เบรกเกอร์ / Surge / ฟิวส์)',q:1,u:'ตู้',p:9500},
    {d:'สาย PV1-F, สาย AC, ท่อร้อยสาย และกราวด์',q:1,u:'งาน',p:7500},
    {d:'ค่าแรงติดตั้ง ทดสอบ และเดินระบบ',q:kw,u:'kWp',p:2500},
    {d:'ออกแบบ วิศวกรรับรอง และดำเนินการขออนุญาตขนานไฟ',q:1,u:'งาน',p:12000}
  ];
}
function jobCode(){const d=new Date();return `ST-${String(d.getFullYear()+543).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}-${Math.floor(100+Math.random()*900)}`}
/* กลุ่มลูกค้า: กลุ่ม 1 SPECIAL (ส้ม) · กลุ่ม 2 Normal (เขียว) */
const GRP={special:['กลุ่ม 1','SPECIAL'],normal:['กลุ่ม 2','Normal']};
const grpOf=j=>GRP[j&&j.grp]?j.grp:'';
const grpTag=j=>{const g=grpOf(j);return g?`<span class="gtag g-${g}">${GRP[g][1]}</span>`:''};
function makeJob(f,extra={}){const now=Date.now();const loc=parseLoc(f.loc);
  const j={sv:2,code:jobCode(),name:f.name,phone:f.phone||'',email:(f.email||'').trim(),addr:f.addr||'',prov:f.prov||'',util:f.util||'PEA',phase:f.phase||'1',type:f.type||'ongrid',grp:GRP[f.grp]?f.grp:'normal',kw:+f.kw||5,roof:f.roof||ROOFS[0],note:'',
  lat:loc?loc.lat:null,lng:loc?loc.lng:null,mapUrl:f.loc&&/^https?:/.test(String(f.loc).trim())?String(f.loc).trim():'',
  pm:f.pm&&f.pm!=='_other'?f.pm:null,pmName:f.pm==='_other'?(f.pmName||''):'',
  stage:'lead',stageAt:now,steps:{lead:now},createdAt:now,updatedAt:now,createdBy:S.me,updatedBy:S.me,owner:S.me,
  quote:{status:'draft',discount:0,tariff:4.2,items:[]},permits:{},grid:{ref:'',submit:'',inspect:'',meter:''},appts:[],photos:{},
  log:[{t:now,by:S.me,m:'สร้างงานใหม่'}],...extra};
  j.quote.items=buildItems(j);return j}

/* =========================================================
   Backends — common surface:
   put(col,id,data) · patch(col,id,partial) · remove(col,id)
   watch(col,cb,err) · watchWhere(col,field,val,cb,err) · presence(obj)
   ========================================================= */
function memoryBackend(){
  const cols={};const subs=[];const col=c=>cols[c]||(cols[c]=new Map());
  const emit=c=>subs.filter(s=>s.c===c).forEach(s=>s.fire());
  const snap=(c,f)=>[...col(c)].filter(([,d])=>!f||d[f.k]===f.v).map(([id,d])=>({id,data:d}));
  const sub=(c,f,cb)=>{const s={c,fire:()=>cb(snap(c,f))};subs.push(s);setTimeout(s.fire);return()=>{const i=subs.indexOf(s);if(i>=0)subs.splice(i,1)}};
  return{kind:'demo',
    put:(c,id,d)=>{col(c).set(id,JSON.parse(JSON.stringify(d)));emit(c);return Promise.resolve()},
    patch:(c,id,p)=>{const cur=col(c).get(id);if(cur)col(c).set(id,deepMerge(JSON.parse(JSON.stringify(cur)),p));emit(c);return Promise.resolve()},
    remove:(c,id)=>{col(c).delete(id);emit(c);return Promise.resolve()},
    watch:(c,cb)=>sub(c,null,cb),
    watchWhere:(c,k,v,cb)=>sub(c,{k,v},cb),
    presence:()=>{}};
}
function firebaseBackend(db,fs){
  const ref=(c,id)=>fs.doc(db,c,id);
  const map=sn=>sn.docs.map(d=>({id:d.id,data:d.data()}));
  return{kind:'firebase',
    put:(c,id,d)=>fs.setDoc(ref(c,id),d),
    patch:(c,id,p)=>fs.setDoc(ref(c,id),p,{merge:true}),
    remove:(c,id)=>fs.deleteDoc(ref(c,id)),
    watch:(c,cb,err)=>fs.onSnapshot(fs.collection(db,c),{includeMetadataChanges:c==='jobs'},sn=>cb(map(sn),sn.metadata),err||(()=>{})),
    watchWhere:(c,k,v,cb,err)=>fs.onSnapshot(fs.query(fs.collection(db,c),fs.where(k,'==',v)),sn=>cb(map(sn)),err||(()=>{})),
    presence:o=>{if(!S.me||!S.member)return;fs.setDoc(ref('presence',S.me),{job:o.job||null,view:o.view||null,lastSeen:o.away?0:Date.now()}).catch(()=>{})}};
}
function artifactBackend(db,room){
  const chain={};const q=(k,fn)=>(chain[k]=(chain[k]||Promise.resolve()).catch(()=>{}).then(fn));
  const map=sn=>sn.docs.map(d=>({id:d.id,data:d.data()}));
  return{kind:'artifact',
    put:(c,id,d)=>q(c+id,()=>db.doc(c+'/'+id).set(d)),
    patch:(c,id,p)=>q(c+id,()=>db.doc(c+'/'+id).update(p)),
    remove:(c,id)=>q(c+id,()=>db.doc(c+'/'+id).delete()),
    watch:(c,cb,err)=>db.collection(c).onSnapshot(sn=>cb(map(sn),sn.metadata),err||(()=>{})),
    watchWhere:(c,k,v,cb,err)=>db.collection(c).where(k,'==',v).onSnapshot(sn=>cb(map(sn)),err||(()=>{})),
    presence:o=>{if(room)room.presence({job:o.job||null,view:o.view||null,uid:S.me||null}).catch(()=>{})}};
}

/* ---------- writes ---------- */
function writeErr(e){const c=String(e&&e.code||'');console.error(e);
  if(c.includes('permission-denied'))toast('ไม่มีสิทธิ์บันทึก ให้ผู้ดูแลเพิ่มสิทธิ์ของคุณ');
  else if(c==='invalid_argument')toast('บันทึกไม่สำเร็จ ข้อมูลอาจใหญ่เกินไปหรือบัญชีนี้ดูได้อย่างเดียว');
  else if(c.includes('resource-exhausted')||c==='quota_exceeded'||c==='resource_exhausted')toast('พื้นที่จัดเก็บหรือโควตาเต็ม ลบรูป/งานเก่าแล้วลองใหม่');
  else toast('บันทึกไม่สำเร็จ ระบบจะลองใหม่เมื่อกลับมาออนไลน์')}
function createJob(id,doc){return BK.put('jobs',id,doc).catch(writeErr)}
function saveJob(id,patch,msg){const j=S.jobs.get(id);if(!j||!canEditJob(j))return Promise.resolve();const now=Date.now();const full={...patch,updatedAt:now,updatedBy:S.me};
  if(msg)full.log=[...(j.log||[]),{t:now,by:S.me,m:msg}].slice(-60);
  return BK.patch('jobs',id,full).catch(writeErr)}
function delJob(id){BK.remove('jobs',id).catch(writeErr);closeDrawer();toast('ลบงานแล้ว')}
function setStage(id,k){const j=S.jobs.get(id);if(!j||j.stage===k)return;const now=Date.now();saveJob(id,{sv:2,stage:k,stageAt:now,steps:j._legacy?{...j.steps,[k]:now}:{[k]:now}},`ย้ายไปขั้น “${STAGES[SIDX[k]].t}”`)}
function arm(btn,label,fn){if(btn.dataset.armed){fn();return}btn.dataset.armed='1';btn.classList.add('arm');const old=btn.innerHTML;btn.textContent=label;setTimeout(()=>{if(btn.isConnected){delete btn.dataset.armed;btn.classList.remove('arm');btn.innerHTML=old}},3500)}

/* ---------- people ---------- */
let wantQ=new Set(),wantT=0,userCap=null;
function wantProfile(id){if(!id||!BK||BK.kind!=='artifact'||S.prof[id]||wantQ.has(id))return;wantQ.add(id);clearTimeout(wantT);wantT=setTimeout(resolveProfiles,30)}
async function resolveProfiles(){if(!userCap)return;const ids=[...wantQ].filter(i=>!S.prof[i]);if(!ids.length)return;try{const ps=await userCap.profiles(ids);for(const id of ids){const p=ps[id]||{};S.prof[id]={name:p.name||'',photo:p.avatarUrl||''}}scheduleRender()}catch{}}
function teamIds(){const ids=new Set(S.team);if(BK&&BK.kind==='firebase')Object.keys(S.prof).forEach(i=>ids.add(i));
  S.jobs.forEach(j=>{[j.owner,j.pm].forEach(x=>x&&ids.add(x))});if(S.me)ids.add(S.me);return [...ids].filter(Boolean)}
function teamOpts(sel,withOther){const ids=teamIds().sort((a,b)=>nm(a).localeCompare(nm(b),'th'));
  return `<option value="">— ยังไม่กำหนด —</option>${ids.map(id=>`<option value="${esc(id)}" ${sel===id?'selected':''}>${esc(nm(id))}${id===S.me?' (คุณ)':''}</option>`).join('')}${withOther?`<option value="_other" ${sel==='_other'?'selected':''}>อื่นๆ (พิมพ์ชื่อเอง)</option>`:''}`}

/* ---------- demo data ---------- */
function demoJobs(){const js=demoJobsBase();js[0].proposal={mode:'bill',bill:3500,tariff:4.4,dayPct:65,maxKwp:6};js[1].proposal={mode:'bill',bill:6000,tariff:4.4,dayPct:60,maxKwp:8.45};js.forEach((j,i)=>{j.grp=i%3===0?'special':'normal'});return js}
function demoJobsBase(){const D=86400000,now=Date.now(),today=new Date();const dd=n=>ymd(new Date(today.getFullYear(),today.getMonth(),today.getDate()+n));
  const mk=(f,stage,agoD,perm=[],extra={})=>{const j=makeJob(f,{demo:true});const at=now-agoD*D;j.stage=stage;j.stageAt=at;j.createdAt=at-5*D;j.updatedAt=at;j.steps={};STAGES.slice(0,SIDX[stage]+1).forEach((s,i)=>j.steps[s.k]=at-(SIDX[stage]-i)*2*D);perm.forEach(k=>j.permits[k]={done:true,at,by:S.me});j.log=[{t:j.createdAt,by:S.me,m:'สร้างงานใหม่ (ตัวอย่าง)'},{t:at,by:S.me,m:`ย้ายไปขั้น “${STAGES[SIDX[stage]].t}”`}];Object.assign(j,extra);return j};
  const T=[...S.team];
  return[
    mk({name:'คุณวิภาวรรณ ศรีสุข (ตัวอย่าง)',phone:'081-234-5678',email:'wipawan.s@example.com',addr:'หมู่บ้านพฤกษา ถ.บางกรวย-ไทรน้อย',prov:'นนทบุรี',util:'PEA',kw:5,phase:'1',type:'ongrid',loc:'13.8621, 100.4153'},'quote',2,[],{pm:T[1]||null,appts:[{id:'a1',date:dd(2),time:'10:00',type:'meet',note:'นำเสนอใบเสนอราคา',who:T[0]||null}]}),
    mk({name:'คุณธนพล วงศ์ใหญ่ (ตัวอย่าง)',phone:'089-777-1020',email:'thanaphon.w@example.com',addr:'ซ.ลาดพร้าว 101',prov:'กรุงเทพฯ',util:'MEA',kw:10,phase:'3',type:'hybrid',loc:'13.7946, 100.6245'},'deal',9,['idcard','house','bill','struct'],{pm:T[2]||null}),
    mk({name:'คุณศิริพร แก้วมณี (ตัวอย่าง)',phone:'086-555-4412',addr:'ต.บ้านสวน อ.เมือง',prov:'ชลบุรี',util:'PEA',kw:5,phase:'1',type:'ongrid',loc:'13.3611, 100.9847'},'grid',4,DOC_KEYS,{pm:T[1]||null,grid:{ref:'PEA-ชบ-0458',submit:dd(-4),inspect:dd(5),meter:''},photos:{overview:2,firmware:1,ct:1,zeroset:0,tie:1,combiner:1}}),
    mk({name:'คุณอนุชา พรหมมา (ตัวอย่าง)',phone:'092-118-3300',addr:'ต.สุเทพ อ.เมือง',prov:'เชียงใหม่',util:'PEA',kw:3,phase:'1',type:'ongrid',loc:'18.8048, 98.9555'},'quote',1,[],{pm:T[2]||null,appts:[{id:'a2',date:dd(1),time:'09:30',type:'survey',note:'วัดหลังคา ถ่ายรูปตู้ MDB',who:T[2]||null}]}),
    mk({name:'คุณประเสริฐ ทองดี (ตัวอย่าง)',phone:'081-440-7788',addr:'ต.ในเมือง อ.เมือง',prov:'ขอนแก่น',util:'PEA',kw:10,phase:'3',type:'ongrid',loc:'16.4419, 102.8360'},'deal',2,['idcard','house','bill','struct','local','erc','sld','license','spec'],{pm:T[1]||null,appts:[{id:'a3',date:dd(0),time:'08:00',type:'install',note:'ทีมช่าง 4 คน ติดตั้งแผงวันแรก',who:T[1]||null},{id:'a4',date:dd(3),time:'08:00',type:'install',note:'เดินสาย AC + ทดสอบ',who:T[1]||null}]}),
    mk({name:'คุณมาลี จันทร์เพ็ญ (ตัวอย่าง)',phone:'084-900-2211',addr:'ถ.มิตรภาพ',prov:'นครราชสีมา',util:'PEA',kw:8,phase:'3',type:'ongrid',loc:'14.9799, 102.0978'},'done',3,DOC_KEYS,{pm:T[2]||null,grid:{ref:'PEA-นม-1120',submit:dd(-20),inspect:dd(-9),meter:dd(-3)}})
  ]}
async function loadDemo(){if(!S.canWrite)return;for(const j of demoJobs())await createJob(rid('j'),j);toast('เพิ่มงานตัวอย่างแล้ว')}
async function clearDemo(){const ids=[...S.jobs].filter(([,j])=>j.demo).map(([id])=>id);for(const id of ids)await BK.remove('jobs',id).catch(writeErr);toast('ลบงานตัวอย่างแล้ว')}

/* ---------- filters ---------- */
function visibleJobs(){const q=S.q.trim().toLowerCase();let arr=[...S.jobs].map(([id,j])=>({id,...j}));
  if(q)arr=arr.filter(j=>[j.name,j.phone,j.email,j.code,j.prov,j.addr,pmName(j)].join(' ').toLowerCase().includes(q));
  if(S.pmFilter)arr=arr.filter(j=>S.pmFilter==='_none'?!j.pm&&!j.pmName:j.pm===S.pmFilter);
  return arr.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))}
function onlinePeers(){const cut=Date.now()-ONLINE_MS;return S.peers.filter(p=>(p.lastSeen||0)>cut)}
function viewersOf(id){return onlinePeers().filter(p=>p.by!==S.me&&p.job===id)}
function pmFilterHTML(){const ids=[...new Set([...S.jobs.values()].map(j=>j.pm).filter(Boolean))];if(!ids.length)return'';
  return `<select class="in sel-sm" id="pmFilter" aria-label="กรองตามผู้ดูแลโครงการ"><option value="">ผู้ดูแลโครงการ: ทุกคน</option>${ids.map(id=>`<option value="${esc(id)}" ${S.pmFilter===id?'selected':''}>${esc(nm(id))}${id===S.me?' (คุณ)':''}</option>`).join('')}<option value="_none" ${S.pmFilter==='_none'?'selected':''}>ยังไม่มีผู้ดูแล</option></select>`}

/* ---------- events (calendar) ---------- */
function allEvents(){const ev=[];S.jobs.forEach((j,id)=>{
  (j.appts||[]).forEach(a=>a.date&&ev.push({date:a.date,time:a.time||'',type:a.type||'other',title:(APPT[a.type]||APPT.other)[0],note:a.note||'',who:a.who||null,job:id,name:j.name,aid:a.id}));
  const g=j.grid||{};
  if(g.submit)ev.push({date:g.submit,time:'',type:'utility',title:'ยื่นคำร้องขนานไฟ',job:id,name:j.name});
  if(g.inspect)ev.push({date:g.inspect,time:'',type:'utility',title:'การไฟฟ้านัดตรวจ',job:id,name:j.name});
  if(g.meter)ev.push({date:g.meter,time:'',type:'utility',title:'เปลี่ยนมิเตอร์',job:id,name:j.name});
});return ev.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))}

/* ---------- render ---------- */
let raf=0;function scheduleRender(){if(raf)return;raf=requestAnimationFrame(()=>{raf=0;render()})}
function render(){applyPerms();renderChrome();renderView();renderDrawer();renderLightbox()}
const TITLES={dash:'ภาพรวม',board:'บอร์ดงานติดตั้ง',cal:'ปฏิทินงาน',map:'แผนที่งานติดตั้ง',list:'รายการลูกค้า',team:'ทีมงาน',pay:'สถานะการจ่ายเงิน',bonus:'Job Bonus',perm:'สิทธิ์การใช้งาน'};
function renderChrome(){
  if((S.view==='pay'&&!can('finance.view'))||(S.view==='bonus'&&!can('bonus.view.all')&&!can('bonus.view.own'))||(S.view==='perm'&&realRole()!=='admin'))S.view='dash';
  $('#vtitle').textContent=TITLES[S.view];
  document.querySelectorAll('.nav [data-view="pay"]').forEach(b=>b.hidden=!can('finance.view'));
  document.querySelectorAll('.nav [data-view="bonus"]').forEach(b=>b.hidden=!can('bonus.view.all')&&!can('bonus.view.own'));
  document.querySelectorAll('.nav [data-view="perm"]').forEach(b=>b.hidden=realRole()!=='admin');
  const pv=$('#previewBar');if(pv){pv.hidden=!S.previewRole;pv.innerHTML=S.previewRole?`กำลังดูหน้าจอในฐานะ <b>${esc(ROLES[S.previewRole])}</b> <button class="btn sm" data-preview="">กลับเป็นผู้ดูแลระบบ</button>`:''}
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===S.view));
  const M={live:['live','ซิงก์สดกับทีม'],demo:['demo','โหมดตัวอย่าง · ไม่บันทึก'],connecting:['','กำลังเชื่อมต่อ…'],offline:['','ออฟไลน์ · จะซิงก์เมื่อกลับมา']};const m=M[S.mode];
  $('#syncR').innerHTML=`<span class="dot ${m[0]}"></span><span>${m[1]}</span>`;
  const ids=[...new Set(onlinePeers().map(p=>p.by).filter(Boolean))];
  $('#peers').innerHTML=ids.slice(0,5).map(id=>`<span title="${esc(nm(id))}${id===S.me?' (คุณ)':''}">${av(id)}</span>`).join('');
  $('#onlineR').textContent=BK&&BK.kind!=='demo'?`ออนไลน์ ${Math.max(1,ids.length)} คน`:'';
  $('#meRow').innerHTML=BK&&BK.kind==='firebase'&&S.me?`${av(S.me)}<span class="t"><b>${esc(nm(S.me))}</b>${esc(ROLES[realRole()])}</span><button data-act="signout">ออก</button>`:'';
  const nb=$('#newBtn'),fab=$('#fab');nb.disabled=!S.canWrite||S.mode==='connecting';if(fab)fab.hidden=!S.canWrite||S.mode==='connecting';
}

function renderView(){
  const v=$('#view');
  if(S.view!=='map'&&S.lmap){S.lmap.remove();S.lmap=null}
  if(S.view==='team'){v.innerHTML=teamHTML();return}
  if(S.view==='perm'){v.innerHTML=permHTML();return}
  if(!S.loaded){v.innerHTML=`<div class="empty"><h2>กำลังโหลดงานของทีม</h2><p>เชื่อมต่อฐานข้อมูลร่วม เพื่อให้ทุกคนเห็นสถานะเดียวกันแบบเรียลไทม์</p></div>`;return}
  if(S.view==='map'){renderMap(v);return}
  let html='';
  if(S.mode==='demo')html+=`<div class="banner"><b>โหมดตัวอย่าง</b><span>ยังไม่ได้เชื่อมฐานข้อมูล ข้อมูลที่แก้ไขจะหายเมื่อรีเฟรช</span></div>`;
  else if(!S.canWrite)html+=`<div class="banner"><b>ดูอย่างเดียว</b><span>บัญชีนี้ไม่มีสิทธิ์แก้ไข ขอให้ผู้ดูแลเพิ่มสิทธิ์</span></div>`;
  if(!S.jobs.size&&!['cal','pay','bonus'].includes(S.view)){html+=emptyState();v.innerHTML=html;return}
  html+=S.view==='dash'?dashHTML():S.view==='board'?boardHTML():S.view==='cal'?calHTML():S.view==='pay'?payHTML():S.view==='bonus'?bonusHTML():listHTML();
  const sl=v.querySelector('.board-wrap')?.scrollLeft;
  v.innerHTML=html;
  if(sl!=null&&v.querySelector('.board-wrap'))v.querySelector('.board-wrap').scrollLeft=sl;
}
function emptyState(){return `<div class="empty"><img class="emark" src="${LOGO}" alt="" style="width:200px">
  <h2>ยังไม่มีงานติดตั้ง</h2><p>งานแต่ละบ้านจะแสดงที่นี่ ตั้งแต่รับงาน เสนอราคา ขออนุญาต จนถึงการไฟฟ้าเปลี่ยนมิเตอร์ ทุกคนในทีมเห็นการอัปเดตพร้อมกันทันที</p>
  <div class="acts"><button class="btn pri" data-act="new" ${S.canWrite?'':'disabled'}>+ เพิ่มงานแรก</button><button class="btn" data-act="demo" ${S.canWrite?'':'disabled'}>โหลดงานตัวอย่าง</button></div></div>`}

function dashHTML(){
  const all=visibleJobs();const open=all.filter(j=>j.stage!=='done');const done=all.filter(j=>j.stage==='done');
  const kwOpen=open.reduce((a,j)=>a+(+j.kw||0),0);const kwDone=done.reduce((a,j)=>a+(+j.kw||0),0);
  const pipe=open.filter(j=>SIDX[j.stage]>=SIDX.quote).reduce((a,j)=>a+quoteTotals(j).total,0);
  const waiting=open.filter(j=>j.stage==='grid');
  const counts=STAGES.map(s=>all.filter(j=>j.stage===s.k).length);const max=Math.max(1,...counts);
  const stale=open.map(j=>({...j,dd:days(j.stageAt)})).filter(j=>j.dd>=7).sort((a,b)=>b.dd-a.dd);
  const feed=all.flatMap(j=>(j.log||[]).map(e=>({...e,id:j.id,name:j.name}))).sort((a,b)=>b.t-a.t).slice(0,8);
  const today=ymd(new Date()),wk=ymd(new Date(Date.now()+7*86400000));const up=allEvents().filter(e=>e.date>=today&&e.date<=wk).slice(0,8);
  const hasDemo=all.some(j=>j.demo);const pf=pmFilterHTML();
  return `${pf?`<div class="tools">${pf}</div>`:''}<div class="kpis">
    <div class="kpi hero"><span class="lbl">งานที่กำลังดำเนินการ</span><span class="v">${open.length}<small>งาน</small></span><span class="s">รวม <span class="num">${fmt1(kwOpen)}</span> kWp รอติดตั้ง/ขนานไฟ</span></div>
    <div class="kpi"><span class="lbl">มูลค่าใบเสนอราคา</span><span class="v">${can('quote.view')?`฿${fmt(pipe/1000)}<small>พัน</small>`:'–'}</span><span class="s">งานตั้งแต่ขั้นเสนอราคา รวม VAT</span></div>
    <div class="kpi"><span class="lbl">รอการไฟฟ้า</span><span class="v">${waiting.length}<small>งาน</small></span><span class="s">ยื่นขนานไฟ / รอตรวจ / รอเปลี่ยนมิเตอร์</span></div>
    <div class="kpi"><span class="lbl">ขนานไฟสำเร็จ</span><span class="v">${done.length}<small>งาน</small></span><span class="s"><span class="num">${fmt1(kwDone)}</span> kWp ผลิตไฟแล้ว</span></div>
  </div>
  <div class="grid2">
    <section class="panel"><h2>สถานะงานตามขั้นตอน <span class="count">${all.length}</span></h2>
      <div class="funnel">${STAGES.map((s,i)=>`<button class="frow" data-stagejump="${s.k}"><span>${esc(s.s)}</span><span class="bar"><i style="width:${counts[i]/max*100}%;background:${STAGE_COLOR(i)}"></i></span><span class="n num">${counts[i]}</span></button>`).join('')}</div>
    </section>
    <section class="panel"><h2>นัดหมาย 7 วันข้างหน้า <span class="count">${up.length}</span></h2>
      ${up.length?`<div class="list">${up.map(e=>evRow(e)).join('')}</div>`:`<p class="muted" style="margin:0">ยังไม่มีนัดหมายในสัปดาห์นี้</p>`}
      <button class="btn sm" data-view="cal" style="align-self:flex-start">เปิดปฏิทิน</button>
    </section>
  </div>
  <div class="grid2">
    <section class="panel"><h2>ต้องติดตาม <span class="count">${stale.length}</span></h2>
      ${stale.length?`<div class="list">${stale.slice(0,6).map(j=>`<button class="li" data-open="${j.id}"><b>${esc(j.name)}</b><span class="tag ${j.dd>=14?'bad':'warn'}">ค้าง ${j.dd} วัน</span><span class="sub">${stagePill(j.stage)}<span class="num">${esc(j.code)}</span>${pmName(j)?`<span>ดูแลโดย ${esc(pmName(j))}</span>`:''}</span></button>`).join('')}</div>`:`<p class="muted" style="margin:0">ไม่มีงานค้างเกิน 7 วันในขั้นเดียวกัน</p>`}
    </section>
    <section class="panel"><h2>รอการไฟฟ้า</h2>
      ${waiting.length?`<div class="list">${waiting.map(j=>`<button class="li" data-open="${j.id}"><b>${esc(j.name)}</b><span class="tag">${j.util==='MEA'?'กฟน.':'กฟภ.'}</span><span class="sub">${stagePill(j.stage)}${j.grid?.ref?`<span class="num">คำร้อง ${esc(j.grid.ref)}</span>`:''}${j.grid?.inspect?`<span>นัดตรวจ ${dTH(parseYmd(j.grid.inspect))}</span>`:''}</span></button>`).join('')}</div>`:`<p class="muted" style="margin:0">ยังไม่มีงานที่อยู่ระหว่างยื่นขนานไฟ</p>`}
    </section>
  </div>
  <section class="panel"><h2>อัปเดตล่าสุดจากทีม</h2>
    <div class="list feed">${feed.map(e=>`<button class="li" data-open="${e.id}">${av(e.by,'sm')}<span style="min-width:0"><b style="display:block;white-space:normal">${esc(nm(e.by))} · ${esc(e.m)}</b></span><span class="sub"><span>${esc(e.name)}</span><span class="muted">${ago(e.t)}</span></span></button>`).join('')||'<p class="muted">ยังไม่มีความเคลื่อนไหว</p>'}</div>
    ${hasDemo&&S.canWrite?`<button class="btn sm danger" data-act="cleardemo" style="align-self:flex-start">ลบงานตัวอย่างทั้งหมด</button>`:''}
  </section>`;
}
function evRow(e,showDate=true){const c=(APPT[e.type]||APPT.other)[1];
  return `<button class="li ev" data-open="${e.job}" data-opentab="appts"><span class="evbar" style="background:${c}"></span><span style="min-width:0"><b>${esc(e.title)} · ${esc(e.name)}</b><span class="sub">${showDate?`<span>${dLong(e.date)}</span>`:''}${e.time?`<span class="num">${esc(e.time)} น.</span>`:''}${e.who?`<span>${esc(nm(e.who))}</span>`:''}${e.note?`<span class="muted">${esc(e.note)}</span>`:''}</span></span></button>`}

function cardHTML(j){
  const i=SIDX[j.stage];const dd=days(j.stageAt);const pp=permitProg(j);const vw=viewersOf(j.id);const tot=quoteTotals(j).total;
  const today=ymd(new Date());const nx=(j.appts||[]).filter(a=>a.date>=today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
  return `<button class="card${grpOf(j)?' g-'+grpOf(j):''}" draggable="${canEditJob(j)}" data-open="${j.id}" data-id="${j.id}">
    <span class="r1">${grpTag(j)}<span class="code">${esc(j.code)}</span>${j.demo?'<span class="tag demo">ตัวอย่าง</span>':''}<span class="sp">${hasLoc(j)?'<svg class="ic" viewBox="0 0 24 24" aria-label="มีตำแหน่ง"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor"/></svg>':''}${vw.length?`<span class="watch" title="มีคนกำลังเปิดดู"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>${vw.length}</span>`:''}${j.stage!=='done'&&dd>=7?`<span class="tag ${dd>=14?'bad':'warn'}">${dd} วัน</span>`:''}</span></span>
    <span class="nm">${esc(j.name)}</span>
    <span class="loc">${esc(j.prov||'ไม่ระบุจังหวัด')} · ${j.util==='MEA'?'กฟน.':'กฟภ.'} · ${j.phase==='3'?'3 เฟส':'1 เฟส'}${j.type==='hybrid'?' · Hybrid':''}</span>
    ${nx?`<span class="next" style="--c:${(APPT[nx.type]||APPT.other)[1]}">${dTH(parseYmd(nx.date))}${nx.time?' '+esc(nx.time):''} · ${esc((APPT[nx.type]||APPT.other)[0])}</span>`:''}
    ${i>=2&&i<5?`<span class="mini" title="เอกสารขออนุญาต ${pp.d}/${pp.n}"><i style="width:${pp.pct}%"></i></span>`:''}
    <span class="r3"><span class="kw">${fmt1(j.kw)} kWp</span><span class="pmw" title="ผู้ดูแลโครงการ: ${esc(pmName(j)||'ยังไม่กำหนด')}">${pmAv(j,'sm')}</span>${can('quote.view')?`<span class="val">฿${fmt(tot)}</span>`:''}</span>
  </button>`;
}
function boardHTML(){const all=visibleJobs();const pf=pmFilterHTML();
  return `${pf?`<div class="tools">${pf}</div>`:''}<div class="board-wrap"><div class="board">${STAGES.map((s,i)=>{const js=all.filter(j=>j.stage===s.k);
    return `<section class="col" data-col="${s.k}"><div class="col-h"><span class="strip" style="background:${STAGE_COLOR(i)}"></span><span class="no">${String(i+1).padStart(2,'0')}</span><h3>${esc(s.t)}</h3><span class="c">${js.length}</span></div>
    ${js.map(cardHTML).join('')||'<div class="col-empty">ไม่มีงานในขั้นนี้</div>'}</section>`}).join('')}</div></div>
    <p class="note" style="margin:0">ลากการ์ดไปคอลัมน์อื่นเพื่อเปลี่ยนขั้นตอน หรือแตะการ์ดเพื่อเปิดรายละเอียด บนมือถือใช้ปุ่ม “ขั้นถัดไป” ในหน้ารายละเอียด</p>`}
function listHTML(){let all=visibleJobs();if(S.stageFilter)all=all.filter(j=>j.stage===S.stageFilter);
  return `<div class="tools"><button class="chip" data-filter="" aria-pressed="${!S.stageFilter}">ทั้งหมด</button>${STAGES.map(s=>`<button class="chip" data-filter="${s.k}" aria-pressed="${S.stageFilter===s.k}">${esc(s.s)}</button>`).join('')}</div>
  <div class="tools">${pmFilterHTML()}<span style="margin-left:auto"></span>${canDownload()?`<button class="btn sm" data-act="csv">ส่งออก CSV</button>`:''}</div>
  <div class="tbl-wrap"><table><thead><tr><th>รหัสงาน</th><th>ลูกค้า</th><th>จังหวัด</th><th class="r">ขนาด</th><th>ขั้นตอน</th><th>ผู้ดูแลโครงการ</th><th>เอกสาร</th><th>รูป</th><th class="r">มูลค่า (รวม VAT)</th><th>อัปเดต</th></tr></thead><tbody>
  ${all.map(j=>{const pp=permitProg(j),ph=photoProg(j);return `<tr data-open="${j.id}"${grpOf(j)?` class="g-${grpOf(j)}"`:''}><td class="num">${esc(j.code)}${grpOf(j)?`<br>${grpTag(j)}`:''}</td><td><b>${esc(j.name)}</b><br><span class="muted num" style="font-size:12.5px">${esc(j.phone)}</span>${j.email?`<br><span class="muted" style="font-size:12.5px">${esc(j.email)}</span>`:''}</td><td>${esc(j.prov)}${hasLoc(j)?' <svg class="ic" viewBox="0 0 24 24" aria-label="มีตำแหน่ง"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor"/></svg>':''}</td><td class="r num">${fmt1(j.kw)} kWp</td><td>${stagePill(j.stage)}</td><td>${esc(pmName(j)||'–')}</td><td class="num">${pp.d}/${pp.n}</td><td class="num">${ph.d}/${ph.n}</td><td class="r num">${can('quote.view')?fmt(quoteTotals(j).total):'–'}</td><td class="muted">${ago(j.updatedAt)}</td></tr>`}).join('')||`<tr><td colspan="10" class="muted">ไม่พบงานที่ตรงกับตัวกรอง</td></tr>`}
  </tbody></table></div>`}

/* ---------- calendar ---------- */
function calHTML(){
  const now=new Date();if(!S.cal)S.cal=new Date(now.getFullYear(),now.getMonth(),1);if(!S.calSel)S.calSel=ymd(now);
  const y=S.cal.getFullYear(),m=S.cal.getMonth();const first=new Date(y,m,1);const start=new Date(y,m,1-first.getDay());
  const ev=allEvents();const by={};ev.forEach(e=>(by[e.date]=by[e.date]||[]).push(e));
  const pmF=S.pmFilter;const fev=e=>{if(!pmF)return true;const j=S.jobs.get(e.job);return (j&&(pmF==='_none'?!j.pm:j.pm===pmF))||e.who===pmF};
  const today=ymd(now);let cells='';
  for(let i=0;i<42;i++){const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);const k=ymd(d);const es=(by[k]||[]).filter(fev);
    cells+=`<button class="cday ${d.getMonth()!==m?'out':''} ${k===today?'today':''} ${k===S.calSel?'sel':''}" data-day="${k}" aria-label="${dLong(k)} ${es.length} นัด"><span class="dn num">${d.getDate()}</span>
      <span class="evs">${es.slice(0,3).map(e=>`<span class="ec" style="--c:${(APPT[e.type]||APPT.other)[1]}">${e.time?`<b class="num">${esc(e.time)}</b> `:''}${esc(e.title)} · ${esc(e.name)}</span>`).join('')}${es.length>3?`<span class="more">+${es.length-3}</span>`:''}</span>
      <span class="dots">${es.slice(0,4).map(e=>`<i style="background:${(APPT[e.type]||APPT.other)[1]}"></i>`).join('')}</span></button>`}
  const sel=(by[S.calSel]||[]).filter(fev);
  const up=ev.filter(e=>e.date>today&&fev(e)).slice(0,10);
  return `<div class="tools"><div class="calnav"><button class="btn sm" data-cal="-1" aria-label="เดือนก่อน">‹</button><h2 class="calt">${first.toLocaleDateString('th-TH',{month:'long',year:'numeric'})}</h2><button class="btn sm" data-cal="1" aria-label="เดือนถัดไป">›</button><button class="btn sm ghost" data-cal="0">วันนี้</button></div>
    <span style="margin-left:auto"></span>${pmFilterHTML()}${S.canWrite&&S.jobs.size?`<button class="btn sm pri" data-act="newappt">+ นัดหมาย</button>`:''}</div>
  <div class="legend">${Object.entries(APPT).map(([k,[t,c]])=>`<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>
  <div class="calwrap"><div class="cal">${TH_DOW.map(d=>`<span class="dow">${d}</span>`).join('')}${cells}</div>
  <section class="panel dayp"><h2>${dLong(S.calSel)} <span class="count">${sel.length}</span></h2>
    ${sel.length?`<div class="list">${sel.map(e=>evRow(e,false)).join('')}</div>`:`<p class="muted" style="margin:0">ไม่มีนัดหมายในวันนี้</p>`}
    ${S.canWrite&&S.jobs.size?`<button class="btn sm" data-act="newappt" style="align-self:flex-start">+ เพิ่มนัดวันนี้</button>`:''}
    ${up.length?`<h3 class="lbl" style="margin-top:6px">ถัดไป</h3><div class="list">${up.map(e=>evRow(e)).join('')}</div>`:''}
  </section></div>`;
}

/* ---------- map ---------- */
function mapAvailable(){return !!window.L&&BK&&BK.kind!=='artifact'}
function renderMap(v){
  const all=visibleJobs().filter(j=>!S.mapStage||STAGES[SIDX[j.stage]].g===S.mapStage);
  const withLoc=all.filter(hasLoc),noLoc=all.filter(j=>!hasLoc(j));
  const side=`<div class="tools"><button class="chip" data-mapstage="" aria-pressed="${!S.mapStage}">ทั้งหมด</button><button class="chip" data-mapstage="sales" aria-pressed="${S.mapStage==='sales'}"><i class="sw" style="background:#1E4FD6"></i>ขาย/เสนอราคา</button><button class="chip" data-mapstage="permit" aria-pressed="${S.mapStage==='permit'}"><i class="sw" style="background:#F0661A"></i>ขออนุญาต/ติดตั้ง</button><button class="chip" data-mapstage="done" aria-pressed="${S.mapStage==='done'}"><i class="sw" style="background:#11905A"></i>ส่งมอบแล้ว</button></div>
    <div class="list maplist">${withLoc.map(j=>`<div class="li"><button class="lnk" data-focus="${j.id}"><b>${esc(j.name)}</b></button>${stagePill(j.stage)}<span class="sub"><span>${esc(j.prov)}</span><span>${fmt1(j.kw)} kWp</span>${pmName(j)?`<span>${esc(pmName(j))}</span>`:''}<a href="${esc(gdirUrl(j))}" target="_blank" rel="noopener">นำทาง</a><button class="lnk" data-open="${j.id}">เปิดงาน</button></span></div>`).join('')||'<p class="muted" style="margin:0">ยังไม่มีงานที่ระบุตำแหน่ง</p>'}</div>
    ${noLoc.length?`<div class="banner soft"><span><b>ยังไม่ระบุตำแหน่ง ${noLoc.length} งาน:</b> ${noLoc.slice(0,6).map(j=>`<button class="lnk" data-open="${j.id}">${esc(j.name)}</button>`).join(', ')}${noLoc.length>6?' …':''}</span></div>`:''}`;
  if(!mapAvailable()){
    v.innerHTML=`<div class="banner soft"><span>แผนที่แบบซ้อนหมุดหลายงานแสดงได้ในเวอร์ชันเว็บไซต์ (GitHub Pages) ส่วนเวอร์ชันนี้ใช้ปุ่ม “นำทาง” เปิดตำแหน่งใน Google Maps</span></div><section class="panel">${side}</section>`;return}
  if(!S.lmap||!v.querySelector('#lmap')){
    if(S.lmap){S.lmap.remove();S.lmap=null}
    v.innerHTML=`<div class="mapgrid"><div class="mapbox"><div id="lmap"></div><button class="btn sm mapfit" data-act="mapfit">ดูทุกงาน</button></div><section class="panel mapside" id="mapside"></section></div>`;
    const L=window.L;const map=L.map('lmap',{zoomControl:true}).setView([13.75,100.5],6);
    const street=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'});
    const sat=L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,attribution:'Imagery © Esri'});
    street.addTo(map);L.control.layers({'แผนที่':street,'ภาพดาวเทียม (ดูหลังคา)':sat},null,{position:'topright'}).addTo(map);
    S.lmap=map;S.lmarkers=L.layerGroup().addTo(map);S.mapFitted=false;
  }
  $('#mapside').innerHTML=side;
  const L=window.L;S.lmarkers.clearLayers();S.lmById={};
  withLoc.forEach(j=>{const i=SIDX[j.stage];const mk=L.marker([+j.lat,+j.lng],{icon:L.divIcon({className:'pin',html:`<span style="--c:${STAGE_HEX(i)}"><b>${i+1}</b></span>`,iconSize:[30,40],iconAnchor:[15,38],popupAnchor:[0,-34]}),title:j.name});
    mk.bindPopup(`<div class="pop"><b>${esc(j.name)}</b><div>${stagePill(j.stage)} <span class="num">${fmt1(j.kw)} kWp</span></div><div class="muted">${esc(j.addr)} ${esc(j.prov)}</div>${pmName(j)?`<div>ผู้ดูแล: ${esc(pmName(j))}</div>`:''}<div class="acts"><button class="btn sm pri" data-open="${j.id}">เปิดงาน</button><a class="btn sm" href="${esc(gdirUrl(j))}" target="_blank" rel="noopener">นำทาง</a></div></div>`);
    mk.addTo(S.lmarkers);S.lmById[j.id]=mk});
  setTimeout(()=>{if(!S.lmap)return;S.lmap.invalidateSize();if(!S.mapFitted&&withLoc.length){fitAll();S.mapFitted=true}},60);
}
function fitAll(){const pts=visibleJobs().filter(j=>hasLoc(j)&&(!S.mapStage||STAGES[SIDX[j.stage]].g===S.mapStage)).map(j=>[+j.lat,+j.lng]);if(!pts.length||!S.lmap)return;if(pts.length===1)S.lmap.setView(pts[0],15);else S.lmap.fitBounds(pts,{padding:[40,40],maxZoom:15})}

function teamHTML(){
  const link=location.origin+location.pathname;
  if(!BK||BK.kind!=='firebase'){const ids=teamIds();
    return `${BK&&BK.kind==='demo'?`<div class="banner"><b>โหมดตัวอย่าง</b><span>ยังไม่ได้เชื่อมฐานข้อมูล รายชื่อด้านล่างเป็นทีมตัวอย่าง</span></div>`:''}<section class="panel"><h2>ทีมงานที่พบในระบบ <span class="count">${ids.length}</span></h2>
    <p class="note" style="margin:0">${BK&&BK.kind==='artifact'?'สมาชิกจะปรากฏที่นี่เมื่อเปิดหน้านี้หรือถูกกำหนดเป็นผู้ดูแลโครงการ เพิ่มคนเข้าใช้ได้จากเมนู Share ของหน้า':'รายชื่อสำหรับเลือกเป็นผู้ดูแลโครงการ'}</p>
    <div class="list">${ids.map(id=>{const n=[...S.jobs.values()].filter(j=>j.pm===id&&j.stage!=='done').length;return `<div class="mem">${av(id)}<span style="min-width:0"><b>${esc(nm(id))}${id===S.me?' (คุณ)':''}</b><small>ดูแลโครงการที่กำลังดำเนินการ ${n} งาน</small></span><button class="btn sm" data-pmjump="${esc(id)}">ดูงาน</button></div>`}).join('')}</div></section>`}
  const on=new Set(onlinePeers().map(p=>p.by));
  const byEmail={};Object.entries(S.prof).forEach(([id,p])=>{if(p.email)byEmail[p.email.toLowerCase()]=id});
  const rows=[...new Set([...ADMIN_EMAILS,...(S.isAdmin?[S.email]:[]),...S.members.map(m=>m.id)])].sort();
  return `<section class="panel"><h2>บัญชีของคุณ</h2>
    <div class="owner">${av(S.me)}<span class="who"><b>${esc(nm(S.me))}</b><small>${esc(S.email)} · ${S.isAdmin?'ผู้ดูแลระบบ':'สมาชิกทีม'}</small></span><button class="btn sm" data-act="signout">ออกจากระบบ</button></div>
  </section>
  <section class="panel"><h2>ลิงก์สำหรับทีม</h2>
    <p style="margin:0;color:var(--ink-2)">ส่งลิงก์นี้ให้ทีม เปิดได้ทั้งคอมพิวเตอร์และมือถือ แล้วเข้าสู่ระบบด้วย Gmail ที่อยู่ในรายชื่อด้านล่าง บนมือถือกด “เพิ่มไปยังหน้าจอโฮม” เพื่อใช้เหมือนแอป</p>
    <div class="team-add"><input class="in num" id="teamLink" value="${esc(link)}" readonly><button class="btn" data-act="copylink">คัดลอกลิงก์</button></div>
  </section>
  <section class="panel"><h2>สมาชิกที่เข้าใช้ได้ <span class="count">${rows.length}</span></h2>
    ${S.isAdmin?`<form class="team-add" id="addMember"><input class="in" id="memEmail" type="email" required placeholder="อีเมล Gmail ของสมาชิก เช่น somchai@gmail.com"><button class="btn pri" type="submit">เพิ่มสมาชิก</button></form>`:'<p class="note" style="margin:0">เฉพาะผู้ดูแลระบบเพิ่มหรือลบสมาชิกได้</p>'}
    <div class="list">${rows.map(e=>{const id=byEmail[e];const isA=ADMIN_EMAILS.includes(e)||(S.isAdmin&&e===S.email);const n=id?[...S.jobs.values()].filter(j=>j.pm===id&&j.stage!=='done').length:0;return `<div class="mem">${id?av(id):avName(e)}<span style="min-width:0"><b>${esc(id?nm(id):e)}</b><small>${esc(e)} · ${isA?'ผู้ดูแลระบบ':'สมาชิก'}${id?` · ดูแล ${n} งาน${on.has(id)?' · <span style="color:var(--good)">ออนไลน์</span>':''}`:' · ยังไม่เคยเข้าสู่ระบบ'}</small></span>${S.isAdmin&&!isA?`<button class="btn sm danger" data-rmmember="${esc(e)}">ลบ</button>`:''}</div>`}).join('')}</div>
  </section>`;
}

/* ---------- roles & permissions ---------- */
const ROLES={admin:'ผู้ดูแลระบบ',manager:'ผู้จัดการ / ผู้ดูแลโครงการ',staff:'พนักงานทั่วไป'};
const PERMS=[
  ['jobs.edit','แก้ไขได้ทุกงาน (ข้อมูล ขั้นตอน รูป นัดหมาย)'],
  ['jobs.edit.own','แก้ไขเฉพาะงานที่ตัวเองเป็นผู้ดูแลโครงการ'],
  ['jobs.delete','ลบงาน'],
  ['quote.view','ดูใบเสนอราคาและมูลค่างาน'],
  ['proposal.make','สร้าง Proposal ของงานที่ตัวเองดูแล'],
  ['finance.view','ดูสถานะการจ่ายเงิน'],
  ['finance.edit','บันทึกรับชำระเงินจากลูกค้า'],
  ['bonus.view.all','ดูโบนัสของทุกคน'],
  ['bonus.view.own','ดูโบนัสของตัวเอง'],
  ['bonus.pay','บันทึกจ่ายโบนัสและปรับยอด'],
  ['settings.edit','แก้อัตราโบนัสและงวดชำระเงิน']
];
const DEFAULT_PERMS={
  manager:{'jobs.edit':false,'jobs.edit.own':true,'jobs.delete':true,'quote.view':true,'proposal.make':true,'finance.view':true,'finance.edit':true,'bonus.view.all':true,'bonus.view.own':true,'bonus.pay':false,'settings.edit':false},
  staff:{'jobs.edit':false,'jobs.edit.own':true,'jobs.delete':false,'quote.view':false,'proposal.make':true,'finance.view':false,'finance.edit':false,'bonus.view.all':false,'bonus.view.own':true,'bonus.pay':false,'settings.edit':false}
};
const DEFAULT_APP={
  installments:[{k:'dep',label:'มัดจำเมื่ออนุมัติ',pct:50,stage:'deal'},{k:'inst',label:'งวดติดตั้งแล้วเสร็จ',pct:40,stage:'install'},{k:'final',label:'งวดสุดท้าย COD',pct:10,stage:'done'}],
  tiers:[{upTo:3,amt:1500},{upTo:5,amt:2500},{upTo:10,amt:4000},{upTo:20,amt:6000},{upTo:0,amt:8000}],
  dueDays:7
};
function appCfg(){const a=S.settings||{};return{installments:a.installments&&a.installments.length?(a.sv===2?a.installments:a.installments.map(x=>({...x,stage:LEGACY_INST[x.stage]||x.stage}))):DEFAULT_APP.installments,tiers:a.tiers&&a.tiers.length?a.tiers:DEFAULT_APP.tiers,dueDays:a.dueDays!=null?+a.dueDays:DEFAULT_APP.dueDays}}
function realRole(){if(S.isAdmin)return'admin';if(BK&&BK.kind==='firebase'){const m=S.members.find(x=>x.id===S.email);return(m&&m.role)||'staff'}return S.roleMap[S.me]||'staff'}
function myRole(){const r=realRole();return r==='admin'&&S.previewRole?S.previewRole:r}
function roleOfId(id){if(!id)return'staff';if(BK&&BK.kind==='firebase'){const em=(S.prof[id]&&S.prof[id].email||'').toLowerCase();if(ADMIN_EMAILS.includes(em))return'admin';const m=S.members.find(x=>x.id===em);return(m&&m.role)||'staff'}if(id===S.ownerId)return'admin';return S.roleMap[id]||'staff'}
function can(p){const r=myRole();if(r==='admin')return true;const pd=(S.permsDoc&&S.permsDoc[r])||{};return p in pd?!!pd[p]:!!(DEFAULT_PERMS[r]||{})[p]}
function applyPerms(){S.canWrite=S.baseWrite!==false&&(can('jobs.edit')||can('jobs.edit.own'))}
// may this viewer change this particular job?
function canEditJob(j){return S.baseWrite!==false&&!!j&&(can('jobs.edit')||(can('jobs.edit.own')&&!!j.pm&&j.pm===S.me))}
const JW=()=>canEditJob(S.jobs.get(S.open));
const canProposal=j=>can('quote.view')||(can('proposal.make')&&canEditJob(j));
function noAccess(what){return `<div class="empty"><h2>ไม่มีสิทธิ์เข้าถึง${esc(what||'')}</h2><p>ขอให้ผู้ดูแลระบบเปิดสิทธิ์ในเมนู “สิทธิ์การใช้งาน”</p></div>`}
// write a doc whether or not it exists yet (artifact update() needs an existing doc)
function upsert(col,id,data,cur){return cur?BK.patch(col,id,data):BK.put(col,id,deepMerge({},data))}

/* ---------- payments ---------- */
const PST={paid:['ชำระแล้ว','good'],part:['ชำระบางส่วน','warn'],due:['ถึงกำหนด','blue'],late:['เกินกำหนด','bad'],wait:['ยังไม่ถึงกำหนด','muted']};
const payPill=st=>`<span class="pst pst-${PST[st][1]}">${PST[st][0]}</span>`;
const PAY_METHODS=['โอนเงิน','เงินสด','เช็ค','บัตรเครดิต'];
function instStatus(j,id){const cfg=appCfg();const total=quoteTotals(j).total;const rec=((S.fin.get(id)||{}).rec)||{};const si=SIDX[j.stage]??0;
  return cfg.installments.map(it=>{const amt=Math.round(total*(+it.pct||0)/100);const r=rec[it.k]||null;const got=r?+r.amt||0:0;const reached=si>=(SIDX[it.stage]??99);
    const at=reached?((j.steps||{})[it.stage]||j.stageAt):null;let st='wait';
    if(amt>0&&got>=amt-1)st='paid';else if(got>0)st='part';else if(reached)st=days(at)>cfg.dueDays?'late':'due';
    return{...it,amt,got,rec:r,st,at}})}
function payRows(){return visibleJobs().filter(j=>S.payFilter==='all'||(SIDX[j.stage]??0)>=SIDX.deal).map(j=>{const ins=instStatus(j,j.id);const total=quoteTotals(j).total;const got=ins.reduce((a,x)=>a+x.got,0);
  return{j,ins,total,got,out:Math.max(0,Math.round(total-got)),late:ins.some(x=>x.st==='late'),dueAmt:ins.filter(x=>x.st==='due'||x.st==='late'||x.st==='part').reduce((a,x)=>a+Math.max(0,x.amt-x.got),0)}})}
function payHTML(){if(!can('finance.view'))return noAccess('สถานะการจ่ายเงิน');
  const cfg=appCfg();const all=payRows();const f=S.payFilter||'open';
  const rows=all.filter(r=>f==='all'||f==='contract'?true:f==='open'?r.out>1:f==='late'?r.late:f==='paid'?r.out<=1:true);
  const sum=k=>all.reduce((a,r)=>a+r[k],0);const lateN=all.filter(r=>r.late).length;
  const sumPct=cfg.installments.reduce((a,x)=>a+(+x.pct||0),0);
  return `<div class="kpis">
    <div class="kpi hero"><span class="lbl">มูลค่าสัญญา (อนุมัติแล้ว)</span><span class="v num">฿${fmt(sum('total'))}</span><span class="s">${all.length} งาน รวม VAT</span></div>
    <div class="kpi"><span class="lbl">รับชำระแล้ว</span><span class="v num" style="color:var(--good)">฿${fmt(sum('got'))}</span><span class="s">${sum('total')?Math.round(sum('got')/sum('total')*100):0}% ของมูลค่าสัญญา</span></div>
    <div class="kpi"><span class="lbl">ถึงกำหนด ยังไม่ได้รับ</span><span class="v num" style="color:var(--orange)">฿${fmt(sum('dueAmt'))}</span><span class="s">${lateN?`<b style="color:var(--bad)">เกินกำหนด ${lateN} งาน</b>`:'ไม่มีงวดเกินกำหนด'}</span></div>
    <div class="kpi"><span class="lbl">คงค้างทั้งหมด</span><span class="v num">฿${fmt(sum('out'))}</span><span class="s">รวมงวดที่ยังไม่ถึงกำหนด</span></div>
  </div>
  <div class="tools">${[['open','ค้างชำระ'],['late','เกินกำหนด'],['paid','ชำระครบ'],['contract','ทุกงานที่อนุมัติ'],['all','รวมงานที่ยังไม่อนุมัติ']].map(([k,t])=>`<button class="chip" data-payf="${k}" aria-pressed="${f===k}">${t}</button>`).join('')}<span style="margin-left:auto"></span>${pmFilterHTML()}</div>
  <div class="tbl-wrap"><table class="paytbl"><thead><tr><th>ลูกค้า</th><th>ผู้ดูแลโครงการ</th><th class="r">มูลค่ารวม</th>${cfg.installments.map(it=>`<th>${esc(it.label)} <span class="muted num">${+it.pct}%</span></th>`).join('')}<th class="r">รับแล้ว</th><th class="r">คงค้าง</th></tr></thead><tbody>
  ${rows.map(r=>`<tr data-open="${r.j.id}" data-opentab="pay"><td><b>${esc(r.j.name)}</b><br><span class="muted num" style="font-size:12.5px">${esc(r.j.code)}</span> ${stagePill(r.j.stage)}</td><td>${esc(pmName(r.j)||'–')}</td><td class="r num">${fmt(r.total)}</td>
    ${r.ins.map(x=>`<td><span class="num">${fmt(x.amt)}</span><br>${payPill(x.st)}</td>`).join('')}<td class="r num" style="color:var(--good)">${fmt(r.got)}</td><td class="r num"><b>${fmt(r.out)}</b></td></tr>`).join('')||`<tr><td colspan="${5+cfg.installments.length}" class="muted">ไม่มีรายการในตัวกรองนี้</td></tr>`}
  </tbody></table></div>
  <p class="note" style="margin:0">งวดจะ “ถึงกำหนด” เมื่องานเข้าสู่ขั้นตอนของงวดนั้น และ “เกินกำหนด” เมื่อเลย ${cfg.dueDays} วันแล้วยังไม่ได้รับเงิน · กดที่แถวเพื่อบันทึกรับชำระ</p>
  ${can('settings.edit')?`<section class="panel"><h2>ตั้งค่างวดชำระเงิน</h2>
    <div class="tbl-wrap"><table class="settbl"><thead><tr><th>ชื่องวด</th><th>% ของมูลค่า</th><th>ถึงกำหนดเมื่อเข้าขั้น</th><th></th></tr></thead><tbody>
    ${cfg.installments.map((it,i)=>`<tr><td><input class="in" id="ins-${i}-label" data-ins="${i}" data-k="label" value="${esc(it.label)}"></td><td><input class="in num" id="ins-${i}-pct" data-ins="${i}" data-k="pct" type="number" min="0" max="100" value="${esc(it.pct)}"></td><td><select class="in" id="ins-${i}-stage" data-ins="${i}" data-k="stage">${STAGES.map(s=>`<option value="${s.k}" ${s.k===it.stage?'selected':''}>${esc(s.s)}</option>`).join('')}</select></td><td>${cfg.installments.length>1?`<button class="rm" data-rmins="${i}" aria-label="ลบงวด">✕</button>`:''}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="addins">+ เพิ่มงวด</button><label class="inline">เกินกำหนดเมื่อเลย <input class="in num" id="dueDays" data-duedays="1" type="number" min="1" value="${cfg.dueDays}" style="width:70px"> วัน</label></div>
    ${sumPct!==100?`<div class="banner"><b>รวม ${sumPct}%</b><span>งวดทั้งหมดควรรวมได้ 100%</span></div>`:''}
  </section>`:''}`}
function payTab(j){if(!can('finance.view'))return noAccess();const ins=instStatus(j,j.id);const total=quoteTotals(j).total;const got=ins.reduce((a,x)=>a+x.got,0);const ed=can('finance.edit');
  return `<div class="totals"><div class="tot"><div class="row"><span>มูลค่ารวม (รวม VAT)</span><span class="num">${fmt(total)}</span></div><div class="row"><span>รับชำระแล้ว</span><span class="num" style="color:var(--good)">${fmt(got)}</span></div><div class="row grand"><span>คงค้าง</span><span class="num">${fmt(Math.max(0,total-got))}</span></div></div>
  <div class="tot"><span class="lbl">ความคืบหน้าการชำระ</span><div class="prog"><span class="bar"><i style="width:${total?Math.min(100,got/total*100):0}%;background:var(--good)"></i></span><span class="num">${total?Math.round(got/total*100):0}%</span></div><span class="note">ยอดแต่ละงวดคำนวณจากใบเสนอราคา ถ้าแก้ราคา ยอดงวดจะเปลี่ยนตาม</span></div></div>
  ${ins.map(x=>`<section class="inst"><div class="inst-h"><b>${esc(x.label)}</b><span class="muted num">${+x.pct}% · ฿${fmt(x.amt)}</span>${payPill(x.st)}</div>
    ${x.rec?`<div class="inst-r"><span>รับ <b class="num">฿${fmt(x.got)}</b> · ${esc(x.rec.method||'')} · ${x.rec.date?dLong(x.rec.date):''}</span>${x.rec.note?`<span class="muted">${esc(x.rec.note)}</span>`:''}<span class="muted" style="font-size:12px">บันทึกโดย ${esc(nm(x.rec.by))} ${tTH(x.rec.at)}</span>${ed?`<button class="btn sm danger" data-clrpay="${x.k}">ยกเลิกรายการ</button>`:''}</div>`:''}
    ${ed&&x.st!=='paid'?`<form class="payf" data-payk="${x.k}"><div class="form">
      <div class="fld"><label for="pf-${x.k}-amt">ยอดรับ (บาท)</label><input class="in num" id="pf-${x.k}-amt" name="amt" type="number" min="0" step="0.01" value="${Math.max(0,x.amt-x.got)}" required></div>
      <div class="fld"><label for="pf-${x.k}-date">วันที่รับ</label><input class="in" id="pf-${x.k}-date" name="date" type="date" value="${ymd(new Date())}" required></div>
      <div class="fld"><label for="pf-${x.k}-m">ช่องทาง</label><select class="in" id="pf-${x.k}-m" name="method">${PAY_METHODS.map(m=>`<option>${m}</option>`).join('')}</select></div>
      <div class="fld"><label for="pf-${x.k}-note">หมายเหตุ</label><input class="in" id="pf-${x.k}-note" name="note" placeholder="เช่น เลขที่ใบเสร็จ"></div>
    </div><div class="acts" style="justify-content:flex-end"><button class="btn sm pri" type="submit">บันทึกรับชำระ</button></div></form>`:''}
  </section>`).join('')}`}
async function savePay(jobId,k,f){const it=appCfg().installments.find(x=>x.k===k);const cur=S.fin.get(jobId);
  const rec={amt:+f.amt||0,date:f.date,method:f.method,note:f.note||'',by:S.me,at:Date.now()};
  await upsert('finance',jobId,{job:jobId,rec:{[k]:rec}},cur).catch(writeErr);
  saveJob(jobId,{},`รับชำระ ${it?it.label:k} ฿${fmt(rec.amt)}`);toast('บันทึกรับชำระแล้ว')}

/* ---------- job bonus ---------- */
const STD_INV=[3,5,6,8,10,12,15,20,25,30,36,40,50,60,80,100];
const invEst=j=>{const k=+j.kw||0;return STD_INV.find(s=>s>=k*0.9)||Math.ceil(k)};
const invKw=j=>+j.inv>0?+j.inv:null;
function tierLabel(t,i,arr){const prev=i>0?+arr[i-1].upTo:0;return +t.upTo>0?(prev?`${prev}–${+t.upTo} kW`:`ไม่เกิน ${+t.upTo} kW`):`มากกว่า ${prev} kW`}
function bonusTier(kw){const t=appCfg().tiers;for(let i=0;i<t.length;i++){if(+t[i].upTo>0&&kw<=+t[i].upTo)return{...t[i],i}}const i=t.findIndex(x=>!(+x.upTo>0));return{...t[i>=0?i:t.length-1],i:i>=0?i:t.length-1}}
function bonusOf(j){const kw=invKw(j)??invEst(j);const tier=bonusTier(kw);const b=S.bonus.get(j.id)||{};const base=+tier.amt||0;const amt=b.paid&&b.amt!=null?+b.amt:base+(+b.adj||0);
  const reached=(SIDX[j.stage]??0)>=SIDX.install;const st=j.steps||{};const at=reached?(st.install||st.grid||st.done||j.stageAt):null;
  return{kw,est:invKw(j)==null,tier,base,adj:+b.adj||0,note:b.note||'',amt,paid:!!b.paid,paidAt:b.paidAt,paidBy:b.paidBy,reached,at,doc:b}}
const monthKey=t=>{const d=new Date(t);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`};
const monthTH=k=>{const [y,m]=k.split('-').map(Number);return new Date(y,m-1,1).toLocaleDateString('th-TH',{month:'long',year:'numeric'})};
/* ช่วงเวลาของ Job Bonus: ทุกเดือน / รายเดือน / กำหนดช่วงวันเอง */
function bInPeriod(t){const M=S.bMonth||'all';if(M==='all')return true;if(!t)return false;
  if(M==='custom'){const f=S.bFrom?parseYmd(S.bFrom).getTime():-Infinity,to=S.bTo?parseYmd(S.bTo).getTime()+86400000-1:Infinity;return t>=f&&t<=to}
  return monthKey(t)===M}
function bPeriodLabel(){const M=S.bMonth||'all';if(M==='all')return'ทุกเดือน';if(M!=='custom')return monthTH(M);
  return `${S.bFrom?dTH(parseYmd(S.bFrom).getTime()):'เริ่มต้น'} – ${S.bTo?dTH(parseYmd(S.bTo).getTime()):'ปัจจุบัน'}`}
function bPeriodTools(months){const M=S.bMonth||'all';
  return `<label class="inline">ช่วงที่ติดตั้งเสร็จ <select class="in sel-sm" id="bMonth"><option value="all" ${M==='all'?'selected':''}>ทุกเดือน</option>${months.map(k=>`<option value="${k}" ${M===k?'selected':''}>${monthTH(k)}</option>`).join('')}<option value="custom" ${M==='custom'?'selected':''}>กำหนดช่วงวันเอง…</option></select></label>
  ${M==='custom'?`<label class="inline">ตั้งแต่ <input class="in sel-sm" type="date" id="bFrom" value="${esc(S.bFrom||'')}" ${S.bTo?`max="${esc(S.bTo)}"`:''}></label><label class="inline">ถึง <input class="in sel-sm" type="date" id="bTo" value="${esc(S.bTo||'')}" ${S.bFrom?`min="${esc(S.bFrom)}"`:''}></label>`:''}`}
const bXlsBtn=()=>canDownload()?'<button class="btn sm" data-act="bonusxlsx">ส่งออก Excel</button>':'';
function bonusHTML(){const all=can('bonus.view.all'),own=can('bonus.view.own');if(!all&&!own)return noAccess('โบนัส');
  const tab=all?(S.bTab||'crew'):'pm';
  const tabs=all?`<div class="tools"><button class="chip" data-btab="crew" aria-pressed="${tab==='crew'}">ทีมช่างติดตั้ง</button><button class="chip" data-btab="pm" aria-pressed="${tab==='pm'}">ผู้ดูแลโครงการ</button></div>`:'';
  if(tab==='crew'){const ms=[...new Set(visibleJobs().map(j=>crewBonusOf(j)).filter(c=>c.reached&&c.at).map(c=>monthKey(c.at)))].sort().reverse();const cur=monthKey(Date.now());if(!ms.includes(cur))ms.unshift(cur);
    return tabs+`<div class="tools">${bPeriodTools(ms)}<span style="margin-left:auto"></span>${pmFilterHTML()}${bXlsBtn()}</div>`+crewBonusHTML()}
  return tabs+pmBonusHTML()}
function pmBonusHTML(){const all=can('bonus.view.all');
  let jobs=visibleJobs();if(!all)jobs=jobs.filter(j=>j.pm===S.me);
  const items=jobs.map(j=>({j,b:bonusOf(j)}));
  const months=[...new Set(items.filter(x=>x.b.reached).map(x=>monthKey(x.b.at)))].sort().reverse();
  const cur=monthKey(Date.now());if(!months.includes(cur))months.unshift(cur);
  const M=S.bMonth||'all';
  const done=items.filter(x=>x.b.reached&&bInPeriod(x.b.at)).sort((a,b)=>(b.b.at||0)-(a.b.at||0));
  const pending=items.filter(x=>!x.b.reached&&x.j.stage!=='done');
  const unpaid=done.filter(x=>!x.b.paid),paid=done.filter(x=>x.b.paid);
  const s=a=>a.reduce((t,x)=>t+x.b.amt,0);
  const people={};done.forEach(x=>{const k=x.j.pm||('n:'+(x.j.pmName||''));const p=people[k]||(people[k]={k,id:x.j.pm,name:pmName(x.j)||'ยังไม่กำหนดผู้ดูแล',n:0,kw:0,amt:0,paid:0});p.n++;p.kw+=x.b.kw;p.amt+=x.b.amt;if(x.b.paid)p.paid+=x.b.amt});
  const cfg=appCfg();const pay=can('bonus.pay');
  return `<div class="tools">${bPeriodTools(months)}<span style="margin-left:auto"></span>${all?pmFilterHTML():'<span class="tag">แสดงเฉพาะโบนัสของคุณ</span>'}${bXlsBtn()}</div>
  <div class="kpis">
    <div class="kpi hero"><span class="lbl">ถึงกำหนดจ่าย ยังไม่จ่าย</span><span class="v num">฿${fmt(s(unpaid))}</span><span class="s">${unpaid.length} งาน</span></div>
    <div class="kpi"><span class="lbl">จ่ายแล้ว</span><span class="v num" style="color:var(--good)">฿${fmt(s(paid))}</span><span class="s">${paid.length} งาน</span></div>
    <div class="kpi"><span class="lbl">รวมโบนัส${M==='all'?'ทั้งหมด':' '+bPeriodLabel()}</span><span class="v num">฿${fmt(s(done))}</span><span class="s">${done.length} งานที่ติดตั้งเสร็จ</span></div>
    <div class="kpi"><span class="lbl">รอติดตั้งเสร็จ (ประมาณการ)</span><span class="v num">฿${fmt(s(pending))}</span><span class="s">${pending.length} งาน</span></div>
  </div>
  ${all&&Object.keys(people).length?`<section class="panel"><h2>สรุปรายคน</h2><div class="tbl-wrap"><table><thead><tr><th>ผู้ดูแลโครงการ</th><th class="r">จำนวนงาน</th><th class="r">Inverter รวม</th><th class="r">โบนัสรวม</th><th class="r">จ่ายแล้ว</th><th class="r">ค้างจ่าย</th></tr></thead><tbody>
    ${Object.values(people).sort((a,b)=>b.amt-a.amt).map(p=>`<tr><td>${p.id?av(p.id,'sm'):''} ${esc(p.name)}</td><td class="r num">${p.n}</td><td class="r num">${fmt1(p.kw)} kW</td><td class="r num"><b>${fmt(p.amt)}</b></td><td class="r num" style="color:var(--good)">${fmt(p.paid)}</td><td class="r num" style="color:var(--orange)">${fmt(p.amt-p.paid)}</td></tr>`).join('')}
  </tbody></table></div></section>`:''}
  <section class="panel"><h2>งานที่ติดตั้งเสร็จ <span class="count">${done.length}</span></h2>
  <div class="tbl-wrap"><table class="bontbl"><thead><tr><th>งาน</th><th>ผู้ดูแลโครงการ</th><th>ติดตั้งเสร็จ</th><th class="r">Inverter</th><th class="r">อัตรา</th><th class="r">ปรับ +/-</th><th class="r">โบนัส</th><th>สถานะ</th></tr></thead><tbody>
  ${done.map(({j,b})=>`<tr><td><button class="lnk" data-open="${j.id}">${esc(j.name)}</button><br><span class="muted num" style="font-size:12px">${esc(j.code)}</span></td><td>${esc(pmName(j)||'–')}</td><td>${dTH(b.at)}</td>
    <td class="r num">${fmt1(b.kw)} kW${b.est?'<br><span class="muted" style="font-size:11px">ประมาณ</span>':''}</td><td class="r num">${fmt(b.base)}</td>
    <td class="r">${pay&&!b.paid?`<input class="in num adj" id="adj-${j.id}" data-adj="${j.id}" type="number" step="100" value="${b.adj||''}" placeholder="0">`:`<span class="num">${b.adj?fmt(b.adj):'–'}</span>`}</td>
    <td class="r num"><b>${fmt(b.amt)}</b></td>
    <td>${b.paid?`<span class="pst pst-good">จ่ายแล้ว ${dTH(b.paidAt)}</span>${pay?` <button class="lnk" data-bunpay="${j.id}">ยกเลิก</button>`:''}`:pay?`<button class="btn sm pri" data-bpay="${j.id}">บันทึกจ่ายแล้ว</button>`:'<span class="pst pst-blue">รอจ่าย</span>'}</td></tr>`).join('')||`<tr><td colspan="8" class="muted">ยังไม่มีงานที่ติดตั้งเสร็จ${M==='all'?'':'ในช่วงนี้'}</td></tr>`}
  </tbody></table></div></section>
  ${pending.length?`<section class="panel"><h2>รอติดตั้งเสร็จ <span class="count">${pending.length}</span></h2><div class="list">${pending.map(({j,b})=>`<button class="li" data-open="${j.id}"><b>${esc(j.name)}</b><span class="num">฿${fmt(b.amt)}</span><span class="sub">${stagePill(j.stage)}<span>${esc(pmName(j)||'ยังไม่กำหนดผู้ดูแล')}</span><span class="num">Inverter ${fmt1(b.kw)} kW${b.est?' (ประมาณ)':''}</span></span></button>`).join('')}</div></section>`:''}
  <section class="panel"><h2>อัตราโบนัสตามขนาด Inverter</h2>
    ${can('settings.edit')?`<div class="tbl-wrap"><table class="settbl"><thead><tr><th>ขนาด Inverter ไม่เกิน (kW)</th><th>โบนัสต่องาน (บาท)</th><th></th></tr></thead><tbody>
    ${cfg.tiers.map((t,i)=>`<tr><td><input class="in num" id="tier-${i}-up" data-tier="${i}" data-k="upTo" type="number" min="0" step="0.1" value="${+t.upTo>0?+t.upTo:''}" placeholder="ไม่จำกัด"></td><td><input class="in num" id="tier-${i}-amt" data-tier="${i}" data-k="amt" type="number" min="0" step="100" value="${+t.amt}"></td><td>${cfg.tiers.length>1?`<button class="rm" data-rmtier="${i}" aria-label="ลบขั้น">✕</button>`:''}</td></tr>`).join('')}
    </tbody></table></div><div class="acts"><button class="btn sm" data-act="addtier">+ เพิ่มขั้น</button></div>
    <p class="note" style="margin:0">ขั้นที่เว้นช่อง “ไม่เกิน” ว่างไว้ ใช้กับ Inverter ที่ใหญ่กว่าทุกขั้น · โบนัสถึงกำหนดเมื่องานเข้าขั้น “ติดตั้งแล้วเสร็จ” และจ่ายให้ผู้ดูแลโครงการของงาน</p>`
    :`<div class="list">${cfg.tiers.map((t,i,a)=>`<div class="li"><span>${tierLabel(t,i,a)}</span><b class="num">฿${fmt(t.amt)}</b></div>`).join('')}</div>`}
  </section>`}
/* ---------- Job Bonus → Excel (.xlsx via SheetJS) ---------- */
const XLSX_SRC='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let xlsxLoad=null;
function loadXlsx(){if(window.XLSX)return Promise.resolve();
  return xlsxLoad||(xlsxLoad=new Promise((ok,no)=>{const sc=document.createElement('script');sc.src=XLSX_SRC;sc.onload=()=>window.XLSX?ok():no(new Error('XLSX missing'));sc.onerror=()=>{xlsxLoad=null;no(new Error('load failed'))};document.head.appendChild(sc)}))}
const xDate=t=>t?new Date(t).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'numeric'}):'';
function xSheet(rows,widths){const ws=XLSX.utils.aoa_to_sheet(rows);ws['!cols']=widths.map(w=>({wch:w}));return ws}
function bonusBooks(){const all=can('bonus.view.all');const tab=all?(S.bTab||'crew'):'pm';const books=[];
  const head=[[`SOLAR TOUCH · Job Bonus ${tab==='crew'?'ทีมช่างติดตั้ง':'ผู้ดูแลโครงการ'}`],[`ช่วงที่ติดตั้งเสร็จ: ${bPeriodLabel()}${S.pmFilter?` · ผู้ดูแลโครงการ: ${S.pmFilter==='_none'?'ยังไม่กำหนด':nm(S.pmFilter)}`:''}`],[`ส่งออกเมื่อ ${new Date().toLocaleString('th-TH')}`],[]];
  if(tab==='crew'){
    const done=visibleJobs().map(j=>({j,c:crewBonusOf(j)})).filter(x=>x.c.reached&&bInPeriod(x.c.at)).sort((a,b)=>(a.c.at||0)-(b.c.at||0));
    const ppl={};done.forEach(({c})=>c.people.forEach(p=>{const k=p.name.trim();const r=ppl[k]||(ppl[k]={name:k,pos:{},n:0,days:0,amt:0,paid:0});r.n++;r.days+=p.worked!=null?p.worked:(c.days||0);r.pos[p.pos]=(r.pos[p.pos]||0)+1;r.amt+=p.amt;if(c.paid)r.paid+=p.amt}));
    const sum=Object.values(ppl).sort((a,b)=>b.amt-a.amt).map(p=>[p.name,Object.entries(p.pos).map(([k,n])=>CREW_POS[POS_I[k]??3][1]+(n>1?' ×'+n:'')).join(', '),p.n,p.days,p.amt,p.paid,p.amt-p.paid]);
    const tot=sum.reduce((a,r)=>[a[0]+r[2],a[1]+r[3],a[2]+r[4],a[3]+r[5],a[4]+r[6]],[0,0,0,0,0]);
    books.push(['สรุปรายช่าง',xSheet([...head,['ช่าง','ตำแหน่งที่ทำ','จำนวนงาน','วันทำงานรวม','โบนัสรวม (บาท)','จ่ายแล้ว (บาท)','ค้างจ่าย (บาท)'],...sum,[],['รวม','',...tot]],[24,30,11,13,15,15,15])]);
    const det=[];done.forEach(({j,c})=>{const base=[xDate(c.at),j.code,j.name,pmName(j)||'',+(+c.kw).toFixed(2),c.tier.label,c.days??'',c.lvl?LVL[c.lvl][0]:'ยังไม่ระบุวัน'];
      if(!c.people.length)det.push([...base,'','','','',c.paid?'จ่ายแล้ว':'รอจ่าย','']);
      c.people.forEach(p=>det.push([...base,p.name,CREW_POS[POS_I[p.pos]??3][1],p.worked!=null?p.worked:(c.days??''),p.amt,c.paid?'จ่ายแล้ว':'รอจ่าย',c.paid?xDate(c.paidAt):'']))});
    books.push(['รายละเอียดรายงาน',xSheet([...head,['ติดตั้งเสร็จ','รหัสงาน','ลูกค้า','ผู้ดูแลโครงการ','Inverter (kW)','ขั้น','วันติดตั้ง','ระดับ','ช่าง','ตำแหน่ง','วันที่มาทำ','โบนัส (บาท)','สถานะ','วันที่จ่าย'],...det,[],['รวม','','','','','','','','','','',det.reduce((a,r)=>a+(+r[11]||0),0)]],[13,15,26,20,12,8,10,22,20,15,11,12,10,13])]);
  }else{
    let jobs=visibleJobs();if(!all)jobs=jobs.filter(j=>j.pm===S.me);
    const done=jobs.map(j=>({j,b:bonusOf(j)})).filter(x=>x.b.reached&&bInPeriod(x.b.at)).sort((a,b)=>(a.b.at||0)-(b.b.at||0));
    const ppl={};done.forEach(({j,b})=>{const k=j.pm||('n:'+(j.pmName||''));const r=ppl[k]||(ppl[k]={name:pmName(j)||'ยังไม่กำหนดผู้ดูแล',n:0,kw:0,amt:0,paid:0});r.n++;r.kw+=b.kw;r.amt+=b.amt;if(b.paid)r.paid+=b.amt});
    const sum=Object.values(ppl).sort((a,b)=>b.amt-a.amt).map(p=>[p.name,p.n,+p.kw.toFixed(2),p.amt,p.paid,p.amt-p.paid]);
    books.push(['สรุปรายคน',xSheet([...head,['ผู้ดูแลโครงการ','จำนวนงาน','Inverter รวม (kW)','โบนัสรวม (บาท)','จ่ายแล้ว (บาท)','ค้างจ่าย (บาท)'],...sum,[],['รวม',...sum.reduce((a,r)=>[a[0]+r[1],+(a[1]+r[2]).toFixed(2),a[2]+r[3],a[3]+r[4],a[4]+r[5]],[0,0,0,0,0])]],[26,11,16,15,15,15])]);
    const det=done.map(({j,b})=>[xDate(b.at),j.code,j.name,pmName(j)||'',+(+b.kw).toFixed(2),b.base,b.adj||0,b.amt,b.paid?'จ่ายแล้ว':'รอจ่าย',b.paid?xDate(b.paidAt):'',b.note||'']);
    books.push(['รายละเอียดรายงาน',xSheet([...head,['ติดตั้งเสร็จ','รหัสงาน','ลูกค้า','ผู้ดูแลโครงการ','Inverter (kW)','อัตรา (บาท)','ปรับ +/- (บาท)','โบนัส (บาท)','สถานะ','วันที่จ่าย','หมายเหตุ'],...det,[],['รวม','','','','','','',det.reduce((a,r)=>a+r[7],0)]],[13,15,26,20,12,12,13,12,10,13,24])]);
  }
  return{tab,books}}
async function bonusXlsx(btn){if(btn)btn.disabled=true;
  try{await loadXlsx();const {tab,books}=bonusBooks();const wb=XLSX.utils.book_new();books.forEach(([n,ws])=>XLSX.utils.book_append_sheet(wb,ws,n));
    const per=(S.bMonth||'all')==='all'?'ทั้งหมด':(S.bMonth==='custom'?`${S.bFrom||'เริ่ม'}_${S.bTo||'ล่าสุด'}`:S.bMonth);
    const buf=XLSX.write(wb,{bookType:'xlsx',type:'array'});
    await saveFile(`JobBonus-${tab==='crew'?'ทีมช่าง':'ผู้ดูแลโครงการ'}-${per}.xlsx`,buf,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}
  catch(e){console.error(e);toast('ส่งออก Excel ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')}
  finally{if(btn)btn.disabled=false}}
function saveTiers(tiers){const t=[...tiers].sort((a,b)=>(+a.upTo>0?+a.upTo:1e9)-(+b.upTo>0?+b.upTo:1e9));return upsert('settings','app',{tiers:t},S.settings).catch(writeErr)}
function saveBonus(id,data){return upsert('bonus',id,{job:id,...data},S.bonus.get(id)).catch(writeErr)}

/* ---------- installation crew bonus ---------- */
const CREW_POS=[['lead','หัวหน้าทีม'],['sub','รองหัวหน้าทีม'],['tech','ช่างชำนาญการ'],['help','ผู้ช่วยช่าง']];
const POS_I=Object.fromEntries(CREW_POS.map(([k],i)=>[k,i]));
const DEFAULT_CREW_TIERS=[
  {label:'5–6',upTo:6,exp:'1–2',max:2,smax:1,n:[1000,1000,800,500],s:[1500,1500,1200,800]},
  {label:'10–12',upTo:12,exp:'2–3',max:3,smax:2,n:[1500,1500,1200,600],s:[2300,2300,1800,1200]},
  {label:'15',upTo:15,exp:'3',max:3,smax:2,n:[1750,1750,1400,900],s:[2700,2700,2100,1400]},
  {label:'20',upTo:20,exp:'3–4',max:4,smax:3,n:[2000,2000,1600,1000],s:[3000,3000,2400,1500]}
];
const MAX_CREW=8;
function crewTiers(){const t=(S.settings||{}).crewTiers;return t&&t.length?t:DEFAULT_CREW_TIERS}
function crewRoster(){return((S.settings||{}).crewRoster)||[]}
function crewTier(kw){const t=crewTiers();for(let i=0;i<t.length;i++)if(kw<=+t[i].upTo)return{...t[i],i};return{...t[t.length-1],i:t.length-1}}
function instDays(j){const ins=j.inst||{};if(+ins.days>0)return+ins.days;if(ins.start&&ins.end){const d=Math.round((parseYmd(ins.end)-parseYmd(ins.start))/86400000)+1;return d>0?d:null}return null}
function crewBonusOf(j){const kw=invKw(j)??invEst(j);const tier=crewTier(kw);const d=instDays(j);
  let lvl=null;if(d!=null)lvl=d<=+tier.smax?'special':d<=+tier.max?'normal':'over';
  const rates=lvl==='special'?tier.s:lvl==='normal'?tier.n:null;
  const crew=(j.crew||[]).filter(c=>c&&c.name);
  const prorate=((S.settings||{}).crewProrate||'prorate')==='prorate';
  const people=crew.map(c=>{const full=rates?+(rates[POS_I[c.pos]??3]||0):0;const wd=+c.days>0?+c.days:null;const f=prorate&&wd!=null&&d?Math.min(1,wd/d):1;return{...c,full,worked:wd,part:f<1,amt:Math.round(full*f)}});
  const b=S.bonus.get(j.id)||{};const total=people.reduce((a,p)=>a+p.amt,0);
  const reached=(SIDX[j.stage]??0)>=SIDX.install;
  return{kw,tier,days:d,lvl,people,total:b.crewPaid&&b.crewAmt!=null?+b.crewAmt:total,paid:!!b.crewPaid,paidAt:b.crewPaidAt,reached,at:(j.inst&&j.inst.end)?parseYmd(j.inst.end).getTime():bonusOf(j).at}}
const LVL={special:['Special','good'],normal:['Normal','blue'],over:['เกิน Max Day · ไม่ได้โบนัส','bad']};
const lvlPill=l=>l?`<span class="pst pst-${LVL[l][1]}">${LVL[l][0]}</span>`:'<span class="pst pst-muted">ยังไม่ระบุวันติดตั้ง</span>';

function crewTab(j,dis){const cb=crewBonusOf(j);const ins=j.inst||{};const roster=crewRoster();const crew=[...(j.crew||[])];
  const t=cb.tier;const ed=!dis;
  return `<div class="sect"><h3>ระยะเวลาติดตั้ง</h3><div class="form">
    <div class="fld"><label for="in-start">วันเริ่มติดตั้ง</label><input class="in" id="in-start" type="date" data-inst="start" value="${esc(ins.start||'')}" ${dis}></div>
    <div class="fld"><label for="in-end">วันติดตั้งเสร็จ</label><input class="in" id="in-end" type="date" data-inst="end" value="${esc(ins.end||'')}" ${dis}></div>
    <div class="fld"><label for="in-days">จำนวนวันทำงานจริง</label><input class="in num" id="in-days" type="number" min="0" step="0.5" data-inst="days" value="${esc(ins.days||'')}" placeholder="${ins.start&&ins.end?'คำนวณ '+instDays({inst:{start:ins.start,end:ins.end}})+' วัน':'นับจากวันที่'}" ${dis}></div>
    <div class="fld"><label>ขนาด Inverter</label><div class="in" style="display:flex;align-items:center;background:var(--surface-2)">${fmt1(cb.kw)} kW${invKw(j)==null?' (ประมาณ แก้ได้ในแท็บข้อมูล)':''}</div></div>
  </div>
  <div class="crewrule"><span>ขั้น <b>${esc(t.label)} kW</b> · คาดหวัง ${esc(t.exp)} วัน</span><span>Special ≤ ${t.smax} วัน · Normal ≤ ${t.max} วัน</span><span>ใช้จริง <b>${cb.days!=null?fmt1(cb.days)+' วัน':'–'}</b></span>${lvlPill(cb.lvl)}</div></div>
  <div class="sect"><h3>ทีมช่างติดตั้ง <span class="count">${crew.filter(c=>c&&c.name).length}</span></h3>
  <div class="crewlist"><div class="crow chead"><span>ชื่อช่าง</span><span>ตำแหน่ง</span><span>วันที่มาทำ</span><span class="r">โบนัส</span><span></span></div>${crew.map((c,i)=>{const pp=cb.people.find(x=>x.name===c.name&&x.pos===c.pos&&(x.days||'')===(c.days||''));const amt=c.name&&pp?pp.amt:0;
    return `<div class="crow"><input class="in" id="cr-${i}-name" list="rosterList" data-crew="${i}" data-k="name" value="${esc(c.name||'')}" placeholder="ชื่อช่าง" aria-label="ชื่อช่าง" ${dis}>
    <select class="in" id="cr-${i}-pos" data-crew="${i}" data-k="pos" aria-label="ตำแหน่ง" ${dis}>${CREW_POS.map(([k,l])=>`<option value="${k}" ${c.pos===k?'selected':''}>${l}</option>`).join('')}</select>
    <input class="in num" id="cr-${i}-days" type="number" min="0" step="0.5" data-crew="${i}" data-k="days" value="${esc(c.days||'')}" placeholder="${cb.days!=null?'ครบ '+fmt1(cb.days):'ครบทุกวัน'}" aria-label="วันที่มาทำ" ${dis}>
    <span class="num camt">฿${fmt(amt)}${pp&&pp.part?`<small>${fmt1(pp.worked)}/${fmt1(cb.days)} วัน</small>`:''}</span>${ed?`<button class="rm" data-rmcrew="${i}" aria-label="ลบช่าง">✕</button>`:'<span></span>'}</div>`}).join('')||'<p class="muted" style="margin:0">ยังไม่ได้กำหนดทีมช่าง</p>'}</div>
  <datalist id="rosterList">${roster.map(r=>`<option value="${esc(r.name)}">${esc((CREW_POS.find(p=>p[0]===r.pos)||[,''])[1])}</option>`).join('')}</datalist>
  ${ed?`<div class="acts">${crew.length<MAX_CREW?'<button class="btn sm" data-act="addcrew">+ เพิ่มช่าง</button>':''}${roster.length&&!crew.length?'<button class="btn sm blue" data-act="crewdefault">ใช้รายชื่อช่างประจำทั้งหมด</button>':''}</div>`:''}
  <div class="tot"><div class="row grand"><span>โบนัสทีมช่างงานนี้</span><span class="num">${fmt(cb.total)} บาท</span></div>${cb.paid?`<span class="pst pst-good">จ่ายแล้ว ${dTH(cb.paidAt)}</span>`:cb.reached?'<span class="pst pst-blue">ติดตั้งเสร็จแล้ว รอจ่าย</span>':'<span class="pst pst-muted">ถึงกำหนดเมื่อติดตั้งเสร็จ</span>'}</div>
  <p class="note" style="margin:0">ช่างแต่ละคนได้โบนัสตามตำแหน่งของตัวเอง ทีมละไม่เกิน ${MAX_CREW} คน · ช่าง “วันที่มาทำ” ว่างไว้ถ้ามาครบทุกวัน ${((S.settings||{}).crewProrate||'prorate')==='prorate'?'ถ้ามาไม่ครบ โบนัสคิดตามสัดส่วนวันที่มา':'ช่างได้โบนัสเต็มจำนวนแม้มาไม่ครบ (ตั้งค่าในหน้า Job Bonus)'}</p></div>`}
function saveCrew(id,crew){return saveJob(id,{crew})}

function crewBonusHTML(){const all=can('bonus.view.all');if(!all)return'';
  const M=S.bMonth||'all';const pay=can('bonus.pay');
  const items=visibleJobs().map(j=>({j,c:crewBonusOf(j)}));
  const done=items.filter(x=>x.c.reached&&bInPeriod(x.c.at)).sort((a,b)=>(b.c.at||0)-(a.c.at||0));
  const unpaid=done.filter(x=>!x.c.paid&&x.c.total>0),paid=done.filter(x=>x.c.paid);
  const s=a=>a.reduce((t,x)=>t+x.c.total,0);
  const cnt=l=>done.filter(x=>x.c.lvl===l).length;
  const ppl={};done.forEach(({j,c})=>c.people.forEach(p=>{const k=p.name.trim();const r=ppl[k]||(ppl[k]={name:k,pos:{},n:0,amt:0,paid:0});r.n++;r.pos[p.pos]=(r.pos[p.pos]||0)+1;r.amt+=p.amt;if(c.paid)r.paid+=p.amt}));
  const ed=can('settings.edit');const t=crewTiers();
  return `<div class="kpis">
    <div class="kpi hero"><span class="lbl">ทีมช่าง · ถึงกำหนดยังไม่จ่าย</span><span class="v num">฿${fmt(s(unpaid))}</span><span class="s">${unpaid.length} งาน</span></div>
    <div class="kpi"><span class="lbl">จ่ายแล้ว</span><span class="v num" style="color:var(--good)">฿${fmt(s(paid))}</span><span class="s">${paid.length} งาน</span></div>
    <div class="kpi"><span class="lbl">ได้ระดับ Special</span><span class="v num">${cnt('special')}<small>งาน</small></span><span class="s">Normal ${cnt('normal')} · เกินกำหนด ${cnt('over')}</span></div>
    <div class="kpi"><span class="lbl">ยังไม่ระบุวันหรือทีม</span><span class="v num">${done.filter(x=>!x.c.lvl||!x.c.people.length).length}<small>งาน</small></span><span class="s">กรอกในแท็บ “ทีมช่าง” ของงาน</span></div>
  </div>
  ${Object.keys(ppl).length?`<section class="panel"><h2>สรุปรายช่าง</h2><div class="tbl-wrap"><table><thead><tr><th>ช่าง</th><th>ตำแหน่งที่ทำ</th><th class="r">จำนวนงาน</th><th class="r">โบนัสรวม</th><th class="r">จ่ายแล้ว</th><th class="r">ค้างจ่าย</th></tr></thead><tbody>
    ${Object.values(ppl).sort((a,b)=>b.amt-a.amt).map(p=>`<tr><td>${avName(p.name,'sm')} ${esc(p.name)}</td><td>${Object.entries(p.pos).map(([k,n])=>`${esc(CREW_POS[POS_I[k]??3][1])}${n>1?' ×'+n:''}`).join(', ')}</td><td class="r num">${p.n}</td><td class="r num"><b>${fmt(p.amt)}</b></td><td class="r num" style="color:var(--good)">${fmt(p.paid)}</td><td class="r num" style="color:var(--orange)">${fmt(p.amt-p.paid)}</td></tr>`).join('')}
  </tbody></table></div></section>`:''}
  <section class="panel"><h2>งานที่ติดตั้งเสร็จ <span class="count">${done.length}</span></h2>
  <div class="tbl-wrap"><table class="bontbl"><thead><tr><th>งาน</th><th class="r">Inverter</th><th class="r">วันติดตั้ง</th><th>ระดับ</th><th>ทีมช่าง</th><th class="r">โบนัสทีม</th><th>สถานะ</th></tr></thead><tbody>
  ${done.map(({j,c})=>`<tr><td><button class="lnk" data-open="${j.id}" data-opentab="crew">${esc(j.name)}</button><br><span class="muted num" style="font-size:12px">${esc(j.code)}</span></td>
    <td class="r num">${fmt1(c.kw)} kW<br><span class="muted" style="font-size:11px">ขั้น ${esc(c.tier.label)}</span></td>
    <td class="r num">${c.days!=null?fmt1(c.days)+' วัน':'–'}<br><span class="muted" style="font-size:11px">S≤${c.tier.smax} N≤${c.tier.max}</span></td>
    <td>${lvlPill(c.lvl)}</td><td>${c.people.length?c.people.map(p=>`<span class="crewchip">${esc(p.name)} <i>${esc(CREW_POS[POS_I[p.pos]??3][1])}${p.part?` · ${fmt1(p.worked)} วัน`:''}</i></span>`).join(' '):'<span class="muted">ยังไม่ระบุ</span>'}</td>
    <td class="r num"><b>${fmt(c.total)}</b></td>
    <td>${c.paid?`<span class="pst pst-good">จ่ายแล้ว ${dTH(c.paidAt)}</span>${pay?` <button class="lnk" data-cunpay="${j.id}">ยกเลิก</button>`:''}`:pay&&c.total>0?`<button class="btn sm pri" data-cpay="${j.id}">บันทึกจ่ายแล้ว</button>`:c.total>0?'<span class="pst pst-blue">รอจ่าย</span>':'–'}</td></tr>`).join('')||`<tr><td colspan="7" class="muted">ยังไม่มีงานที่ติดตั้งเสร็จ${M==='all'?'':'ในช่วงนี้'}</td></tr>`}
  </tbody></table></div></section>
  <section class="panel"><h2>ตารางโบนัสทีมช่าง</h2>
  <div class="tbl-wrap"><table class="crewtbl"><thead><tr><th rowspan="2">kW Inverter</th><th rowspan="2">ไม่เกิน (kW)</th><th rowspan="2">คาดหวัง (วัน)</th><th colspan="5" class="grp-n">Normal</th><th colspan="5" class="grp-s">Special</th>${ed?'<th rowspan="2"></th>':''}</tr>
    <tr><th class="grp-n">Max Day</th>${CREW_POS.map(p=>`<th class="grp-n">${p[1]}</th>`).join('')}<th class="grp-s">Max Day</th>${CREW_POS.map(p=>`<th class="grp-s">${p[1]}</th>`).join('')}</tr></thead><tbody>
  ${t.map((r,i)=>ed?`<tr><td><input class="in" id="ct-${i}-label" data-ctier="${i}" data-k="label" value="${esc(r.label)}"></td><td><input class="in num" id="ct-${i}-up" data-ctier="${i}" data-k="upTo" type="number" min="0" step="0.1" value="${+r.upTo}"></td><td><input class="in" id="ct-${i}-exp" data-ctier="${i}" data-k="exp" value="${esc(r.exp)}"></td>
    <td class="grp-n"><input class="in num" id="ct-${i}-max" data-ctier="${i}" data-k="max" type="number" min="0" step="0.5" value="${+r.max}"></td>${CREW_POS.map((p,k)=>`<td class="grp-n"><input class="in num" id="ct-${i}-n${k}" data-ctier="${i}" data-k="n" data-pi="${k}" type="number" min="0" step="50" value="${+r.n[k]}"></td>`).join('')}
    <td class="grp-s"><input class="in num" id="ct-${i}-smax" data-ctier="${i}" data-k="smax" type="number" min="0" step="0.5" value="${+r.smax}"></td>${CREW_POS.map((p,k)=>`<td class="grp-s"><input class="in num" id="ct-${i}-s${k}" data-ctier="${i}" data-k="s" data-pi="${k}" type="number" min="0" step="50" value="${+r.s[k]}"></td>`).join('')}
    <td>${t.length>1?`<button class="rm" data-rmctier="${i}" aria-label="ลบขั้น">✕</button>`:''}</td></tr>`
    :`<tr><td>${esc(r.label)}</td><td class="num">${+r.upTo}</td><td>${esc(r.exp)}</td><td class="num grp-n">${+r.max}</td>${r.n.map(v=>`<td class="num grp-n">${fmt(v)}</td>`).join('')}<td class="num grp-s">${+r.smax}</td>${r.s.map(v=>`<td class="num grp-s">${fmt(v)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>
  ${ed?'<div class="acts"><button class="btn sm" data-act="addctier">+ เพิ่มขั้น</button></div>':''}
  <div class="tools"><label class="inline">ช่างที่มาไม่ครบทุกวัน <select class="in sel-sm" id="crewProrate" ${ed?'':'disabled'}><option value="prorate" ${((S.settings||{}).crewProrate||'prorate')==='prorate'?'selected':''}>คิดตามสัดส่วนวันที่มา</option><option value="full" ${(S.settings||{}).crewProrate==='full'?'selected':''}>ได้เต็มจำนวน</option></select></label></div>
  <p class="note" style="margin:0">ทำเสร็จภายใน Max Day ของ Special ได้อัตรา Special · ภายใน Max Day ของ Normal ได้อัตรา Normal · เกินกว่านั้นไม่ได้โบนัส · Inverter ที่ใหญ่กว่าขั้นสุดท้ายใช้อัตราขั้นสุดท้าย</p></section>
  <section class="panel"><h2>รายชื่อช่างประจำ <span class="count">${crewRoster().length}</span></h2>
  ${ed?`<div class="crewlist">${crewRoster().map((r,i)=>`<div class="crow"><input class="in" id="ro-${i}-name" data-roster="${i}" data-k="name" value="${esc(r.name)}" placeholder="ชื่อช่าง"><select class="in" id="ro-${i}-pos" data-roster="${i}" data-k="pos">${CREW_POS.map(([k,l])=>`<option value="${k}" ${r.pos===k?'selected':''}>${l}</option>`).join('')}</select><span></span><button class="rm" data-rmroster="${i}" aria-label="ลบ">✕</button></div>`).join('')}</div>
    <div class="acts"><button class="btn sm" data-act="addroster">+ เพิ่มช่าง</button></div><p class="note" style="margin:0">ใช้เป็นตัวเลือกเวลาจัดทีมในแต่ละงาน ตำแหน่งที่ตั้งไว้เป็นค่าเริ่มต้น เปลี่ยนเป็นรายงานได้</p>`
    :`<div class="list">${crewRoster().map(r=>`<div class="li"><span>${esc(r.name)}</span><span class="muted">${esc((CREW_POS.find(p=>p[0]===r.pos)||[,''])[1])}</span></div>`).join('')||'<p class="muted" style="margin:0">ยังไม่มีรายชื่อ</p>'}</div>`}
  </section>`}
function saveCrewTiers(t){return upsert('settings','app',{crewTiers:t},S.settings).catch(writeErr)}
function saveRoster(r){return upsert('settings','app',{crewRoster:r},S.settings).catch(writeErr)}

/* ---------- permissions page ---------- */
function permHTML(){if(realRole()!=='admin')return noAccess('การตั้งค่าสิทธิ์');
  const pd=r=>({...DEFAULT_PERMS[r],...((S.permsDoc||{})[r]||{})});
  let people=[];
  if(BK&&BK.kind==='firebase'){const byEmail={};Object.entries(S.prof).forEach(([id,p])=>{if(p.email)byEmail[p.email.toLowerCase()]=id});
    people=[...new Set([...ADMIN_EMAILS,...(S.isAdmin?[S.email]:[]),...S.members.map(m=>m.id)])].map(e=>({key:e,id:byEmail[e],label:byEmail[e]?nm(byEmail[e]):e,sub:e,role:(ADMIN_EMAILS.includes(e)||e===S.email&&S.isAdmin)?'admin':((S.members.find(m=>m.id===e)||{}).role||'staff')}))}
  else people=teamIds().map(id=>({key:id,id,label:nm(id)+(id===S.me?' (คุณ)':''),sub:'',role:id===S.ownerId||(id===S.me&&S.isAdmin)?'admin':(S.roleMap[id]||'staff')}));
  return `<section class="panel"><h2>สิทธิ์ตามตำแหน่ง</h2>
    <p class="note" style="margin:0">ติ๊กเพื่อเปิดสิทธิ์ การเปลี่ยนแปลงมีผลกับทุกคนในตำแหน่งนั้นทันที ผู้ดูแลระบบมีสิทธิ์ทั้งหมดเสมอ</p>
    <div class="tbl-wrap"><table class="permtbl"><thead><tr><th>สิทธิ์</th>${Object.entries(ROLES).map(([k,t])=>`<th class="c">${esc(t)}</th>`).join('')}</tr></thead><tbody>
    ${PERMS.map(([p,t])=>`<tr><td>${esc(t)}</td><td class="c"><input type="checkbox" checked disabled aria-label="ผู้ดูแลระบบ: ${esc(t)}"></td>${['manager','staff'].map(r=>`<td class="c"><input type="checkbox" id="perm-${r}-${p.replace(/\./g,'_')}" data-perm="${r}|${p}" ${pd(r)[p]?'checked':''} aria-label="${esc(ROLES[r])}: ${esc(t)}"></td>`).join('')}</tr>`).join('')}
    </tbody></table></div></section>
  <section class="panel"><h2>กำหนดตำแหน่งให้สมาชิก <span class="count">${people.length}</span></h2>
    ${BK&&BK.kind==='firebase'?'<p class="note" style="margin:0">เพิ่มสมาชิกใหม่ได้ที่เมนู “ทีมงาน” สมาชิกใหม่เริ่มเป็นพนักงานทั่วไป</p>':BK&&BK.kind==='artifact'?'<p class="note" style="margin:0">รายชื่อจะขึ้นเมื่อสมาชิกเปิดหน้านี้อย่างน้อยหนึ่งครั้ง เพิ่มคนเข้าใช้ได้จากเมนู Share ของหน้า</p>':''}
    <div class="list">${people.map(p=>`<div class="mem">${p.id?av(p.id):avName(p.label)}<span style="min-width:0"><b>${esc(p.label)}</b>${p.sub?`<small>${esc(p.sub)}</small>`:''}</span>
      ${p.role==='admin'?'<span class="tag">ผู้ดูแลระบบ</span>':`<select class="in sel-sm" id="role-${esc(p.key).replace(/[^a-zA-Z0-9_-]/g,'_')}" data-setrole="${esc(p.key)}" aria-label="ตำแหน่งของ ${esc(p.label)}">${['manager','staff'].map(r=>`<option value="${r}" ${p.role===r?'selected':''}>${esc(ROLES[r])}</option>`).join('')}</select>`}</div>`).join('')}</div></section>
  <section class="panel"><h2>ทดลองดูหน้าจอตามตำแหน่ง</h2><p class="note" style="margin:0">ใช้ตรวจว่าแต่ละตำแหน่งจะเห็นอะไร มีผลเฉพาะหน้าจอของคุณ</p>
    <div class="tools">${[['','ผู้ดูแลระบบ (ปกติ)'],['manager',ROLES.manager],['staff',ROLES.staff]].map(([k,t])=>`<button class="chip" data-preview="${k}" aria-pressed="${(S.previewRole||'')===k}">${esc(t)}</button>`).join('')}</div></section>`}
function setRole(key,role){if(BK.kind==='firebase'){const cur=S.members.find(m=>m.id===key);return upsert('members',key,{role},cur).catch(writeErr)}
  return upsert('roles',key,{role},S.roleMap[key]!=null).catch(writeErr)}

/* ---------- more menu (phones) ---------- */
function openMore(){const items=[['team','ทีมงาน'],...(can('finance.view')?[['pay','สถานะการจ่ายเงิน']]:[]),...(can('bonus.view.all')||can('bonus.view.own')?[['bonus','Job Bonus']]:[]),...(realRole()==='admin'?[['perm','สิทธิ์การใช้งาน']]:[])];
  modal('เมนูเพิ่มเติม',`<div class="morelist">${items.map(([k,t])=>`<button class="btn" data-view="${k}">${esc(t)}</button>`).join('')}${BK&&BK.kind==='firebase'?'<button class="btn danger" data-act="signout">ออกจากระบบ</button>':''}</div>`)}

/* ---------- drawer ---------- */
let photoUnsub=null;
function watchPhotos(){const want=S.open&&S.tab==='photos'?S.open:null;if(want===S.photoJob)return;
  if(photoUnsub){photoUnsub();photoUnsub=null}S.photos=[];S.photoJob=want;S.photosLoaded=false;if(!want)return;
  photoUnsub=BK.watchWhere('photos','job',want,docs=>{if(S.photoJob!==want)return;S.photos=docs.map(d=>({id:d.id,...d.data})).sort((a,b)=>(a.at||0)-(b.at||0));S.photosLoaded=true;healCounts(want);renderDrawer();renderLightbox()},e=>{console.error(e);S.photosLoaded=true;renderDrawer()})}
function healCounts(id){const j=S.jobs.get(id);if(!j||!canEditJob(j))return;const c={};PHOTO_CATS.forEach(([k])=>c[k]=0);S.photos.forEach(p=>{if(c[p.cat]!=null)c[p.cat]++});
  const cur=j.photos||{};if(PHOTO_CATS.some(([k])=>(cur[k]||0)!==c[k]))BK.patch('jobs',id,{photos:c}).catch(()=>{})}
function openDrawer(id,tab){S.open=id;S.tab=tab||'info';$('#drawer').hidden=false;$('#scrim').hidden=false;beat();watchPhotos();renderDrawer(true);$('#drawer .x')?.focus()}
function closeDrawer(){if(!S.open)return;S.open=null;S.lb=null;if(S.mini){S.mini.remove();S.mini=null}$('#drawer').hidden=true;$('#scrim').hidden=true;watchPhotos();renderLightbox();beat()}
function renderDrawer(force){
  const el=$('#drawer');if(!S.open)return;
  const j0=S.jobs.get(S.open);if(!j0){if(S.loaded)closeDrawer();return}
  const ae=document.activeElement;let keep=null;
  if(el.contains(ae)&&/INPUT|TEXTAREA|SELECT/.test(ae.tagName)&&ae.type!=='checkbox'&&ae.type!=='file'){if(ae.closest('form.apptf,form.payf')&&!force){S.drawerDirty=true;return}if(ae.id)keep={id:ae.id,val:ae.value,s:ae.selectionStart,e:ae.selectionEnd}}
  S.drawerDirty=false;
  const j={id:S.open,...j0};const i=SIDX[j.stage]??0;const dis=canEditJob(j0)?'':'disabled';
  const bodyScroll=el.querySelector('.d-body')?.scrollTop||0;
  const vIds=[...new Set(viewersOf(j.id).map(p=>p.by))];
  if(S.mini){S.mini.remove();S.mini=null}
  const ph=photoProg(j);
  el.innerHTML=`<div class="d-head">
    <div class="d-top"><div class="t"><div class="code">${grpTag(j)}<span>${esc(j.code)}</span>${j.demo?'<span class="tag demo">ตัวอย่าง</span>':''}<span>อัปเดต ${ago(j.updatedAt)} โดย ${esc(nm(j.updatedBy))}</span></div><h2>${esc(j.name)}</h2>${pmName(j)?`<div class="pmline">${pmAv(j,'sm')}<span>ผู้ดูแลโครงการ: <b>${esc(pmName(j))}</b></span></div>`:''}</div>
    <button class="x" data-act="close" aria-label="ปิด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    ${!canEditJob(j0)&&S.baseWrite!==false?`<div class="banner soft" style="margin:0"><span>ดูได้อย่างเดียว · งานนี้แก้ไขได้เฉพาะ${pmName(j)?' '+esc(pmName(j))+' (ผู้ดูแลโครงการ) และ':''}ผู้ดูแลระบบ</span></div>`:''}
    ${vIds.length?`<div class="seen">${vIds.map(id=>av(id,'sm')).join('')}<span>${vIds.map(id=>esc(nm(id))).join(', ')} กำลังเปิดงานนี้อยู่</span></div>`:''}
    <div class="stepper" role="list">${STAGES.map((s,k)=>`<button class="stp ${k<i?'past':k===i?'cur':''}" data-stage="${s.k}" title="${esc(s.t)}" ${dis}><i></i><span>${esc(s.s)}</span></button>`).join('')}</div>
    <div class="stage-row"><span class="now">ขั้นที่ ${i+1}/${STAGES.length} · ${esc(STAGES[i].t)}<small>อยู่ในขั้นนี้ ${days(j.stageAt)} วัน · เริ่ม ${dTH(j.stageAt)}</small></span>
      ${i>0?`<button class="btn sm" data-stage="${STAGES[i-1].k}" ${dis}>← ย้อน</button>`:''}
      ${i<STAGES.length-1?`<button class="btn sm pri" data-stage="${STAGES[i+1].k}" ${dis}>ขั้นถัดไป: ${esc(STAGES[i+1].s)} →</button>`:''}</div>
    <div class="tabs" role="tablist">${[['info','ข้อมูล'],...(can('quote.view')?[['quote','ใบเสนอราคา']]:[]),...(canProposal(j)?[['proposal','Proposal']]:[]),...(can('finance.view')?[['pay','การเงิน']]:[]),['permit','ขออนุญาต'],['appts',`นัดหมาย${(j.appts||[]).length?` (${j.appts.length})`:''}`],...(can('bonus.view.all')||JW()?[['crew',`ทีมช่าง${(j.crew||[]).filter(c=>c&&c.name).length?` (${(j.crew||[]).filter(c=>c&&c.name).length})`:''}`]]:[]),['photos',`รูปถ่าย ${ph.d}/${ph.n}`],['log','ประวัติ']].map(([k,t])=>`<button role="tab" data-tab="${k}" aria-selected="${S.tab===k}">${t}</button>`).join('')}</div>
  </div>
  <div class="d-body">${S.tab==='info'?infoTab(j,dis):S.tab==='pay'?payTab(j):S.tab==='quote'&&can('quote.view')?quoteTab(j,dis):S.tab==='proposal'&&canProposal(j)?proposalTab(j,dis):S.tab==='permit'?permitTab(j,dis):S.tab==='crew'?crewTab(j,dis):S.tab==='appts'?apptTab(j,dis):S.tab==='photos'?photoTab(j,dis):logTab(j)}</div>`;
  el.querySelector('.d-body').scrollTop=bodyScroll;
  const at=el.querySelector('.tabs [aria-selected="true"]');if(at){const tb=at.parentElement;if(at.offsetLeft+at.offsetWidth>tb.scrollLeft+tb.clientWidth||at.offsetLeft<tb.scrollLeft)tb.scrollLeft=at.offsetLeft-24}
  if(S.tab==='info')initMini(j);
  if(keep){const n=document.getElementById(keep.id);if(n){if(n.value!==keep.val)n.value=keep.val;n.focus({preventScroll:true});try{if(keep.s!=null)n.setSelectionRange(keep.s,keep.e)}catch{}}}
}
const opt=(arr,v)=>arr.map(([k,t])=>`<option value="${esc(k)}" ${String(v)===String(k)?'selected':''}>${esc(t)}</option>`).join('');
function infoTab(j,dis){
  const pmSel=j.pm||(j.pmName!=null&&j.pmName!==''||j.pmOther?'_other':'');
  return `<div class="roles">
    <div class="owner">${pmAv(j)||'<span class="av ini" style="background:var(--surface-2);color:var(--ink-3)">?</span>'}<span class="who"><small>ผู้ดูแลโครงการ</small>
      <select class="in sel-in" id="f-pm" data-pm="1" ${can('jobs.edit')&&S.baseWrite!==false?'':'disabled'}>${teamOpts(pmSel,true)}</select>${pmSel==='_other'?`<input class="in" id="f-pmname" data-f="pmName" value="${esc(j.pmName)}" placeholder="พิมพ์ชื่อผู้ดูแลโครงการ" ${dis}>`:''}</span></div>
    <div class="owner">${av(j.owner)}<span class="who"><b>${esc(nm(j.owner))}</b><small>ผู้รับงาน / ฝ่ายขาย</small></span>${j.owner!==S.me&&S.me?`<button class="btn sm blue" data-act="claim" ${dis}>รับงานนี้</button>`:''}</div>
  </div>
  <div class="form">
    <div class="fld full"><label for="f-name">ชื่อลูกค้า</label><input class="in" id="f-name" data-f="name" value="${esc(j.name)}" ${dis}></div>
    <div class="fld"><label for="f-grp">กลุ่มลูกค้า</label><select class="in" id="f-grp" data-f="grp" ${dis}>${grpOf(j)?'':'<option value="" selected>ยังไม่ระบุ</option>'}${opt([['special','กลุ่ม 1 · SPECIAL'],['normal','กลุ่ม 2 · Normal']],j.grp)}</select></div>
    <div class="fld"><label for="f-phone">เบอร์โทร</label><input class="in num" id="f-phone" data-f="phone" type="tel" value="${esc(j.phone)}" ${dis}></div>
    <div class="fld"><label for="f-email">อีเมล</label><div class="team-add"><input class="in" id="f-email" data-f="email" type="email" value="${esc(j.email||'')}" placeholder="name@example.com" ${dis}>${j.email?`<button class="btn" data-copy="${esc(j.email)}" aria-label="คัดลอกอีเมล">คัดลอก</button>`:''}</div></div>
    <div class="fld"><label for="f-prov">จังหวัด</label><input class="in" id="f-prov" data-f="prov" value="${esc(j.prov)}" ${dis}></div>
    <div class="fld full"><label for="f-addr">ที่อยู่ติดตั้ง</label><input class="in" id="f-addr" data-f="addr" value="${esc(j.addr)}" ${dis}></div>
  </div>
  <div class="locbox">
    <div class="fld"><label for="f-loc">ตำแหน่งบน Google Maps</label>
      <div class="team-add"><input class="in" id="f-loc" data-loc="1" value="${esc(hasLoc(j)?`${j.lat}, ${j.lng}`:(j.mapUrl||''))}" placeholder="วางลิงก์ Google Maps หรือพิกัด เช่น 13.7563, 100.5018" ${dis}>${navigator.geolocation&&BK.kind!=='artifact'?`<button class="btn" data-act="geo" ${dis}>ตำแหน่งฉันตอนนี้</button>`:''}</div>
      <span class="note">วิธีที่แม่นที่สุด: ใน Google Maps กดค้างที่หลังคาบ้านลูกค้า แล้วคัดลอกตัวเลขพิกัดมาวาง${mapAvailable()?' หรือแตะ/ลากหมุดบนภาพดาวเทียมด้านล่าง':''}</span></div>
    ${mapAvailable()?`<div id="minimap" class="minimap"></div>`:hasLoc(j)?`<div class="locstatic num">พิกัด ${j.lat}, ${j.lng}</div>`:''}
    ${hasLoc(j)||j.mapUrl?`<div class="acts"><a class="btn sm" href="${esc(gmapsUrl(j))}" target="_blank" rel="noopener">เปิดใน Google Maps</a><a class="btn sm blue" href="${esc(gdirUrl(j))}" target="_blank" rel="noopener">นำทางไปหน้างาน</a></div>`:''}
  </div>
  <div class="form">
    <div class="fld"><label for="f-util">การไฟฟ้า</label><select class="in" id="f-util" data-f="util" ${dis}>${opt([['PEA','กฟภ. (PEA)'],['MEA','กฟน. (MEA)']],j.util)}</select></div>
    <div class="fld"><label for="f-phase">มิเตอร์</label><select class="in" id="f-phase" data-f="phase" ${dis}>${opt([['1','1 เฟส'],['3','3 เฟส']],j.phase)}</select></div>
    <div class="fld"><label for="f-type">ประเภทระบบ</label><select class="in" id="f-type" data-f="type" ${dis}>${opt([['ongrid','On-Grid'],['hybrid','Hybrid + แบตเตอรี่']],j.type)}</select></div>
    <div class="fld"><label for="f-kw">ขนาดระบบ (kWp)</label><input class="in num" id="f-kw" data-f="kw" type="number" step="0.01" min="0" value="${esc(j.kw)}" ${dis}></div>
    <div class="fld"><label for="f-inv">ขนาด Inverter (kW)</label><input class="in num" id="f-inv" data-f="inv" type="number" step="0.1" min="0" value="${esc(j.inv||'')}" placeholder="ประมาณ ${invEst(j)} kW" ${dis}></div>
    <div class="fld"><label for="f-roof">ชนิดหลังคา</label><select class="in" id="f-roof" data-f="roof" ${dis}>${opt(ROOFS.map(r=>[r,r]),j.roof)}</select></div>
    <div class="fld"><label for="f-created">วันที่รับงาน</label><input class="in" id="f-created" value="${dTH(j.createdAt)}" disabled></div>
    <div class="fld full"><label for="f-note">บันทึกหน้างาน</label><textarea class="in" id="f-note" data-f="note" placeholder="ทิศหลังคา เงาบัง จุดวางอินเวอร์เตอร์ ระยะสายถึงตู้ MDB" ${dis}>${esc(j.note)}</textarea></div>
  </div>
  ${can('jobs.delete')&&canEditJob(j)?`<div class="acts"><button class="btn sm danger" data-act="delete">ลบงานนี้</button></div>`:''}`;
}
function initMini(j){const el=$('#minimap');if(!el||!window.L)return;const L=window.L;
  const c=hasLoc(j)?[+j.lat,+j.lng]:[13.75,100.5];const map=L.map(el,{zoomControl:true,attributionControl:false}).setView(c,hasLoc(j)?18:6);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20}).addTo(map);
  const icon=L.divIcon({className:'pin',html:`<span style="--c:#F0661A"><b>●</b></span>`,iconSize:[30,40],iconAnchor:[15,38]});
  let mk=hasLoc(j)?L.marker(c,{icon,draggable:JW()}).addTo(map):null;
  const setLoc=ll=>{saveJob(S.open,{lat:+ll.lat.toFixed(6),lng:+ll.lng.toFixed(6)},'ปักหมุดตำแหน่งหน้างาน')};
  if(mk)mk.on('dragend',()=>setLoc(mk.getLatLng()));
  if(JW())map.on('click',e=>{if(mk)mk.setLatLng(e.latlng);else{mk=L.marker(e.latlng,{icon,draggable:true}).addTo(map);mk.on('dragend',()=>setLoc(mk.getLatLng()))}setLoc(e.latlng)});
  S.mini=map;setTimeout(()=>{if(S.mini===map)map.invalidateSize()},50)}
function quoteTab(j,dis){const t=quoteTotals(j);const e=estimate(j);const items=j.quote?.items||[];
  return `<div class="stage-row"><span class="now">ใบเสนอราคา ${esc(j.code)}<small>ระบบ ${fmt1(j.kw)} kWp ${j.type==='hybrid'?'Hybrid':'On-Grid'} · ${j.phase==='3'?'3':'1'} เฟส</small></span>
    <select class="in" style="width:auto" id="q-status" data-q="status" ${dis}>${opt([['draft','ร่าง'],['sent','ส่งลูกค้าแล้ว'],['approved','ลูกค้าอนุมัติ'],['rejected','ไม่ผ่าน']],j.quote?.status)}</select></div>
  <div class="tbl-wrap"><table class="qt"><thead><tr><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคา/หน่วย</th><th class="r">รวม</th><th></th></tr></thead><tbody>
  ${items.map((it,k)=>`<tr><td class="c-d"><input class="in" id="qi-${k}-d" data-i="${k}" data-k="d" value="${esc(it.d)}" ${dis}></td><td class="c-q"><input class="in num" id="qi-${k}-q" data-i="${k}" data-k="q" type="number" step="any" value="${esc(it.q)}" ${dis}></td><td class="c-u"><input class="in" id="qi-${k}-u" data-i="${k}" data-k="u" value="${esc(it.u)}" ${dis}></td><td class="c-p"><input class="in num" id="qi-${k}-p" data-i="${k}" data-k="p" type="number" step="any" value="${esc(it.p)}" ${dis}></td><td class="c-a">${fmt((+it.q||0)*(+it.p||0))}</td><td>${JW()?`<button class="rm" data-rm="${k}" aria-label="ลบรายการ">✕</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">ยังไม่มีรายการ</td></tr>'}
  </tbody></table></div>
  ${JW()?`<div class="acts"><button class="btn sm" data-act="additem">+ เพิ่มรายการ</button><button class="btn sm blue" data-act="gen">สร้างรายการใหม่จากขนาดระบบ</button></div>`:''}
  <div class="totals">
    <div class="tot"><div class="row"><span>รวมเป็นเงิน</span><span class="num">${fmt(t.sub)}</span></div>
      <div class="row"><label for="q-disc">ส่วนลด</label><input class="in" id="q-disc" data-q="discount" type="number" min="0" value="${esc(j.quote?.discount||0)}" ${dis}></div>
      <div class="row"><span>หลังหักส่วนลด</span><span class="num">${fmt(t.net)}</span></div>
      <div class="row"><span>ภาษีมูลค่าเพิ่ม 7%</span><span class="num">${fmt(t.vat)}</span></div>
      <div class="row grand"><span>รวมทั้งสิ้น (บาท)</span><span class="num">${fmt(t.total)}</span></div>
      <div class="row muted"><span>ราคาต่อวัตต์</span><span class="num">${e.ppw.toFixed(2)} บาท/W</span></div></div>
    <div class="tot est"><span class="lbl">ประมาณการความคุ้มค่า</span>
      <div class="row"><span>ผลิตไฟได้ราว</span><span class="big num">${fmt(e.month)}<small style="font-size:13px"> หน่วย/เดือน</small></span></div>
      <div class="row"><span>ประหยัดค่าไฟราว</span><span class="num" style="font-weight:700">฿${fmt(e.monthSave)}/เดือน</span></div>
      <div class="row"><span>คืนทุนประมาณ</span><span class="num" style="font-weight:700">${e.payback?e.payback.toFixed(1):'–'} ปี</span></div>
      <div class="row"><label for="q-tariff">ค่าไฟเฉลี่ย (บาท/หน่วย)</label><input class="in" id="q-tariff" data-q="tariff" type="number" step="0.01" min="0" value="${esc(e.tariff)}" ${dis}></div>
      <span class="note">คิดที่ ${KWH_PER_KWP_DAY} หน่วย/kWp/วัน และสมมติใช้ไฟที่ผลิตได้เองทั้งหมดในเวลากลางวัน</span></div>
  </div>
  <div class="acts">${BK.kind!=='artifact'?`<button class="btn pri" data-act="printquote">พิมพ์ / บันทึกเป็น PDF</button>`:''}${canDownload()?`<button class="btn ${BK.kind==='artifact'?'pri':''}" data-act="savequote">ดาวน์โหลดใบเสนอราคา (.html)</button>`:''}<button class="btn" data-act="copyquote">คัดลอกสรุปส่งลูกค้า</button></div>`;
}

/* ---------- Proposal (.pptx) ---------- */
const fk2=n=>(+n||0).toLocaleString('th-TH',{maximumFractionDigits:2});
const PPTX_SRC='https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js';
let pptxLoad=null;
function loadPptx(){if(window.PptxGenJS&&window.JSZip)return Promise.resolve();
  return pptxLoad||(pptxLoad=new Promise((ok,no)=>{const sc=document.createElement('script');sc.src=PPTX_SRC;sc.onload=()=>window.PptxGenJS?ok():no(new Error('PptxGenJS missing'));sc.onerror=()=>{pptxLoad=null;no(new Error('load failed'))};document.head.appendChild(sc)}))}
function ppIn(j){const p=j.proposal||{};const d=(window.ST_PROPOSAL&&ST_PROPOSAL.DEFAULTS)||{};
  return{phase:j.phase||'1',mode:p.mode||'bill',bill:p.bill??'',units:p.units??'',tariff:p.tariff??d.tariff,dayPct:p.dayPct??d.dayPct,maxKwp:p.maxKwp??'',sell:p.sell==='yes'?'yes':'no',sellRate:p.sellRate??d.sellRate,brands:Array.isArray(p.brands)&&p.brands.length?p.brands:[p.brand||d.brand||'GoodWe'],off:Array.isArray(p.off)?p.off:[],backupW:p.backupW??d.backupW,yield:p.yield??d.yield,rec:p.rec||''}}
function proposalTab(j,dis){
  if(!window.ST_PROPOSAL)return `<div class="banner soft"><span>โหลดส่วน Proposal ไม่สำเร็จ ลองรีเฟรชหน้าเว็บ</span></div>`;
  const p=ppIn(j);const D=ST_PROPOSAL.calc(p);
  const num=(k,step,ph)=>`<input class="in num" id="pp-${k}" data-pp="${k}" type="number" step="${step}" min="0" value="${esc(p[k])}"${ph?` placeholder="${esc(ph)}"`:''} ${dis}>`;
  const fld=(id,label,inner,note)=>`<div class="fld"><label for="${id}">${label}</label>${inner}${note?`<span class="note">${note}</span>`:''}</div>`;
  const form=`<div class="form">
    ${fld('pp-phase','มิเตอร์',`<select class="in" id="pp-phase" data-f="phase" ${dis}>${opt([['1','1 เฟส'],['3','3 เฟส']],p.phase)}</select>`)}
    ${fld('pp-brand','ยี่ห้ออินเวอร์เตอร์ (ติ๊กได้หลายยี่ห้อเพื่อเทียบราคา)',`<div class="chkrow">${Object.keys(ST_PROPOSAL.DEFAULTS.inverters1).map(b=>`<label class="chk"><input type="checkbox" id="pp-brand-${b}" data-ppbrand="${b}" ${p.brands.includes(b)?'checked':''} ${dis}><span>${b}</span></label>`).join('')}</div>`,p.brands.map(b=>{const T=ST_PROPOSAL.DEFAULTS[p.phase==='3'?'inverters3':'inverters1'][b];return `${b} ${p.phase==='3'?3:1} เฟส: ${['ongrid','hybrid'].map(t=>`${t==='ongrid'?'On-Grid':'Hybrid'} ${T[t].join(', ')} kW`).join(' · ')}`}).join('<br>'))}
    ${fld('pp-mode','คิดจาก',`<select class="in" id="pp-mode" data-pp="mode" ${dis}>${opt([['bill','ค่าไฟต่อเดือน (บาท)'],['units','จำนวนหน่วยต่อเดือน']],p.mode)}</select>`)}
    ${p.mode==='units'?fld('pp-units','ใช้ไฟต่อเดือน (หน่วย)',num('units','1','เช่น 1,300')):fld('pp-bill','ค่าไฟต่อเดือน (บาท)',num('bill','1','เช่น 6,000'))}
    ${fld('pp-tariff','ค่าไฟเฉลี่ย (บาท/หน่วย)',num('tariff','0.01'))}
    ${fld('pp-dayPct','ใช้ไฟกลางวัน (%)',num('dayPct','1'),`กลางคืน ${Math.max(0,100-(+p.dayPct||0))}%`)}
    ${fld('pp-maxKwp','พื้นที่ติดตั้งได้ประมาณ (kWp)',num('maxKwp','0.01','จากการสำรวจหน้างาน'),'Option ที่ต้องใช้ขนาดเกินนี้จะถูกตัดออก')}
    ${fld('pp-sell','ขายไฟคืนการไฟฟ้า',`<select class="in" id="pp-sell" data-pp="sell" ${dis}>${opt([['no','ไม่ขายไฟ'],['yes','ขายไฟคืน']],p.sell)}</select>`)}
    ${p.sell==='yes'?fld('pp-sellRate','ราคารับซื้อไฟ (บาท/หน่วย)',num('sellRate','0.01'),'ไฟส่วนที่ใช้ไม่หมดขายคืนการไฟฟ้า'):''}
    ${fld('pp-backupW','โหลดในตู้ Backup (W)',num('backupW','10'),'ใช้คำนวณชั่วโมงไฟสำรองตอนไฟดับ')}
    ${fld('pp-yield','ผลิตไฟ (หน่วย/kWp/วัน)',num('yield','0.1'))}
  </div>`;
  if(!D.ok&&!(D.all&&D.all.length))return form+`<div class="banner soft"><span>${esc(D.why)} เพื่อคำนวณ Option</span></div>`;
  const notes=[];
  if(!D.maxKwp)notes.push('ยังไม่ได้กรอกพื้นที่ติดตั้ง ระบบจะเสนอทุก Option');
  if(D.dropped.length&&!D.opts[0].sizedToRoof)notes.push('ตัดออกเพราะเกินพื้นที่: '+D.dropped.map(x=>`${x.name} ${fk2(x.kwp)} kWp`).join(', '));
  if(D.opts[0].sizedToRoof)notes.push(`ทุก Option เกินพื้นที่ จึงเสนอ On-Grid ขนาดเต็มพื้นที่ ${fk2(D.opts[0].kwp)} kWp`);
  D.capped.forEach(c=>notes.push(`${c.name}: ${c.brand} มีอินเวอร์เตอร์ ${D.phase} เฟสใหญ่สุด ${c.inv} kW ใส่แผงได้ไม่เกิน ${fk2(c.kwp)} kWp (${ST_PROPOSAL.DEFAULTS.dcAcMax} เท่า)`));
  const canQ=can('quote.view');
  const rows=D.all.map(o=>`<tr class="${o.on?'':'opt-off'}"><td><label class="chk" title="ใส่ Option นี้ในไฟล์ PowerPoint"><input type="checkbox" data-ppoff="${esc(o.key)}" ${o.on?'checked':''} ${dis} aria-label="เสนอ ${esc(o.name)} ในไฟล์"></label></td><td><b>${esc(o.name)}</b></td><td class="num">${fk2(o.kwp)} kWp<br><small class="muted">${o.pan} แผง</small></td><td class="num">${o.inv} kW${o.dcac>1?`<br><small class="muted">แผง ${o.dcac} เท่า</small>`:''}</td><td class="num">${o.hyb?fmt1(o.batt)+' kWh':'–'}</td><td class="r num">฿${fmt(o.save)}<br><small class="muted">${o.sellMo?`ขายไฟ ฿${fmt(o.sellMo)}`:o.pct+'%'}</small></td><td class="r num">฿${fmt(o.cost)}</td><td class="r num">${o.payback} ปี</td><td>${canQ&&JW()&&!dis?`<button class="btn sm" data-useopt="${esc(o.key)}">ใช้ในใบเสนอราคา</button>`:''}</td></tr>`).join('');
  return `${form}
  <div class="stage-row"><span class="now">ใช้ไฟ ${fmt(D.kwh)} หน่วย/เดือน${p.mode==='units'?` · ค่าไฟราว ฿${fmt(D.bill)}`:''}<small>กลางวัน ${fmt1(D.dD)} หน่วย/วัน · กลางคืน ${fmt1(D.nD)} หน่วย/คืน</small></span></div>
  ${notes.map(n=>`<div class="banner soft"><span>${esc(n)}</span></div>`).join('')}
  <div class="tbl-wrap"><table class="qt"><thead><tr><th title="เสนอในไฟล์">ใส่ในไฟล์</th><th>Option</th><th>ขนาด</th><th>อินเวอร์เตอร์</th><th>แบตเตอรี่</th><th class="r">ประหยัด/เดือน</th><th class="r">ราคารวม VAT</th><th class="r">คืนทุน</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  ${D.ok?'':`<div class="banner soft"><span>${esc(D.why)}</span></div>`}
  <div class="acts">${canDownload()?`<button class="btn pri" data-act="pptx" ${D.ok?'':'disabled'}>ดาวน์โหลด Proposal (.pptx)${D.ok?` · ${D.opts.length} Option`:''}</button>`:''}</div>
  <span class="note">ไฟล์ PowerPoint แก้ไขได้ทุกหน้า มีกรอบให้คลิกใส่รูปหลังคา อุปกรณ์จริง และผลงานที่ผ่านมา · ราคาเป็นราคามาตรฐาน แก้ได้ในไฟล์ proposal.js</span>`;
}
async function proposalPptx(j,btn){const D=ST_PROPOSAL.calc(ppIn(j));if(!D.ok){toast(D.why);return}
  btn.disabled=true;const old=btn.textContent;btn.textContent='กำลังสร้างไฟล์…';
  try{await loadPptx();
    const WHEN={deal:'เมื่ออนุมัติ',install:'เมื่อติดตั้งแล้วเสร็จ',done:'เมื่อ COD'};
    const meta={customer:j.name,addr:[j.addr,j.prov].filter(Boolean).join(' '),date:new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'}),
      terms:appCfg().installments.filter(x=>+x.pct>0).map(x=>({pct:+x.pct,label:x.label,when:WHEN[x.stage]||('เมื่อ'+((STAGES[SIDX[x.stage]]||{}).s||''))})),proposer:{name:pmName(j)||nm(S.me)}};
    const buf=await ST_PROPOSAL.makePptx(window.PptxGenJS,window.JSZip,D,meta,{icons:window.ST_PROPOSAL_ICONS,logo:String(window.SOLARTOUCH_LOGO||'').replace(/^data:/,'')});
    await saveFile(`Proposal-${j.code}.pptx`,buf,'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    saveJob(j.id,{},`สร้าง Proposal (.pptx) ${D.opts.map(o=>`${o.name} ${fk2(o.kwp)} kWp`).join(' / ')}`);
  }catch(e){console.error(e);toast('สร้าง Proposal ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่')}
  finally{if(btn.isConnected){btn.disabled=false;btn.textContent=old}}}
function permitTab(j,dis){const pp=permitProg(j);const p=j.permits||{};const g=j.grid||{};const auth=j.util==='MEA'?'กฟน. (MEA)':'กฟภ. (PEA)';
  return `<div class="sect"><div class="prog"><span class="lbl">เอกสารพร้อม</span><span class="bar"><i style="width:${pp.pct}%"></i></span><span class="num"><b>${pp.d}</b>/${pp.n}</span></div>
  <div class="docs">${DOCS.map(gr=>`<div class="authority">${esc(gr.a)}</div>${gr.items.map(([k,t])=>{const d=p[k]||{};return `<label class="doc ${d.done?'done':''}"><input type="checkbox" id="pd-${k}" data-doc="${k}" ${d.done?'checked':''} ${dis}><span class="t">${esc(t)}</span><span class="who muted">${d.done?esc(nm(d.by)):''}</span>${d.done?`<span class="meta">เรียบร้อย ${tTH(d.at)}</span>`:''}</label>`}).join('')}`).join('')}</div></div>
  <div class="sect"><h3>ติดตามการขอขนานไฟ · ${auth}</h3>
  <div class="form">
    <div class="fld"><label for="g-ref">เลขที่คำร้อง</label><input class="in num" id="g-ref" data-g="ref" value="${esc(g.ref)}" placeholder="เช่น ${j.util==='MEA'?'MEA-':'PEA-'}xxxx" ${dis}></div>
    <div class="fld"><label for="g-submit">วันที่ยื่นคำร้อง</label><input class="in" id="g-submit" data-g="submit" type="date" value="${esc(g.submit)}" ${dis}></div>
    <div class="fld"><label for="g-inspect">วันนัดตรวจระบบ</label><input class="in" id="g-inspect" data-g="inspect" type="date" value="${esc(g.inspect)}" ${dis}></div>
    <div class="fld"><label for="g-meter">วันเปลี่ยนมิเตอร์ / เริ่มขนานไฟ</label><input class="in" id="g-meter" data-g="meter" type="date" value="${esc(g.meter)}" ${dis}></div>
  </div>
  <p class="note" style="margin:0">วันที่ในส่วนนี้แสดงในปฏิทินงานอัตโนมัติ · รายการเอกสารเป็นชุดมาตรฐานของงานโซลาร์บ้าน ตรวจสอบประกาศล่าสุดของ ${auth} และ กกพ. ก่อนยื่น</p></div>`;
}
function apptForm(prefix,j){const d=S.view==='cal'&&S.calSel?S.calSel:ymd(new Date());
  const jobs=[...S.jobs].filter(([id,x])=>x.stage!=='done'&&canEditJob(x)).sort((a,b)=>a[1].name.localeCompare(b[1].name,'th'));
  return `<form class="apptf" id="${prefix}"><div class="form">
    ${j?'':`<div class="fld full"><label for="${prefix}-job">งาน</label><select class="in" id="${prefix}-job" name="job" required>${jobs.map(([id,x])=>`<option value="${esc(id)}" ${id===S.open?'selected':''}>${esc(x.name)} · ${esc(x.code)}</option>`).join('')}</select></div>`}
    <div class="fld"><label for="${prefix}-type">ประเภท</label><select class="in" id="${prefix}-type" name="type">${Object.entries(APPT).map(([k,[t]])=>`<option value="${k}">${t}</option>`).join('')}</select></div>
    <div class="fld"><label for="${prefix}-who">ผู้รับผิดชอบนัด</label><select class="in" id="${prefix}-who" name="who">${teamOpts((j&&j.pm)||S.me,false)}</select></div>
    <div class="fld"><label for="${prefix}-date">วันที่</label><input class="in" id="${prefix}-date" name="date" type="date" value="${d}" required></div>
    <div class="fld"><label for="${prefix}-time">เวลา</label><input class="in" id="${prefix}-time" name="time" type="time" value="09:00"></div>
    <div class="fld full"><label for="${prefix}-note">รายละเอียด</label><input class="in" id="${prefix}-note" name="note" placeholder="เช่น ทีมช่าง 3 คน นำบันไดยาว"></div>
  </div><div class="acts" style="justify-content:flex-end"><button class="btn pri" type="submit">บันทึกนัดหมาย</button></div></form>`}
function apptTab(j){const today=ymd(new Date());const L=[...(j.appts||[])].sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));const g=j.grid||{};
  return `<div class="sect"><h3>นัดหมายของงานนี้</h3>
    ${L.length?`<div class="list">${L.map(a=>{const [t,c]=APPT[a.type]||APPT.other;return `<div class="li ev ${a.date<today?'past':''}"><span class="evbar" style="background:${c}"></span><span style="min-width:0"><b>${esc(t)}</b><span class="sub"><span>${dLong(a.date)}</span>${a.time?`<span class="num">${esc(a.time)} น.</span>`:''}${a.who?`<span>${esc(nm(a.who))}</span>`:''}${a.note?`<span class="muted">${esc(a.note)}</span>`:''}</span></span>${JW()?`<button class="rm" data-rmappt="${esc(a.id)}" aria-label="ลบนัด">✕</button>`:''}</div>`}).join('')}</div>`:'<p class="muted" style="margin:0">ยังไม่มีนัดหมาย</p>'}
    ${(g.submit||g.inspect||g.meter)?`<p class="note" style="margin:0">วันจากการไฟฟ้า: ${[g.submit&&'ยื่นคำร้อง '+dTH(parseYmd(g.submit)),g.inspect&&'นัดตรวจ '+dTH(parseYmd(g.inspect)),g.meter&&'เปลี่ยนมิเตอร์ '+dTH(parseYmd(g.meter))].filter(Boolean).join(' · ')} (แก้ไขในแท็บขออนุญาต)</p>`:''}
  </div>
  ${JW()?`<div class="sect"><h3>เพิ่มนัดหมาย</h3>${apptForm('apd',j)}</div>`:''}`}
function photoTab(j,dis){
  const by={};S.photos.forEach(p=>(by[p.cat]=by[p.cat]||[]).push(p));const ready=PHOTO_CATS.filter(([k])=>(by[k]||[]).length).length;
  const pdfOk=S.photos.length&&(BK.kind!=='artifact'||dl);
  return `<div class="stage-row"><span class="now">รูปถ่ายงานติดตั้ง<small>มีรูปแล้ว ${ready}/${PHOTO_CATS.length} หมวด · ${S.photos.length} รูป</small></span>
    <button class="btn pri" data-act="pdf" ${pdfOk?'':'disabled'}>สร้าง PDF รายงานรูปถ่าย</button></div>
  ${!S.photosLoaded?'<p class="muted" style="margin:0">กำลังโหลดรูป…</p>':''}
  <div class="pcats">${PHOTO_CATS.map(([k,t],n)=>{const ps=by[k]||[];return `<section class="pcat ${ps.length?'ok':''}"><div class="pch"><span class="pno num">${n+1}</span><h3>${esc(t)}</h3><span class="count">${ps.length}</span></div>
    <div class="pgrid">${ps.map(p=>`<button class="ph" data-photo="${esc(p.id)}"><img src="${p.data}" alt="${esc(p.cap||t)}" loading="lazy">${p.cap?`<span>${esc(p.cap)}</span>`:''}</button>`).join('')}
    ${JW()?`<label class="phadd"><input type="file" accept="image/*" multiple data-upload="${k}" ${dis}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>เพิ่มรูป</span></label>`:''}</div></section>`}).join('')}</div>
  <p class="note" style="margin:0">รูปถูกย่อขนาดอัตโนมัติก่อนบันทึก บนมือถือกด “เพิ่มรูป” แล้วเลือกถ่ายจากกล้องได้ทันที · แตะรูปเพื่อใส่คำบรรยาย ย้ายหมวด หรือลบ</p>`}
function logTab(j){const L=[...(j.log||[])].reverse();return `<div class="log">${L.map(e=>`<div class="e">${av(e.by,'sm')}<span><b>${esc(nm(e.by))}</b> ${esc(e.m)}<small>${tTH(e.t)}</small></span></div>`).join('')||'<p class="muted">ยังไม่มีประวัติ</p>'}</div>`}

/* ---------- lightbox ---------- */
function renderLightbox(){const m=$('#lightbox');if(!S.lb){m.hidden=true;m.innerHTML='';return}
  const p=S.photos.find(x=>x.id===S.lb);if(!p){S.lb=null;m.hidden=true;m.innerHTML='';return}
  if(m.contains(document.activeElement)&&/INPUT|SELECT/.test(document.activeElement.tagName)&&m.dataset.pid===p.id)return;
  m.dataset.pid=p.id;m.hidden=false;
  m.innerHTML=`<div class="lbbox" role="dialog" aria-label="รูปถ่าย"><img src="${p.data}" alt=""><div class="lbbar"><span class="lbl">${esc(PCAT[p.cat]||'')}</span>
    <input class="in" id="lb-cap" data-cap="${esc(p.id)}" value="${esc(p.cap||'')}" placeholder="คำบรรยายใต้รูป (แสดงใน PDF)" ${JW()?'':'disabled'}>
    <span class="muted" style="font-size:12.5px">${esc(nm(p.by))} · ${tTH(p.at)}</span>
    <div class="acts">${JW()?`<select class="in sel-sm" id="lb-cat" data-movecat="${esc(p.id)}" aria-label="ย้ายหมวด">${PHOTO_CATS.map(([k,t])=>`<option value="${k}" ${k===p.cat?'selected':''}>${esc(t)}</option>`).join('')}</select><button class="btn sm danger" data-delphoto="${esc(p.id)}">ลบรูป</button>`:''}<button class="btn sm" data-act="lbclose">ปิด</button></div></div></div>`}

/* ---------- images ---------- */
function loadImg(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src})}
async function compress(file){
  const url=URL.createObjectURL(file);let img;try{img=await loadImg(url)}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}
  const LIMIT=BK.kind==='artifact'?225000:600000;let max=1600,q=.82,out='',w=0,h=0;
  for(let tries=0;tries<12;tries++){const s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));w=Math.round(img.naturalWidth*s);h=Math.round(img.naturalHeight*s);
    const c=document.createElement('canvas');c.width=w;c.height=h;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(img,0,0,w,h);
    out=c.toDataURL('image/jpeg',q);if(out.length<=LIMIT)break;if(q>.5)q-=.12;else{max=Math.round(max*.8);q=.7}}
  return{data:out,w,h}}
async function uploadPhotos(files,cat){const id=S.open;if(!id||!files.length)return;let ok=0;
  toast(`กำลังอัปโหลด ${files.length} รูป…`);
  for(const f of files){try{const c=await compress(f);await BK.put('photos',rid('p'),{job:id,cat,data:c.data,w:c.w,h:c.h,cap:'',at:Date.now(),by:S.me});ok++}catch(e){writeErr(e)}}
  if(ok){saveJob(id,{},`เพิ่มรูป “${PCAT[cat]}” ${ok} รูป`);toast(`บันทึกรูปแล้ว ${ok} รูป`)}}

/* ---------- PDF: A4 pages drawn on canvas (Thai renders with the page's fonts), packed by jsPDF ---------- */
async function photoPDF(j){
  const jsPDF=window.jspdf&&window.jspdf.jsPDF;if(!jsPDF){toast('โหลดตัวสร้าง PDF ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ต');return}
  if(!S.photos.length){toast('ยังไม่มีรูป');return}
  toast('กำลังสร้าง PDF…');
  try{await Promise.all([document.fonts.load('700 30px "IBM Plex Sans Thai"'),document.fonts.load('600 30px "IBM Plex Sans Thai"'),document.fonts.load('400 22px "IBM Plex Sans Thai"')])}catch{}
  const FF='"IBM Plex Sans Thai","Noto Sans Thai","Leelawadee UI",Tahoma,sans-serif';
  const W=1240,H=1754,M=72,FOOT=70;const pages=[];let cv,cx,y;let logoImg=null;try{logoImg=await loadImg(LOGO)}catch{}
  const wrap=(t,maxW,font)=>{cx.font=font;const out=[];let line='';for(const ch of String(t)){const tt=line+ch;if(cx.measureText(tt).width>maxW&&line){out.push(line);line=ch.trimStart()}else line=tt}if(line)out.push(line);return out};
  const SC=1.6;const newPage=()=>{cv=document.createElement('canvas');cv.width=Math.round(W*SC);cv.height=Math.round(H*SC);cx=cv.getContext('2d');cx.setTransform(SC,0,0,SC,0,0);cx.imageSmoothingQuality='high';pages.push(cv);
    cx.fillStyle='#fff';cx.fillRect(0,0,W,H);
    if(logoImg){const lh=78,lw=logoImg.naturalWidth*lh/logoImg.naturalHeight;cx.drawImage(logoImg,M,18,lw,lh)}
    cx.textBaseline='middle';cx.textAlign='right';cx.fillStyle='#0A2350';cx.font=`700 26px ${FF}`;cx.fillText('รายงานภาพถ่ายงานติดตั้ง',W-M,36);
    cx.fillStyle='#46546F';cx.font=`600 21px ${FF}`;cx.fillText(j.code,W-M,68);cx.font=`400 18px ${FF}`;cx.fillText(wrap(j.name,460,`400 18px ${FF}`)[0],W-M,94);cx.textAlign='left';
    cx.fillStyle='#F0661A';cx.fillRect(M,116,W-2*M,5);cx.fillStyle='#0A2350';cx.fillRect(M,121,W-2*M,2);cx.textBaseline='alphabetic';y=170};
  const footer=(n,N)=>{cx.textBaseline='middle';cx.font=`400 17px ${FF}`;cx.fillStyle='#7783A0';cx.fillText(`${j.name} · ${j.code}`,M,H-40);cx.textAlign='right';cx.fillText(`หน้า ${n}/${N}`,W-M,H-40);cx.textAlign='left';cx.strokeStyle='#D9E1EF';cx.lineWidth=2;cx.beginPath();cx.moveTo(M,H-70);cx.lineTo(W-M,H-70);cx.stroke()};
  newPage();
  cx.fillStyle='#0D1A33';cx.font=`700 30px ${FF}`;cx.fillText('ข้อมูลโครงการ',M,y+16);y+=40;
  const info=[['ลูกค้า',j.name],['ที่อยู่ติดตั้ง',[j.addr,j.prov].filter(Boolean).join(' ')||'–'],['ขนาดระบบ',`${fmt1(j.kw)} kWp ${j.type==='hybrid'?'Hybrid + แบตเตอรี่':'On-Grid'} · มิเตอร์ ${j.phase==='3'?'3':'1'} เฟส`],['การไฟฟ้า',`${j.util==='MEA'?'การไฟฟ้านครหลวง (กฟน.)':'การไฟฟ้าส่วนภูมิภาค (กฟภ.)'}${j.grid&&j.grid.ref?' · คำร้อง '+j.grid.ref:''}`],['ผู้ดูแลโครงการ',pmName(j)||'–'],['พิกัด',hasLoc(j)?`${j.lat}, ${j.lng}`:'–'],['วันที่จัดทำ',new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'})]];
  cx.fillStyle='#F2F5FB';const ih=info.length*44+24;cx.fillRect(M,y,W-2*M,ih);let iy=y+42;
  info.forEach(([k,v])=>{cx.font=`600 21px ${FF}`;cx.fillStyle='#46546F';cx.fillText(k,M+24,iy);cx.fillStyle='#0D1A33';cx.fillText(wrap(v,W-2*M-280,`400 21px ${FF}`)[0],M+250,iy);iy+=44});y+=ih+50;
  const by={};S.photos.forEach(p=>(by[p.cat]=by[p.cat]||[]).push(p));
  cx.font=`700 24px ${FF}`;cx.fillStyle='#0A2350';cx.fillText('รายการภาพถ่าย',M,y);y+=12;
  PHOTO_CATS.forEach(([k,t],n)=>{const c=(by[k]||[]).length;y+=42;cx.fillStyle=c?'#11905A':'#C42F2A';cx.beginPath();cx.arc(M+14,y-8,12,0,Math.PI*2);cx.fill();cx.fillStyle='#fff';cx.font=`700 16px ${FF}`;cx.textAlign='center';cx.fillText(c?'✓':'!',M+14,y-2);cx.textAlign='left';
    cx.fillStyle='#0D1A33';cx.font=`400 21px ${FF}`;cx.fillText(`${n+1}. ${t}`,M+40,y);cx.textAlign='right';cx.fillStyle=c?'#46546F':'#C42F2A';cx.fillText(c?`${c} รูป`:'ยังไม่มีรูป',W-M,y);cx.textAlign='left'});
  y+=50;
  // photos: one per row, centred, as large as the page allows (two per A4 page)
  // photos centred and as large as possible: landscape two per page, portrait one per page
  const CW=W-2*M,CAPH=66,BOTTOM=H-FOOT-16;
  const imgs={};await Promise.all(S.photos.map(async p=>{try{imgs[p.id]=await loadImg(p.data)}catch{}}));
  const title=(t,n,cont)=>{cx.fillStyle='#0A2350';cx.fillRect(M,y,W-2*M,52);cx.fillStyle='#F0661A';cx.fillRect(M,y,10,52);cx.fillStyle='#fff';cx.font=`600 23px ${FF}`;cx.textBaseline='middle';cx.fillText(`${n}. ${t}${cont?' (ต่อ)':''}`,M+28,y+27);cx.textBaseline='alphabetic';y+=70};
  const dims=im=>{if(!im)return{dw:CW*.7,dh:620};const portrait=im.naturalHeight>im.naturalWidth*1.05;const maxH=portrait?1330:600;const s=Math.min(CW/im.naturalWidth,maxH/im.naturalHeight);return{dw:im.naturalWidth*s,dh:im.naturalHeight*s}};
  newPage();
  PHOTO_CATS.forEach(([k,t],n)=>{const ps=by[k]||[];if(!ps.length)return;
    const d0=dims(imgs[ps[0].id]);if(y+70+d0.dh+CAPH>BOTTOM)newPage();title(t,n+1,false);
    ps.forEach((p,i)=>{const im=imgs[p.id];const {dw,dh}=dims(im);
      if(y+dh+CAPH>BOTTOM){newPage();title(t,n+1,true)}
      const x=(W-dw)/2,iy=y;
      if(im){cx.save();cx.shadowColor='rgba(10,35,80,.18)';cx.shadowBlur=14;cx.shadowOffsetY=4;cx.fillStyle='#fff';cx.fillRect(x,iy,dw,dh);cx.restore();cx.drawImage(im,x,iy,dw,dh)}
      else{cx.fillStyle='#EBF0F9';cx.fillRect(x,iy,dw,dh)}
      cx.strokeStyle='#D9E1EF';cx.lineWidth=1.5;cx.strokeRect(x,iy,dw,dh);
      cx.fillStyle='#0D1A33';cx.textAlign='center';const cap=`รูปที่ ${n+1}.${i+1}  ${p.cap||t}`;
      wrap(cap,CW,`500 21px ${FF}`).slice(0,2).forEach((ln,li)=>{cx.font=`500 21px ${FF}`;cx.fillText(ln,W/2,iy+dh+32+li*25)});cx.textAlign='left';
      y+=dh+CAPH});
    y+=10});
  pages.forEach((p,i)=>{cv=p;cx=p.getContext('2d');footer(i+1,pages.length)});
  const pdf=new jsPDF({unit:'pt',format:'a4',compress:true});
  pages.forEach((p,i)=>{if(i)pdf.addPage();pdf.addImage(p.toDataURL('image/jpeg',.9),'JPEG',0,0,595.28,841.89,undefined,'FAST')});
  const name=`รูปถ่ายงานติดตั้ง-${j.code}.pdf`;
  if(BK.kind==='artifact'){try{await dl.save({filename:name,data:pdf.output('arraybuffer')})}catch(e){if(!e||e.code!=='declined')toast('บันทึก PDF ไม่สำเร็จ')}}
  else{pdf.save(name);toast(`สร้าง PDF แล้ว ${pages.length} หน้า`)}
  window.__lastPdfPages=pages.length;
  saveJob(j.id,{},'สร้าง PDF รายงานรูปถ่าย');
}

/* ---------- quote export ---------- */
function quoteDoc(j,autoPrint){const t=quoteTotals(j);const e=estimate(j);const today=new Date().toLocaleDateString('th-TH',{day:'numeric',month:'long',year:'numeric'});
  const rows=(j.quote?.items||[]).map((it,k)=>`<tr><td>${k+1}</td><td>${esc(it.d)}</td><td class="r">${fmt1(it.q)}</td><td>${esc(it.u)}</td><td class="r">${fmt(it.p)}</td><td class="r">${fmt((+it.q||0)*(+it.p||0))}</td></tr>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ใบเสนอราคา ${esc(j.code)}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;600;700&display=swap"><style>
  body{font-family:"IBM Plex Sans Thai","Sarabun","Leelawadee UI",sans-serif;color:#0D1A33;max-width:820px;margin:32px auto;padding:0 24px;font-size:14px}
  .hd{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:4px solid #F0661A;padding-bottom:12px;gap:16px}
  .hd h1{margin:0;color:#0A2350;letter-spacing:.04em}.hd h2{margin:0;font-size:20px;color:#F0661A}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}.meta div{background:#F2F5FB;padding:12px;border-radius:8px}
  table{width:100%;border-collapse:collapse}th{background:#0A2350;color:#fff;text-align:left;padding:8px;font-weight:600}td{padding:8px;border-bottom:1px solid #D9E1EF}.r{text-align:right}
  .tot{margin-left:auto;width:320px;max-width:100%;margin-top:12px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .g{border-top:2px solid #0A2350;font-weight:700;font-size:17px;color:#F0661A;padding-top:8px}
  .note{font-size:12.5px;color:#46546F;margin-top:24px;line-height:1.7}.sign{display:flex;justify-content:space-between;margin-top:56px;text-align:center}.sign div{width:42%;border-top:1px solid #7783A0;padding-top:6px}
  @media print{body{margin:0}th,.meta div{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style></head><body>
  <div class="hd"><div><img src="${LOGO}" alt="SOLAR TOUCH" style="height:64px;width:auto;display:block"><div style="margin-top:4px">ระบบผลิตไฟฟ้าพลังงานแสงอาทิตย์บนหลังคา</div></div><div style="text-align:right"><h2>ใบเสนอราคา</h2><div>เลขที่ ${esc(j.code)}</div><div>วันที่ ${today}</div></div></div>
  <div class="meta"><div><b>ลูกค้า</b><br>${esc(j.name)}<br>${esc(j.addr)} ${esc(j.prov)}<br>โทร ${esc(j.phone)}${j.email?`<br>อีเมล ${esc(j.email)}`:''}</div><div><b>ระบบที่เสนอ</b><br>${fmt1(j.kw)} kWp ${j.type==='hybrid'?'Hybrid + แบตเตอรี่':'On-Grid'}<br>มิเตอร์ ${j.phase==='3'?'3':'1'} เฟส · ${j.util==='MEA'?'การไฟฟ้านครหลวง':'การไฟฟ้าส่วนภูมิภาค'}<br>หลังคา ${esc(j.roof||'')}${pmName(j)?`<br>ผู้ดูแลโครงการ ${esc(pmName(j))}`:''}</div></div>
  <table><thead><tr><th>#</th><th>รายการ</th><th class="r">จำนวน</th><th>หน่วย</th><th class="r">ราคา/หน่วย</th><th class="r">จำนวนเงิน</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="tot"><div><span>รวมเป็นเงิน</span><span>${fmt(t.sub)}</span></div>${t.disc?`<div><span>ส่วนลด</span><span>-${fmt(t.disc)}</span></div>`:''}<div><span>ภาษีมูลค่าเพิ่ม 7%</span><span>${fmt(t.vat)}</span></div><div class="g"><span>รวมทั้งสิ้น</span><span>${fmt(t.total)} บาท</span></div></div>
  <div class="note"><b>ประมาณการ:</b> ผลิตไฟราว ${fmt(e.month)} หน่วย/เดือน ประหยัดค่าไฟราว ${fmt(e.monthSave)} บาท/เดือน คืนทุนประมาณ ${e.payback?e.payback.toFixed(1):'–'} ปี (ค่าไฟ ${e.tariff} บาท/หน่วย)<br>
  <b>เงื่อนไข:</b> ราคารวมการออกแบบ วิศวกรรับรอง และดำเนินการขออนุญาตท้องถิ่น แจ้ง กกพ. และยื่นขนานไฟกับการไฟฟ้า · ชำระมัดจำ 50% เมื่ออนุมัติ 40% เมื่อติดตั้งเสร็จ 10% เมื่อการไฟฟ้าเปลี่ยนมิเตอร์ · ใบเสนอราคามีอายุ 30 วัน</div>
  <div class="sign"><div>ผู้เสนอราคา</div><div>ลูกค้าผู้อนุมัติ</div></div>${autoPrint?'<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script>':''}</body></html>`}
function quoteText(j){const t=quoteTotals(j);const e=estimate(j);return `ใบเสนอราคา SOLARTOUCH ${j.code}
ลูกค้า: ${j.name}${j.email?' ('+j.email+')':''}
ระบบ: ${fmt1(j.kw)} kWp ${j.type==='hybrid'?'Hybrid':'On-Grid'} ${j.phase==='3'?'3':'1'} เฟส
${(j.quote?.items||[]).map((it,k)=>`${k+1}. ${it.d} × ${fmt1(it.q)} ${it.u} = ${fmt((+it.q||0)*(+it.p||0))}`).join('\n')}
รวมทั้งสิ้น (รวม VAT 7%): ${fmt(t.total)} บาท
ผลิตไฟราว ${fmt(e.month)} หน่วย/เดือน · ประหยัดราว ${fmt(e.monthSave)} บาท/เดือน · คืนทุนราว ${e.payback?e.payback.toFixed(1):'–'} ปี`}
const canDownload=()=>!!BK&&(BK.kind!=='artifact'||!!dl);
async function saveFile(name,data,type){
  if(BK.kind==='artifact'){try{await dl.save({filename:name,data})}catch(e){if(!e||e.code!=='declined')toast('บันทึกไฟล์ไม่สำเร็จ')}return}
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
function printQuote(j){const url=URL.createObjectURL(new Blob([quoteDoc(j,true)],{type:'text/html'}));const w=window.open(url,'_blank');if(!w){saveFile(`ใบเสนอราคา-${j.code}.html`,quoteDoc(j,false),'text/html');toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ จึงดาวน์โหลดไฟล์ให้แทน')}setTimeout(()=>URL.revokeObjectURL(url),60000)}
function csv(){const rows=[['รหัสงาน','กลุ่มลูกค้า','ลูกค้า','โทร','อีเมล','จังหวัด','การไฟฟ้า','kWp','ขั้นตอน','ผู้ดูแลโครงการ','เอกสาร','หมวดรูป','มูลค่ารวม VAT','ละติจูด','ลองจิจูด','อัปเดตล่าสุด']];visibleJobs().forEach(j=>{const pp=permitProg(j),ph=photoProg(j);rows.push([j.code,grpOf(j)?`${GRP[grpOf(j)][0]} ${GRP[grpOf(j)][1]}`:'',j.name,j.phone,j.email||'',j.prov,j.util,j.kw,STAGES[SIDX[j.stage]].t,pmName(j),`${pp.d}/${pp.n}`,`${ph.d}/${ph.n}`,Math.round(quoteTotals(j).total),hasLoc(j)?j.lat:'',hasLoc(j)?j.lng:'',new Date(j.updatedAt).toISOString()])});return '﻿'+rows.map(r=>r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n')}
async function copy(txt,okMsg){try{await navigator.clipboard.writeText(txt);toast(okMsg)}catch{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast(okMsg)}catch{toast('คัดลอกไม่สำเร็จ')}ta.remove()}}

/* ---------- modals ---------- */
function modal(title,inner){const m=$('#modal');m.hidden=false;$('#scrim').hidden=false;
  m.innerHTML=`<div class="box" role="dialog" aria-label="${esc(title)}"><div class="mh"><h2>${esc(title)}</h2><button class="x" data-act="mclose" aria-label="ปิด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>${inner}</div>`}
function openNew(){if(!S.canWrite)return;
  modal('งานติดตั้งใหม่',`<form id="nf"><div class="form">
    <div class="fld full"><label>กลุ่มลูกค้า</label><div class="seg grpseg"><label><input type="radio" name="grp" value="special"><span class="g-special">กลุ่ม 1 · SPECIAL</span></label><label><input type="radio" name="grp" value="normal" checked><span class="g-normal">กลุ่ม 2 · Normal</span></label></div></div>
    <div class="fld full"><label for="n-name">ชื่อลูกค้า</label><input class="in" id="n-name" name="name" required placeholder="คุณ…"></div>
    <div class="fld"><label for="n-phone">เบอร์โทร</label><input class="in" id="n-phone" name="phone" type="tel" placeholder="08x-xxx-xxxx"></div>
    <div class="fld"><label for="n-email">อีเมล</label><input class="in" id="n-email" name="email" type="email" placeholder="name@example.com" autocomplete="off"></div>
    <div class="fld"><label for="n-prov">จังหวัด</label><input class="in" id="n-prov" name="prov" placeholder="เช่น นนทบุรี"></div>
    <div class="fld full"><label for="n-addr">ที่อยู่ติดตั้ง</label><input class="in" id="n-addr" name="addr"></div>
    <div class="fld full"><label for="n-loc">ตำแหน่ง Google Maps (ถ้ามี)</label><input class="in" id="n-loc" name="loc" placeholder="วางลิงก์ Google Maps หรือพิกัด เช่น 13.7563, 100.5018"></div>
    <div class="fld"><label>การไฟฟ้า</label><div class="seg"><label><input type="radio" name="util" value="PEA" checked><span>กฟภ.</span></label><label><input type="radio" name="util" value="MEA"><span>กฟน.</span></label></div></div>
    <div class="fld"><label>มิเตอร์</label><div class="seg"><label><input type="radio" name="phase" value="1" checked><span>1 เฟส</span></label><label><input type="radio" name="phase" value="3"><span>3 เฟส</span></label></div></div>
    <div class="fld"><label>ประเภทระบบ</label><div class="seg"><label><input type="radio" name="type" value="ongrid" checked><span>On-Grid</span></label><label><input type="radio" name="type" value="hybrid"><span>Hybrid</span></label></div></div>
    <div class="fld"><label for="n-kw">ขนาดระบบ (kWp)</label><input class="in num" id="n-kw" name="kw" type="number" step="0.01" min="0.5" value="5" required></div>
    <div class="fld full"><label for="n-pm">ผู้ดูแลโครงการ</label><select class="in" id="n-pm" name="pm" ${can('jobs.edit')?'':'disabled'}>${teamOpts(can('jobs.edit')?'':S.me,true)}</select>${can('jobs.edit')?'':'<span class="note">คุณจะเป็นผู้ดูแลโครงการของงานที่สร้าง</span>'}</div>
    <div class="fld full" id="n-pmname-w" hidden><label for="n-pmname">ชื่อผู้ดูแลโครงการ</label><input class="in" id="n-pmname" name="pmName"></div>
  </div>
  <p class="note" style="margin:0">ระบบจะสร้างรายการใบเสนอราคาเริ่มต้นจากขนาดระบบให้อัตโนมัติ แก้ไขได้ภายหลัง</p>
  <div class="acts" style="justify-content:flex-end"><button type="button" class="btn" data-act="mclose">ยกเลิก</button><button class="btn pri" type="submit">สร้างงาน</button></div></form>`);
  $('#n-name').focus();
  $('#n-pm').addEventListener('change',e=>$('#n-pmname-w').hidden=e.target.value!=='_other');
  $('#nf').addEventListener('submit',async ev=>{ev.preventDefault();const f=Object.fromEntries(new FormData(ev.target));if(f.loc&&!parseLoc(f.loc))toast('บันทึกลิงก์ไว้แล้ว แต่อ่านพิกัดจากลิงก์ย่อไม่ได้ ใส่พิกัดตัวเลขในหน้าข้อมูลงานเพื่อแสดงบนแผนที่');
    if(!can('jobs.edit')){f.pm=S.me;f.pmName=''}
    const id=rid('j');const j=makeJob(f);closeModal();await createJob(id,j);if(S.view==='dash'||S.view==='team')S.view='board';render();openDrawer(id,'quote');toast('สร้างงาน '+j.code+' แล้ว')});
}
function openApptModal(){if(!S.canWrite)return;modal('เพิ่มนัดหมาย',`<div style="padding:20px">${apptForm('apm',null)}</div>`)}
function closeModal(){$('#modal').hidden=true;$('#modal').innerHTML='';if(!S.open)$('#scrim').hidden=true}
function addAppt(jobId,f){const j=S.jobs.get(jobId);if(!j||!f.date)return;const a={id:rid('a'),date:f.date,time:f.time||'',type:f.type||'other',who:f.who||null,note:f.note||''};
  saveJob(jobId,{appts:[...(j.appts||[]),a]},`เพิ่มนัด${(APPT[a.type]||APPT.other)[0]} ${dTH(parseYmd(a.date))}${a.time?' '+a.time:''}`);toast('บันทึกนัดหมายแล้ว')}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-view],[data-act],[data-open],[data-stage],[data-tab],[data-filter],[data-stagejump],[data-rm],[data-rmmember],[data-cal],[data-day],[data-mapstage],[data-focus],[data-photo],[data-delphoto],[data-rmappt],[data-pmjump],[data-payf],[data-preview],[data-bpay],[data-bunpay],[data-rmins],[data-rmtier],[data-clrpay],[data-btab],[data-rmcrew],[data-cpay],[data-cunpay],[data-rmctier],[data-rmroster],[data-copy],[data-useopt]');if(!t)return;
  if(t.matches('[data-copy]')){copy(t.dataset.copy,'คัดลอกอีเมลแล้ว');return}
  if(t.matches('[data-useopt]')){const id=S.open,j=S.jobs.get(id);if(!j||!window.ST_PROPOSAL)return;const o=(ST_PROPOSAL.calc(ppIn(j)).all||[]).find(x=>x.key===t.dataset.useopt);if(!o)return;
    const go=()=>saveJob(id,{kw:o.kwp,type:o.hyb?'hybrid':'ongrid',inv:o.inv,quote:{items:o.items.map(x=>({...x}))},proposal:{rec:o.name}},`ใช้ ${o.name} ${fk2(o.kwp)} kWp จาก Proposal ในใบเสนอราคา`).then(()=>{S.tab='quote';renderDrawer(true);toast('สร้างรายการใบเสนอราคาจาก Proposal แล้ว')});
    (j.quote?.items||[]).length?arm(t,'แทนที่รายการเดิม? กดอีกครั้ง',go):go();return}
  if(t.matches('[data-btab]')){S.bTab=t.dataset.btab;renderView();return}
  if(t.matches('[data-rmcrew]')){const j=S.jobs.get(S.open);const c=[...(j.crew||[])];c.splice(+t.dataset.rmcrew,1);saveCrew(S.open,c);return}
  if(t.dataset.cpay){const j=S.jobs.get(t.dataset.cpay);const c=crewBonusOf({id:t.dataset.cpay,...j});saveBonus(t.dataset.cpay,{crewPaid:true,crewPaidAt:Date.now(),crewPaidBy:S.me,crewAmt:c.total,crewList:c.people.map(p=>({name:p.name,pos:p.pos,amt:p.amt}))}).then(()=>toast(`บันทึกจ่ายโบนัสทีมช่าง ฿${fmt(c.total)} แล้ว`));return}
  if(t.dataset.cunpay){const id=t.dataset.cunpay;arm(t,'ยืนยัน?',()=>saveBonus(id,{crewPaid:false,crewPaidAt:null,crewPaidBy:null,crewAmt:null,crewList:null}));return}
  if(t.matches('[data-rmctier]')){saveCrewTiers(crewTiers().filter((_,i)=>i!==+t.dataset.rmctier));return}
  if(t.matches('[data-rmroster]')){saveRoster(crewRoster().filter((_,i)=>i!==+t.dataset.rmroster));return}
  if(t.matches('[data-payf]')){S.payFilter=t.dataset.payf;renderView();return}
  if(t.matches('[data-preview]')){S.previewRole=t.dataset.preview;closeModal();render();return}
  if(t.dataset.bpay){const j=S.jobs.get(t.dataset.bpay);const b=bonusOf({id:t.dataset.bpay,...j});saveBonus(t.dataset.bpay,{paid:true,paidAt:Date.now(),paidBy:S.me,amt:b.amt,to:j.pm||null}).then(()=>toast(`บันทึกจ่ายโบนัส ฿${fmt(b.amt)} แล้ว`));return}
  if(t.dataset.bunpay){const id=t.dataset.bunpay;arm(t,'ยืนยัน?',()=>saveBonus(id,{paid:false,paidAt:null,paidBy:null,amt:null}));return}
  if(t.dataset.rmins!=null&&t.matches('[data-rmins]')){const ins=appCfg().installments.filter((_,i)=>i!==+t.dataset.rmins);upsert('settings','app',{installments:ins,sv:2},S.settings).catch(writeErr);return}
  if(t.dataset.rmtier!=null&&t.matches('[data-rmtier]')){saveTiers(appCfg().tiers.filter((_,i)=>i!==+t.dataset.rmtier));return}
  if(t.dataset.clrpay){const k=t.dataset.clrpay,id=S.open;arm(t,'ยืนยันยกเลิก?',()=>{BK.patch('finance',id,{rec:{[k]:null}}).catch(writeErr);saveJob(id,{},'ยกเลิกรายการรับชำระ')});return}
  if(t.dataset.view){S.view=t.dataset.view;closeDrawer();closeModal();beat();render();window.scrollTo(0,0);return}
  if(t.dataset.stagejump){S.view='list';S.stageFilter=t.dataset.stagejump;render();return}
  if(t.dataset.pmjump){S.view='board';S.pmFilter=t.dataset.pmjump;render();return}
  if(t.matches('[data-filter]')){S.stageFilter=t.dataset.filter;renderView();return}
  if(t.matches('[data-mapstage]')){S.mapStage=t.dataset.mapstage;S.mapFitted=false;renderView();return}
  if(t.dataset.focus){const mk=S.lmById&&S.lmById[t.dataset.focus];if(mk&&S.lmap){S.lmap.setView(mk.getLatLng(),17);mk.openPopup()}return}
  if(t.matches('[data-cal]')){const v=+t.dataset.cal;const n=new Date();S.cal=v?new Date(S.cal.getFullYear(),S.cal.getMonth()+v,1):new Date(n.getFullYear(),n.getMonth(),1);if(!v)S.calSel=ymd(n);renderView();return}
  if(t.dataset.day){S.calSel=t.dataset.day;const d=parseYmd(t.dataset.day);if(d.getMonth()!==S.cal.getMonth())S.cal=new Date(d.getFullYear(),d.getMonth(),1);renderView();if(innerWidth<900){const p=document.querySelector('.dayp');p&&p.scrollIntoView({behavior:'smooth',block:'start'})}return}
  if(t.dataset.photo){S.lb=t.dataset.photo;renderLightbox();return}
  if(t.dataset.delphoto){const pid=t.dataset.delphoto;arm(t,'ยืนยันลบรูป',()=>{const p=S.photos.find(x=>x.id===pid);BK.remove('photos',pid).then(()=>{S.lb=null;renderLightbox();if(p)saveJob(S.open,{},`ลบรูป “${PCAT[p.cat]}” 1 รูป`)}).catch(writeErr)});return}
  if(t.dataset.rmappt){const id=t.dataset.rmappt;arm(t,'ลบ?',()=>{const j=S.jobs.get(S.open);const a=(j.appts||[]).find(x=>x.id===id);saveJob(S.open,{appts:(j.appts||[]).filter(x=>x.id!==id)},a?`ลบนัด${(APPT[a.type]||APPT.other)[0]} ${dTH(parseYmd(a.date))}`:null)});return}
  if(t.dataset.open&&!t.closest('#drawer')){if(t.closest('#modal'))closeModal();openDrawer(t.dataset.open,t.dataset.opentab);return}
  if(t.dataset.stage){setStage(S.open,t.dataset.stage);return}
  if(t.dataset.tab){S.tab=t.dataset.tab;watchPhotos();renderDrawer(true);return}
  if(t.dataset.rm!=null){const j=S.jobs.get(S.open);const items=[...(j.quote?.items||[])];items.splice(+t.dataset.rm,1);saveJob(S.open,{quote:{items}});return}
  if(t.dataset.rmmember){const em=t.dataset.rmmember;arm(t,'ยืนยันลบ',()=>BK.remove('members',em).then(()=>toast('ลบสมาชิกแล้ว')).catch(writeErr));return}
  const a=t.dataset.act;const j=S.open&&S.jobs.get(S.open);
  if(a==='more')openMore();
  else if(a==='addcrew'){const c=[...(j.crew||[])];c.push({name:'',pos:c.length?'help':'lead'});saveCrew(S.open,c)}
  else if(a==='crewdefault'){saveCrew(S.open,crewRoster().slice(0,MAX_CREW).map(r=>({name:r.name,pos:r.pos})))}
  else if(a==='addctier'){const t=crewTiers();const l=t[t.length-1];saveCrewTiers([...t,{label:'ใหม่',upTo:(+l.upTo||0)+10,exp:'',max:+l.max+1,smax:+l.smax+1,n:[...l.n],s:[...l.s]}])}
  else if(a==='addroster'){saveRoster([...crewRoster(),{name:'',pos:'help'}])}
  else if(a==='addins'){const ins=[...appCfg().installments,{k:rid('i'),label:'งวดใหม่',pct:0,stage:'done'}];upsert('settings','app',{installments:ins,sv:2},S.settings).catch(writeErr)}
  else if(a==='addtier'){const t=appCfg().tiers;const last=t.filter(x=>+x.upTo>0).reduce((m,x)=>Math.max(m,+x.upTo),0);saveTiers([...t,{upTo:last+10,amt:0}])}
  else if(a==='new')openNew();
  else if(a==='newappt')openApptModal();
  else if(a==='demo')loadDemo();
  else if(a==='cleardemo')arm(t,'กดอีกครั้งเพื่อลบ',clearDemo);
  else if(a==='close')closeDrawer();
  else if(a==='mclose')closeModal();
  else if(a==='lbclose'){S.lb=null;renderLightbox()}
  else if(a==='signout'){if(FB)FB.auth.signOut(FB.authInst)}
  else if(a==='copylink')copy($('#teamLink').value,'คัดลอกลิงก์แล้ว');
  else if(a==='claim')saveJob(S.open,{owner:S.me},'รับเป็นผู้รับงาน');
  else if(a==='delete')arm(t,'กดอีกครั้งเพื่อลบถาวร',()=>delJob(S.open));
  else if(a==='additem'){const items=[...(j.quote?.items||[]),{d:'รายการใหม่',q:1,u:'งาน',p:0}];saveJob(S.open,{quote:{items}})}
  else if(a==='gen'){const go=()=>saveJob(S.open,{quote:{items:buildItems(j)}},'สร้างรายการใบเสนอราคาใหม่จากขนาดระบบ');(j.quote?.items||[]).length?arm(t,'แทนที่รายการเดิม? กดอีกครั้ง',go):go()}
  else if(a==='printquote')printQuote(j);
  else if(a==='pptx')proposalPptx({id:S.open,...j},t);
  else if(a==='savequote')saveFile(`ใบเสนอราคา-${j.code}.html`,quoteDoc(j,false),'text/html');
  else if(a==='copyquote')copy(quoteText(j),'คัดลอกแล้ว วางในไลน์หรืออีเมลได้เลย');
  else if(a==='bonusxlsx')bonusXlsx(t);
  else if(a==='csv')saveFile(`solartouch-jobs-${new Date().toISOString().slice(0,10)}.csv`,csv(),'text/csv');
  else if(a==='pdf'){t.disabled=true;photoPDF({id:S.open,...j}).catch(err=>{console.error(err);toast('สร้าง PDF ไม่สำเร็จ')}).finally(()=>{if(t.isConnected)t.disabled=false})}
  else if(a==='mapfit')fitAll();
  else if(a==='geo'){toast('กำลังหาตำแหน่ง…');navigator.geolocation.getCurrentPosition(p=>{saveJob(S.open,{lat:+p.coords.latitude.toFixed(6),lng:+p.coords.longitude.toFixed(6)},'บันทึกตำแหน่งจาก GPS หน้างาน');toast(`บันทึกตำแหน่งแล้ว (แม่นยำ ±${Math.round(p.coords.accuracy)} ม.)`)},err=>toast(err.code===1?'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์':'หาตำแหน่งไม่สำเร็จ'),{enableHighAccuracy:true,timeout:15000})}
});
document.addEventListener('submit',e=>{const f=e.target;
  if(f.id==='addMember'){e.preventDefault();const em=$('#memEmail').value.trim().toLowerCase();if(!em)return;BK.put('members',em,{addedBy:S.me,addedAt:Date.now()}).then(()=>{toast('เพิ่ม '+em+' แล้ว');$('#memEmail').value=''}).catch(writeErr);return}
  if(f.classList&&f.classList.contains('payf')){e.preventDefault();savePay(S.open,f.dataset.payk,Object.fromEntries(new FormData(f)));return}
  if(f.id==='apd'||f.id==='apm'){e.preventDefault();const d=Object.fromEntries(new FormData(f));const jobId=f.id==='apd'?S.open:d.job;addAppt(jobId,d);if(f.id==='apm')closeModal();else{f.reset();S.drawerDirty=false}return}
});
document.addEventListener('change',e=>{const el=e.target;
  if(el.id==='pmFilter'){S.pmFilter=el.value;renderView();return}
  if(el.id==='bMonth'){S.bMonth=el.value;if(el.value==='custom'&&!S.bFrom&&!S.bTo){const n=new Date();S.bFrom=ymd(new Date(n.getFullYear(),n.getMonth(),1));S.bTo=ymd(n)}renderView();return}
  if(el.id==='bFrom'||el.id==='bTo'){S[el.id]=el.value;renderView();return}
  if(el.id==='crewProrate'){upsert('settings','app',{crewProrate:el.value},S.settings).catch(writeErr);return}
  if(el.dataset.inst){const j=S.jobs.get(S.open);if(!j)return;const k=el.dataset.inst;const v=k==='days'?(+el.value||null):el.value;saveJob(S.open,{inst:{[k]:v}},k==='days'?`บันทึกวันทำงานจริง ${v||'-'} วัน`:`บันทึก${k==='start'?'วันเริ่ม':'วันเสร็จ'}ติดตั้ง ${v}`);return}
  if(el.dataset.crew!=null){const j=S.jobs.get(S.open);if(!j)return;const c=(j.crew||[]).map(x=>({...x}));const r=c[+el.dataset.crew];if(!r)return;r[el.dataset.k]=el.dataset.k==='days'?(+el.value>0?+el.value:null):el.value;
    if(el.dataset.k==='name'){const ro=crewRoster().find(x=>x.name===el.value);if(ro)r.pos=ro.pos}saveCrew(S.open,c);return}
  if(el.dataset.ctier!=null){const t=crewTiers().map(x=>({...x,n:[...x.n],s:[...x.s]}));const r=t[+el.dataset.ctier];if(!r)return;const k=el.dataset.k;
    if(k==='n'||k==='s')r[k][+el.dataset.pi]=+el.value||0;else r[k]=(k==='label'||k==='exp')?el.value:(+el.value||0);
    if(k==='upTo')t.sort((a,b)=>+a.upTo-+b.upTo);saveCrewTiers(t);return}
  if(el.dataset.roster!=null){const r=crewRoster().map(x=>({...x}));const it=r[+el.dataset.roster];if(!it)return;it[el.dataset.k]=el.value;saveRoster(r);return}
  if(el.dataset.ins!=null){const ins=appCfg().installments.map(x=>({...x}));const it=ins[+el.dataset.ins];if(!it)return;it[el.dataset.k]=el.dataset.k==='pct'?+el.value||0:el.value;upsert('settings','app',{installments:ins,sv:2},S.settings).catch(writeErr);return}
  if(el.dataset.duedays){upsert('settings','app',{dueDays:Math.max(1,+el.value||7)},S.settings).catch(writeErr);return}
  if(el.dataset.tier!=null){const t=appCfg().tiers.map(x=>({...x}));const it=t[+el.dataset.tier];if(!it)return;it[el.dataset.k]=+el.value||0;saveTiers(t);return}
  if(el.dataset.adj){saveBonus(el.dataset.adj,{adj:+el.value||0});return}
  if(el.dataset.perm){const [r,p]=el.dataset.perm.split('|');const cur=S.permsDoc;const next={manager:{...DEFAULT_PERMS.manager,...((cur||{}).manager||{})},staff:{...DEFAULT_PERMS.staff,...((cur||{}).staff||{})}};next[r][p]=el.checked;BK.put('settings','perms',next).catch(writeErr);return}
  if(el.dataset.setrole){setRole(el.dataset.setrole,el.value).then(()=>toast('บันทึกตำแหน่งแล้ว'));return}
  if(el.dataset.upload){const files=[...el.files];el.value='';uploadPhotos(files,el.dataset.upload);return}
  if(el.dataset.cap){BK.patch('photos',el.dataset.cap,{cap:el.value}).catch(writeErr);return}
  if(el.dataset.movecat){BK.patch('photos',el.dataset.movecat,{cat:el.value}).catch(writeErr);return}
});
$('#scrim').addEventListener('click',()=>{if(!$('#modal').hidden)closeModal();else closeDrawer()});
$('#lightbox').addEventListener('click',e=>{if(e.target.id==='lightbox'){S.lb=null;renderLightbox()}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(S.lb){S.lb=null;renderLightbox()}else if(!$('#modal').hidden)closeModal();else if(S.open)closeDrawer()}});
$('#newBtn').addEventListener('click',openNew);
const fabEl=$('#fab');if(fabEl)fabEl.addEventListener('click',openNew);
$('#q').addEventListener('input',e=>{S.q=e.target.value;if(S.view==='team'||S.view==='cal')S.view='list';renderChrome();renderView()});

$('#drawer').addEventListener('change',e=>{const el=e.target;const id=S.open;const j=S.jobs.get(id);if(!j)return;
  if(el.dataset.upload||el.closest('form.apptf')||el.closest('form.payf'))return;
  if(el.dataset.f){const k=el.dataset.f;let v=el.value;if(k==='kw'||k==='inv')v=+v||0;if(j[k]===v)return;const L={name:'ชื่อลูกค้า',phone:'เบอร์โทร',email:'อีเมล',prov:'จังหวัด',addr:'ที่อยู่',util:'การไฟฟ้า',phase:'มิเตอร์',type:'ประเภทระบบ',kw:'ขนาดระบบ',inv:'ขนาด Inverter',roof:'ชนิดหลังคา',grp:'กลุ่มลูกค้า',note:'บันทึกหน้างาน',pmName:'ผู้ดูแลโครงการ'};saveJob(id,{[k]:v},k==='pmName'?`กำหนดผู้ดูแลโครงการ: ${v}`:`แก้ไข${L[k]||k}`)}
  else if(el.dataset.pm){const v=el.value;if(v==='_other'){saveJob(id,{pm:null,pmName:j.pmName||'',pmOther:true}).then(()=>renderDrawer(true));return}saveJob(id,{pm:v||null,pmName:'',pmOther:false},v?`กำหนดผู้ดูแลโครงการ: ${nm(v)}`:'ยกเลิกผู้ดูแลโครงการ').then(()=>renderDrawer(true))}
  else if(el.dataset.loc){const v=el.value.trim();const p=parseLoc(v);if(!v){saveJob(id,{lat:null,lng:null,mapUrl:''},'ลบตำแหน่ง');return}
    if(p)saveJob(id,{lat:p.lat,lng:p.lng,mapUrl:/^https?:/.test(v)?v:''},'บันทึกตำแหน่ง Google Maps');
    else{saveJob(id,{mapUrl:/^https?:/.test(v)?v:''},'บันทึกลิงก์ Google Maps');toast('อ่านพิกัดจากลิงก์นี้ไม่ได้ (ลิงก์ย่อ) ปุ่มเปิดใน Google Maps ยังใช้ได้ ถ้าจะแสดงบนแผนที่ให้วางตัวเลขพิกัดแทน')}}
  else if(el.dataset.ppbrand){const cur=ppIn(j).brands;const b=el.dataset.ppbrand;const next=el.checked?[...new Set([...cur,b])]:cur.filter(x=>x!==b);if(!next.length){el.checked=true;toast('เลือกอย่างน้อย 1 ยี่ห้อ');return}saveJob(id,{proposal:{brands:next}})}
  else if(el.dataset.ppoff){const cur=ppIn(j).off;const k=el.dataset.ppoff;const next=el.checked?cur.filter(x=>x!==k):[...new Set([...cur,k])];saveJob(id,{proposal:{off:next}})}
  else if(el.dataset.pp){const k=el.dataset.pp;const v=(k==='mode'||k==='rec'||k==='brand'||k==='sell')?el.value:(el.value===''?'':Math.max(0,+el.value||0));if((j.proposal||{})[k]===v)return;saveJob(id,{proposal:{[k]:v}})}
  else if(el.dataset.q){const k=el.dataset.q;let v=el.value;if(k!=='status')v=+v||0;const SL={draft:'ร่าง',sent:'ส่งลูกค้าแล้ว',approved:'ลูกค้าอนุมัติ',rejected:'ไม่ผ่าน'};saveJob(id,{quote:{[k]:v}},k==='status'?`ใบเสนอราคา: ${SL[v]}`:null)}
  else if(el.dataset.i!=null){const items=(j.quote?.items||[]).map(x=>({...x}));const it=items[+el.dataset.i];if(!it)return;it[el.dataset.k]=(el.dataset.k==='q'||el.dataset.k==='p')?(+el.value||0):el.value;saveJob(id,{quote:{items}})}
  else if(el.dataset.doc){const k=el.dataset.doc;const txt=DOCS.flatMap(g=>g.items).find(x=>x[0]===k)[1];saveJob(id,{permits:{[k]:{done:el.checked,at:Date.now(),by:S.me}}},`${el.checked?'✓':'ยกเลิก'} ${txt}`)}
  else if(el.dataset.g){const k=el.dataset.g;const L={ref:'เลขที่คำร้อง',submit:'วันยื่นคำร้อง',inspect:'วันนัดตรวจ',meter:'วันเปลี่ยนมิเตอร์'};saveJob(id,{grid:{[k]:el.value}},`บันทึก${L[k]} ${el.value}`)}
});
$('#drawer').addEventListener('focusout',()=>setTimeout(()=>{const ae=document.activeElement;if(S.drawerDirty&&!(ae&&ae.closest&&ae.closest('form.apptf,form.payf')))renderDrawer()},0));

let dragId=null;
document.addEventListener('dragstart',e=>{const c=e.target.closest&&e.target.closest('.card');if(!c||!canEditJob(S.jobs.get(c.dataset.id)))return;dragId=c.dataset.id;c.classList.add('dragging');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId)}catch{}});
document.addEventListener('dragend',e=>{const c=e.target.closest&&e.target.closest('.card');if(c)c.classList.remove('dragging');document.querySelectorAll('.col.over').forEach(c=>c.classList.remove('over'));dragId=null});
document.addEventListener('dragover',e=>{const col=e.target.closest&&e.target.closest('.col');if(!col||!dragId)return;e.preventDefault();document.querySelectorAll('.col.over').forEach(c=>c!==col&&c.classList.remove('over'));col.classList.add('over')});
document.addEventListener('drop',e=>{const col=e.target.closest&&e.target.closest('.col');if(!col||!dragId)return;e.preventDefault();col.classList.remove('over');setStage(dragId,col.dataset.col)});

/* ---------- presence ---------- */
let beatTimer=null;
function beat(away){if(BK)BK.presence({job:S.open||null,view:S.view,away:!!away})}
document.addEventListener('visibilitychange',()=>beat(document.visibilityState==='hidden'));
window.addEventListener('pagehide',()=>beat(true));

/* ---------- gate (Firebase only) ---------- */
function showGate(state,email){
  $('#app').hidden=true;$('#tabbar').hidden=true;if(fabEl)fabEl.hidden=true;$('#gate').hidden=false;
  $('#gSignIn').hidden=state!=='signin';$('#gSignOut').hidden=state!=='denied';
  $('#gateMsg').textContent=state==='denied'?'บัญชีนี้ยังไม่ได้รับอนุญาตให้เข้าใช้ ส่งอีเมลด้านล่างให้ผู้ดูแลระบบเพิ่มในหน้า “ทีมงาน” แล้วรีเฟรชหน้านี้'
    :state==='loading'?'กำลังตรวจสอบบัญชี…':'ระบบบริหารงานติดตั้งโซลาร์บ้านของทีม เข้าสู่ระบบด้วยบัญชี Google ที่ผู้ดูแลอนุญาตไว้';
  $('#gateWho').textContent=email||''}
function showApp(){const g=$('#gate');if(g)g.hidden=true;$('#app').hidden=false;$('#tabbar').hidden=false;render()}

/* ---------- boot ---------- */
function watchCommon(){const out=[];
  out.push(BK.watch('settings',docs=>{const a=docs.find(d=>d.id==='app'),p=docs.find(d=>d.id==='perms');S.settings=a?a.data:null;S.permsDoc=p?p.data:null;const o=docs.find(d=>d.id==='owner');if(o&&o.data.id){S.ownerId=o.data.id;S.team.add(o.data.id)}scheduleRender()},()=>{}));
  out.push(BK.watch('finance',docs=>{S.fin=new Map(docs.map(d=>[d.id,d.data]));scheduleRender()},()=>{}));
  out.push(BK.watch('bonus',docs=>{S.bonus=new Map(docs.map(d=>[d.id,d.data]));scheduleRender()},()=>{}));
  if(BK.kind!=='firebase')out.push(BK.watch('roles',docs=>{S.roleMap=Object.fromEntries(docs.map(d=>[d.id,d.data.role]));docs.forEach(d=>S.team.add(d.id));scheduleRender()},()=>{}));
  return out}
function onJobs(docs,meta){S.jobs=new Map(docs.map(d=>[d.id,normJob(d.data)]));S.loaded=true;
  if(realRole()==='admin'&&BK.kind!=='demo'){S.migrated=S.migrated||new Set();S.jobs.forEach((j,id)=>{if(j._legacy&&!S.migrated.has(id)){S.migrated.add(id);BK.patch('jobs',id,{sv:2,stage:j.stage,steps:j.steps}).catch(()=>{})}})}
  if(BK.kind==='firebase')S.mode=meta&&meta.fromCache&&!navigator.onLine?'offline':'live';
  if(S.open&&!S.jobs.has(S.open))closeDrawer();scheduleRender()}
async function bootDemo(){BK=memoryBackend();S.mode='demo';S.me='demo';S.isAdmin=true;S.ownerId='demo';watchCommon();BK.put('roles','t1',{role:'manager'});BK.put('roles','t2',{role:'staff'});
  [['demo','คุณ (โหมดตัวอย่าง)'],['t1','ช่างเอก (ตัวอย่าง)'],['t2','วิศวกรนภา (ตัวอย่าง)']].forEach(([id,n])=>{S.prof[id]={name:n};S.team.add(id)});
  BK.watch('jobs',onJobs);for(const j of demoJobs())await BK.put('jobs',rid('j'),j);
  const jid=[...(await new Promise(r=>{const u=BK.watch('jobs',d=>{u&&u();r(d)})}))].find(d=>d.data.stage==='grid');
  if(jid){const sw=(t,c1,c2)=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,800,600);g.addColorStop(0,c1);g.addColorStop(1,c2);x.fillStyle=g;x.fillRect(0,0,800,600);x.fillStyle='rgba(255,255,255,.92)';x.font='600 40px sans-serif';x.fillText(t,40,560);return c.toDataURL('image/jpeg',.7)};
    [['overview','#1E4FD6','#0A2350','Roof'],['overview','#F0661A','#FFB01F','South array'],['firmware','#0A2350','#46546F','Firmware'],['ct','#11905A','#0A2350','CT clamp'],['tie','#7783A0','#0A2350','MDB'],['combiner','#F0661A','#0A2350','Combiner']].forEach(([c,a,b,t],i)=>BK.put('photos','pd'+i,{job:jid.id,cat:c,data:sw(t+' (sample)',a,b),w:800,h:600,cap:'',at:Date.now()-(10-i)*1000,by:'t1'}))}
  const all=await new Promise(r=>{const u=BK.watch('jobs',d=>{u&&u();r(d)})});
  for(const d of all){const j=d.data;const tot=quoteTotals(j).total;const ins=DEFAULT_APP.installments;const rec={};
    ins.forEach(it=>{if(SIDX[j.stage]>=SIDX[it.stage]&&!(j.stage==='install'&&it.k!=='dep')&&!(j.stage==='grid'&&it.k==='inst'))rec[it.k]={amt:Math.round(tot*it.pct/100),date:ymd(new Date(Date.now()-3*86400000)),method:'โอนเงิน',note:'',by:'demo',at:Date.now()}});
    if(Object.keys(rec).length)BK.put('finance',d.id,{job:d.id,rec});
    if(['install','grid','done'].includes(j.stage)){const D=86400000,end=new Date(Date.now()-(j.stage==='install'?0:5)*D);const dd=j.stage==='done'?3:2;
      BK.patch('jobs',d.id,{inst:j.stage==='install'?{start:ymd(new Date(Date.now()-D))}:{start:ymd(new Date(end.getTime()-(dd-1)*D)),end:ymd(end)},crew:[{name:'สมชาย ใจดี',pos:'lead'},{name:'ประยุทธ แข็งแรง',pos:'sub'},{name:'วีระ ช่างไฟ',pos:'tech'},{name:'อาทิตย์ ขยัน',pos:'tech'},{name:'มานพ ช่วยงาน',pos:'help'},{name:'เด่น ตั้งใจ',pos:'help'}]})}
    if(j.stage==='done')BK.put('bonus',d.id,{job:d.id,paid:true,paidAt:Date.now()-86400000,paidBy:'demo',amt:bonusOf({id:d.id,...j}).amt})}
  BK.put('settings','app',{crewRoster:[{name:'สมชาย ใจดี',pos:'lead'},{name:'ประยุทธ แข็งแรง',pos:'sub'},{name:'วีระ ช่างไฟ',pos:'tech'},{name:'อาทิตย์ ขยัน',pos:'tech'},{name:'มานพ ช่วยงาน',pos:'help'},{name:'เด่น ตั้งใจ',pos:'help'}]});
  showApp()}
async function bootArtifact(){
  const use=n=>window.claude.use(n).catch(()=>null);
  const [db,user,room,d]=await Promise.all(['db','user','room','downloads'].map(use));
  if(!db){await bootDemo();return}
  dl=d;userCap=user;BK=artifactBackend(db,room);S.mode='live';
  if(user){try{S.me=await user.id();if(S.me)S.team.add(S.me);S.isAdmin=await user.isOwner();if(S.isAdmin)S.ownerId=S.me;const cw=await user.can('data.write');if(cw===false)S.baseWrite=false;
    user.search('').then(hs=>{hs.forEach(h=>{S.team.add(h.id);S.prof[h.id]={name:h.name,photo:h.avatarUrl}});scheduleRender()}).catch(()=>{})}catch{}}
  BK.watch('jobs',onJobs,err=>{console.error(err);S.loaded=true;S.mode='offline';scheduleRender()});
  watchCommon();if(S.isAdmin&&S.me)upsert('settings','owner',{id:S.me},false).catch(()=>{});
  if(room){room.onPeers(ch=>{S.peers=ch.peers.filter(p=>p.kind==='viewer').map(p=>({by:p.by||(p.presence&&p.presence.uid),job:(p.presence&&p.presence.job)||null,lastSeen:Infinity}));S.peers.forEach(p=>p.by&&S.team.add(p.by));scheduleRender()},()=>{})}
  beat();showApp()}
async function bootFirebase(){
  const base='https://www.gstatic.com/firebasejs/10.12.2/';
  showGate('loading');
  const [app,auth,fs]=await Promise.all([import(base+'firebase-app.js'),import(base+'firebase-auth.js'),import(base+'firebase-firestore.js')]);
  const fapp=app.initializeApp(FBCFG);
  let db;try{db=fs.initializeFirestore(fapp,{localCache:fs.persistentLocalCache({tabManager:fs.persistentMultipleTabManager()})})}catch{db=fs.getFirestore(fapp)}
  const authInst=auth.getAuth(fapp);FB={auth,authInst};BK=firebaseBackend(db,fs);
  auth.getRedirectResult(authInst).catch(()=>{});
  $('#gSignIn').onclick=async()=>{const p=new auth.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});
    try{await auth.signInWithPopup(authInst,p)}catch(e){if(/popup|operation-not-supported/.test(e.code||''))auth.signInWithRedirect(authInst,p);else toast('เข้าสู่ระบบไม่สำเร็จ: '+(e.code||e.message))}};
  $('#gSignOut').onclick=()=>auth.signOut(authInst);
  let unsubs=[];
  auth.onAuthStateChanged(authInst,async u=>{
    unsubs.forEach(f=>f());unsubs=[];clearInterval(beatTimer);S.jobs=new Map();S.loaded=false;S.member=false;closeDrawer();
    if(!u){S.me=null;showGate('signin');return}
    S.me=u.uid;S.email=(u.email||'').toLowerCase();S.isAdmin=ADMIN_EMAILS.includes(S.email);
    showGate('loading',S.email);
    // admin list lives only in firestore.rules: reading admins/<email> is allowed only for admins
    if(!S.isAdmin){try{await fs.getDoc(fs.doc(db,'admins',S.email));S.isAdmin=true}catch{S.isAdmin=false}}
    let ok=S.isAdmin;if(!ok){try{ok=(await fs.getDoc(fs.doc(db,'members',S.email))).exists()}catch{ok=false}}
    if(!ok){showGate('denied',S.email);return}
    S.member=true;S.mode='connecting';
    fs.setDoc(fs.doc(db,'users',u.uid),{name:u.displayName||S.email.split('@')[0],photo:u.photoURL||'',email:S.email,lastLogin:Date.now()},{merge:true}).catch(()=>{});
    showApp();
    unsubs.push(BK.watch('jobs',onJobs,err=>{console.error(err);S.loaded=true;S.mode='offline';scheduleRender();if(err.code==='permission-denied')showGate('denied',S.email)}));
    unsubs.push(BK.watch('users',docs=>{docs.forEach(d=>S.prof[d.id]=d.data);scheduleRender()}));
    unsubs.push(BK.watch('members',docs=>{S.members=docs.map(d=>({id:d.id,...d.data}));if(S.view==='team')scheduleRender()}));
    watchCommon().forEach(u=>unsubs.push(u));
    unsubs.push(BK.watch('presence',docs=>{S.peers=docs.map(d=>({by:d.id,...d.data}));scheduleRender()}));
    beat();beatTimer=setInterval(()=>{if(document.visibilityState==='visible')beat();renderChrome()},HEARTBEAT_MS);
  });
  window.addEventListener('online',()=>{if(S.member){S.mode='live';renderChrome()}});
  window.addEventListener('offline',()=>{if(S.member){S.mode='offline';renderChrome()}});
}
function boot(){
  if(FBCFG.apiKey)return bootFirebase().catch(e=>{console.error(e);showGate('signin');$('#gateMsg').textContent='เชื่อมต่อ Firebase ไม่สำเร็จ ตรวจสอบค่าในไฟล์ firebase-config.js ('+(e.message||e)+')'});
  if(window.claude&&typeof window.claude.use==='function')return bootArtifact();
  if(window.SOLARTOUCH_ARTIFACT){showApp();let n=0;const t=setInterval(()=>{if(window.claude&&typeof window.claude.use==='function'){clearInterval(t);bootArtifact()}else if(++n>60){clearInterval(t);bootDemo()}},50);return}
  return bootDemo();
}
boot();
if('serviceWorker' in navigator&&location.protocol==='https:'&&!window.SOLARTOUCH_ARTIFACT)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
