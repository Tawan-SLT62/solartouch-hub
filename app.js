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
  {k:'lead',   t:'รับงาน / ลูกค้าใหม่',          s:'รับงาน',      g:'sales'},
  {k:'survey', t:'สำรวจหน้างาน',                 s:'สำรวจ',       g:'sales'},
  {k:'quote',  t:'ออกแบบระบบ & เสนอราคา',        s:'เสนอราคา',    g:'sales'},
  {k:'deal',   t:'ลูกค้าอนุมัติ / ชำระมัดจำ',      s:'อนุมัติ',      g:'sales'},
  {k:'permit', t:'ขออนุญาตท้องถิ่น & แจ้ง กกพ.',   s:'ขออนุญาต',    g:'permit'},
  {k:'install',t:'ติดตั้งระบบ',                  s:'ติดตั้ง',      g:'permit'},
  {k:'grid',   t:'ยื่นขอขนานไฟกับการไฟฟ้า',       s:'ยื่นขนานไฟ',   g:'permit'},
  {k:'inspect',t:'การไฟฟ้าตรวจ / เปลี่ยนมิเตอร์',  s:'ตรวจ/มิเตอร์', g:'permit'},
  {k:'done',   t:'ขนานไฟสำเร็จ / ส่งมอบงาน',     s:'ส่งมอบ',      g:'done'}
];
const SIDX=Object.fromEntries(STAGES.map((s,i)=>[s.k,i]));
const STAGE_COLOR=i=>i<4?'var(--blue)':i<8?'var(--orange)':'var(--good)';
const STAGE_HEX=i=>i<4?'#1E4FD6':i<8?'#F0661A':'#11905A';
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
const S={jobs:new Map(),loaded:false,mode:'connecting',view:'dash',open:null,tab:'info',q:'',stageFilter:'',pmFilter:'',
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
    ...(hyb?[{d:'แบตเตอรี่ลิเธียม LFP 5.12 kWh',q:1,u:'ชุด',p:55000}]:[]),
    {d:'รางอะลูมิเนียมและอุปกรณ์ยึดหลังคา',q:n,u:'ชุด',p:950},
    {d:'ตู้ DC/AC Protection (เบรกเกอร์ / Surge / ฟิวส์)',q:1,u:'ตู้',p:9500},
    {d:'สาย PV1-F, สาย AC, ท่อร้อยสาย และกราวด์',q:1,u:'งาน',p:7500},
    {d:'ค่าแรงติดตั้ง ทดสอบ และเดินระบบ',q:kw,u:'kWp',p:2500},
    {d:'ออกแบบ วิศวกรรับรอง และดำเนินการขออนุญาตขนานไฟ',q:1,u:'งาน',p:12000}
  ];
}
function jobCode(){const d=new Date();return `ST-${String(d.getFullYear()+543).slice(2)}${String(d.getMonth()+1).padStart(2,'0')}-${Math.floor(100+Math.random()*900)}`}
function makeJob(f,extra={}){const now=Date.now();const loc=parseLoc(f.loc);
  const j={code:jobCode(),name:f.name,phone:f.phone||'',addr:f.addr||'',prov:f.prov||'',util:f.util||'PEA',phase:f.phase||'1',type:f.type||'ongrid',kw:+f.kw||5,roof:f.roof||ROOFS[0],note:'',
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
function saveJob(id,patch,msg){const j=S.jobs.get(id);if(!j||!S.canWrite)return Promise.resolve();const now=Date.now();const full={...patch,updatedAt:now,updatedBy:S.me};
  if(msg)full.log=[...(j.log||[]),{t:now,by:S.me,m:msg}].slice(-60);
  return BK.patch('jobs',id,full).catch(writeErr)}
function delJob(id){BK.remove('jobs',id).catch(writeErr);closeDrawer();toast('ลบงานแล้ว')}
function setStage(id,k){const j=S.jobs.get(id);if(!j||j.stage===k)return;const now=Date.now();saveJob(id,{stage:k,stageAt:now,steps:{[k]:now}},`ย้ายไปขั้น “${STAGES[SIDX[k]].t}”`)}
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
function demoJobs(){const D=86400000,now=Date.now(),today=new Date();const dd=n=>ymd(new Date(today.getFullYear(),today.getMonth(),today.getDate()+n));
  const mk=(f,stage,agoD,perm=[],extra={})=>{const j=makeJob(f,{demo:true});const at=now-agoD*D;j.stage=stage;j.stageAt=at;j.createdAt=at-5*D;j.updatedAt=at;j.steps={};STAGES.slice(0,SIDX[stage]+1).forEach((s,i)=>j.steps[s.k]=at-(SIDX[stage]-i)*2*D);perm.forEach(k=>j.permits[k]={done:true,at,by:S.me});j.log=[{t:j.createdAt,by:S.me,m:'สร้างงานใหม่ (ตัวอย่าง)'},{t:at,by:S.me,m:`ย้ายไปขั้น “${STAGES[SIDX[stage]].t}”`}];Object.assign(j,extra);return j};
  const T=[...S.team];
  return[
    mk({name:'คุณวิภาวรรณ ศรีสุข (ตัวอย่าง)',phone:'081-234-5678',addr:'หมู่บ้านพฤกษา ถ.บางกรวย-ไทรน้อย',prov:'นนทบุรี',util:'PEA',kw:5,phase:'1',type:'ongrid',loc:'13.8621, 100.4153'},'quote',2,[],{pm:T[1]||null,appts:[{id:'a1',date:dd(2),time:'10:00',type:'meet',note:'นำเสนอใบเสนอราคา',who:T[0]||null}]}),
    mk({name:'คุณธนพล วงศ์ใหญ่ (ตัวอย่าง)',phone:'089-777-1020',addr:'ซ.ลาดพร้าว 101',prov:'กรุงเทพฯ',util:'MEA',kw:10,phase:'3',type:'hybrid',loc:'13.7946, 100.6245'},'permit',9,['idcard','house','bill','struct'],{pm:T[2]||null}),
    mk({name:'คุณศิริพร แก้วมณี (ตัวอย่าง)',phone:'086-555-4412',addr:'ต.บ้านสวน อ.เมือง',prov:'ชลบุรี',util:'PEA',kw:5,phase:'1',type:'ongrid',loc:'13.3611, 100.9847'},'grid',4,DOC_KEYS,{pm:T[1]||null,grid:{ref:'PEA-ชบ-0458',submit:dd(-4),inspect:dd(5),meter:''},photos:{overview:2,firmware:1,ct:1,zeroset:0,tie:1,combiner:1}}),
    mk({name:'คุณอนุชา พรหมมา (ตัวอย่าง)',phone:'092-118-3300',addr:'ต.สุเทพ อ.เมือง',prov:'เชียงใหม่',util:'PEA',kw:3,phase:'1',type:'ongrid',loc:'18.8048, 98.9555'},'survey',1,[],{pm:T[2]||null,appts:[{id:'a2',date:dd(1),time:'09:30',type:'survey',note:'วัดหลังคา ถ่ายรูปตู้ MDB',who:T[2]||null}]}),
    mk({name:'คุณประเสริฐ ทองดี (ตัวอย่าง)',phone:'081-440-7788',addr:'ต.ในเมือง อ.เมือง',prov:'ขอนแก่น',util:'PEA',kw:10,phase:'3',type:'ongrid',loc:'16.4419, 102.8360'},'install',2,['idcard','house','bill','struct','local','erc','sld','license','spec'],{pm:T[1]||null,appts:[{id:'a3',date:dd(0),time:'08:00',type:'install',note:'ทีมช่าง 4 คน ติดตั้งแผงวันแรก',who:T[1]||null},{id:'a4',date:dd(3),time:'08:00',type:'install',note:'เดินสาย AC + ทดสอบ',who:T[1]||null}]}),
    mk({name:'คุณมาลี จันทร์เพ็ญ (ตัวอย่าง)',phone:'084-900-2211',addr:'ถ.มิตรภาพ',prov:'นครราชสีมา',util:'PEA',kw:8,phase:'3',type:'ongrid',loc:'14.9799, 102.0978'},'done',3,DOC_KEYS,{pm:T[2]||null,grid:{ref:'PEA-นม-1120',submit:dd(-20),inspect:dd(-9),meter:dd(-3)}})
  ]}
async function loadDemo(){if(!S.canWrite)return;for(const j of demoJobs())await createJob(rid('j'),j);toast('เพิ่มงานตัวอย่างแล้ว')}
async function clearDemo(){const ids=[...S.jobs].filter(([,j])=>j.demo).map(([id])=>id);for(const id of ids)await BK.remove('jobs',id).catch(writeErr);toast('ลบงานตัวอย่างแล้ว')}

/* ---------- filters ---------- */
function visibleJobs(){const q=S.q.trim().toLowerCase();let arr=[...S.jobs].map(([id,j])=>({id,...j}));
  if(q)arr=arr.filter(j=>[j.name,j.phone,j.code,j.prov,j.addr,pmName(j)].join(' ').toLowerCase().includes(q));
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
function render(){renderChrome();renderView();renderDrawer();renderLightbox()}
const TITLES={dash:'ภาพรวม',board:'บอร์ดงานติดตั้ง',cal:'ปฏิทินงาน',map:'แผนที่งานติดตั้ง',list:'รายการลูกค้า',team:'ทีมงาน'};
function renderChrome(){
  $('#vtitle').textContent=TITLES[S.view];
  document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-current',b.dataset.view===S.view));
  const M={live:['live','ซิงก์สดกับทีม'],demo:['demo','โหมดตัวอย่าง · ไม่บันทึก'],connecting:['','กำลังเชื่อมต่อ…'],offline:['','ออฟไลน์ · จะซิงก์เมื่อกลับมา']};const m=M[S.mode];
  $('#syncR').innerHTML=`<span class="dot ${m[0]}"></span><span>${m[1]}</span>`;
  const ids=[...new Set(onlinePeers().map(p=>p.by).filter(Boolean))];
  $('#peers').innerHTML=ids.slice(0,5).map(id=>`<span title="${esc(nm(id))}${id===S.me?' (คุณ)':''}">${av(id)}</span>`).join('');
  $('#onlineR').textContent=BK&&BK.kind!=='demo'?`ออนไลน์ ${Math.max(1,ids.length)} คน`:'';
  $('#meRow').innerHTML=BK&&BK.kind==='firebase'&&S.me?`${av(S.me)}<span class="t"><b>${esc(nm(S.me))}</b>${S.isAdmin?'ผู้ดูแลระบบ':'สมาชิกทีม'}</span><button data-act="signout">ออก</button>`:'';
  const nb=$('#newBtn'),fab=$('#fab');nb.disabled=!S.canWrite||S.mode==='connecting';if(fab)fab.hidden=!S.canWrite||S.mode==='connecting';
}

function renderView(){
  const v=$('#view');
  if(S.view!=='map'&&S.lmap){S.lmap.remove();S.lmap=null}
  if(S.view==='team'){v.innerHTML=teamHTML();return}
  if(!S.loaded){v.innerHTML=`<div class="empty"><h2>กำลังโหลดงานของทีม</h2><p>เชื่อมต่อฐานข้อมูลร่วม เพื่อให้ทุกคนเห็นสถานะเดียวกันแบบเรียลไทม์</p></div>`;return}
  if(S.view==='map'){renderMap(v);return}
  let html='';
  if(S.mode==='demo')html+=`<div class="banner"><b>โหมดตัวอย่าง</b><span>ยังไม่ได้เชื่อมฐานข้อมูล ข้อมูลที่แก้ไขจะหายเมื่อรีเฟรช</span></div>`;
  else if(!S.canWrite)html+=`<div class="banner"><b>ดูอย่างเดียว</b><span>บัญชีนี้ไม่มีสิทธิ์แก้ไข ขอให้ผู้ดูแลเพิ่มสิทธิ์</span></div>`;
  if(!S.jobs.size&&S.view!=='cal'){html+=emptyState();v.innerHTML=html;return}
  html+=S.view==='dash'?dashHTML():S.view==='board'?boardHTML():S.view==='cal'?calHTML():listHTML();
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
  const pipe=open.filter(j=>SIDX[j.stage]>=2).reduce((a,j)=>a+quoteTotals(j).total,0);
  const waiting=open.filter(j=>j.stage==='grid'||j.stage==='inspect');
  const counts=STAGES.map(s=>all.filter(j=>j.stage===s.k).length);const max=Math.max(1,...counts);
  const stale=open.map(j=>({...j,dd:days(j.stageAt)})).filter(j=>j.dd>=7).sort((a,b)=>b.dd-a.dd);
  const feed=all.flatMap(j=>(j.log||[]).map(e=>({...e,id:j.id,name:j.name}))).sort((a,b)=>b.t-a.t).slice(0,8);
  const today=ymd(new Date()),wk=ymd(new Date(Date.now()+7*86400000));const up=allEvents().filter(e=>e.date>=today&&e.date<=wk).slice(0,8);
  const hasDemo=all.some(j=>j.demo);const pf=pmFilterHTML();
  return `${pf?`<div class="tools">${pf}</div>`:''}<div class="kpis">
    <div class="kpi hero"><span class="lbl">งานที่กำลังดำเนินการ</span><span class="v">${open.length}<small>งาน</small></span><span class="s">รวม <span class="num">${fmt1(kwOpen)}</span> kWp รอติดตั้ง/ขนานไฟ</span></div>
    <div class="kpi"><span class="lbl">มูลค่าใบเสนอราคา</span><span class="v">฿${fmt(pipe/1000)}<small>พัน</small></span><span class="s">งานตั้งแต่ขั้นเสนอราคา รวม VAT</span></div>
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
  return `<button class="card" draggable="${S.canWrite}" data-open="${j.id}" data-id="${j.id}">
    <span class="r1"><span class="code">${esc(j.code)}</span>${j.demo?'<span class="tag demo">ตัวอย่าง</span>':''}<span class="sp">${hasLoc(j)?'<svg class="ic" viewBox="0 0 24 24" aria-label="มีตำแหน่ง"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor"/></svg>':''}${vw.length?`<span class="watch" title="มีคนกำลังเปิดดู"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>${vw.length}</span>`:''}${j.stage!=='done'&&dd>=7?`<span class="tag ${dd>=14?'bad':'warn'}">${dd} วัน</span>`:''}</span></span>
    <span class="nm">${esc(j.name)}</span>
    <span class="loc">${esc(j.prov||'ไม่ระบุจังหวัด')} · ${j.util==='MEA'?'กฟน.':'กฟภ.'} · ${j.phase==='3'?'3 เฟส':'1 เฟส'}${j.type==='hybrid'?' · Hybrid':''}</span>
    ${nx?`<span class="next" style="--c:${(APPT[nx.type]||APPT.other)[1]}">${dTH(parseYmd(nx.date))}${nx.time?' '+esc(nx.time):''} · ${esc((APPT[nx.type]||APPT.other)[0])}</span>`:''}
    ${i>=3&&i<8?`<span class="mini" title="เอกสารขออนุญาต ${pp.d}/${pp.n}"><i style="width:${pp.pct}%"></i></span>`:''}
    <span class="r3"><span class="kw">${fmt1(j.kw)} kWp</span><span class="pmw" title="ผู้ดูแลโครงการ: ${esc(pmName(j)||'ยังไม่กำหนด')}">${pmAv(j,'sm')}</span><span class="val">฿${fmt(tot)}</span></span>
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
  ${all.map(j=>{const pp=permitProg(j),ph=photoProg(j);return `<tr data-open="${j.id}"><td class="num">${esc(j.code)}</td><td><b>${esc(j.name)}</b><br><span class="muted num" style="font-size:12.5px">${esc(j.phone)}</span></td><td>${esc(j.prov)}${hasLoc(j)?' <svg class="ic" viewBox="0 0 24 24" aria-label="มีตำแหน่ง"><path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z" fill="currentColor"/></svg>':''}</td><td class="r num">${fmt1(j.kw)} kWp</td><td>${stagePill(j.stage)}</td><td>${esc(pmName(j)||'–')}</td><td class="num">${pp.d}/${pp.n}</td><td class="num">${ph.d}/${ph.n}</td><td class="r num">${fmt(quoteTotals(j).total)}</td><td class="muted">${ago(j.updatedAt)}</td></tr>`}).join('')||`<tr><td colspan="10" class="muted">ไม่พบงานที่ตรงกับตัวกรอง</td></tr>`}
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

/* ---------- drawer ---------- */
let photoUnsub=null;
function watchPhotos(){const want=S.open&&S.tab==='photos'?S.open:null;if(want===S.photoJob)return;
  if(photoUnsub){photoUnsub();photoUnsub=null}S.photos=[];S.photoJob=want;S.photosLoaded=false;if(!want)return;
  photoUnsub=BK.watchWhere('photos','job',want,docs=>{if(S.photoJob!==want)return;S.photos=docs.map(d=>({id:d.id,...d.data})).sort((a,b)=>(a.at||0)-(b.at||0));S.photosLoaded=true;healCounts(want);renderDrawer();renderLightbox()},e=>{console.error(e);S.photosLoaded=true;renderDrawer()})}
function healCounts(id){const j=S.jobs.get(id);if(!j||!S.canWrite)return;const c={};PHOTO_CATS.forEach(([k])=>c[k]=0);S.photos.forEach(p=>{if(c[p.cat]!=null)c[p.cat]++});
  const cur=j.photos||{};if(PHOTO_CATS.some(([k])=>(cur[k]||0)!==c[k]))BK.patch('jobs',id,{photos:c}).catch(()=>{})}
function openDrawer(id,tab){S.open=id;S.tab=tab||'info';$('#drawer').hidden=false;$('#scrim').hidden=false;beat();watchPhotos();renderDrawer(true);$('#drawer .x')?.focus()}
function closeDrawer(){if(!S.open)return;S.open=null;S.lb=null;if(S.mini){S.mini.remove();S.mini=null}$('#drawer').hidden=true;$('#scrim').hidden=true;watchPhotos();renderLightbox();beat()}
function renderDrawer(force){
  const el=$('#drawer');if(!S.open)return;
  const j0=S.jobs.get(S.open);if(!j0){if(S.loaded)closeDrawer();return}
  const ae=document.activeElement;if(!force&&el.contains(ae)&&/INPUT|TEXTAREA|SELECT/.test(ae.tagName)&&ae.type!=='checkbox'&&ae.type!=='file'){S.drawerDirty=true;return}
  S.drawerDirty=false;
  const j={id:S.open,...j0};const i=SIDX[j.stage]??0;const dis=S.canWrite?'':'disabled';
  const bodyScroll=el.querySelector('.d-body')?.scrollTop||0;
  const vIds=[...new Set(viewersOf(j.id).map(p=>p.by))];
  if(S.mini){S.mini.remove();S.mini=null}
  const ph=photoProg(j);
  el.innerHTML=`<div class="d-head">
    <div class="d-top"><div class="t"><div class="code"><span>${esc(j.code)}</span>${j.demo?'<span class="tag demo">ตัวอย่าง</span>':''}<span>อัปเดต ${ago(j.updatedAt)} โดย ${esc(nm(j.updatedBy))}</span></div><h2>${esc(j.name)}</h2>${pmName(j)?`<div class="pmline">${pmAv(j,'sm')}<span>ผู้ดูแลโครงการ: <b>${esc(pmName(j))}</b></span></div>`:''}</div>
    <button class="x" data-act="close" aria-label="ปิด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
    ${vIds.length?`<div class="seen">${vIds.map(id=>av(id,'sm')).join('')}<span>${vIds.map(id=>esc(nm(id))).join(', ')} กำลังเปิดงานนี้อยู่</span></div>`:''}
    <div class="stepper" role="list">${STAGES.map((s,k)=>`<button class="stp ${k<i?'past':k===i?'cur':''}" data-stage="${s.k}" title="${esc(s.t)}" ${dis}><i></i><span>${esc(s.s)}</span></button>`).join('')}</div>
    <div class="stage-row"><span class="now">ขั้นที่ ${i+1}/9 · ${esc(STAGES[i].t)}<small>อยู่ในขั้นนี้ ${days(j.stageAt)} วัน · เริ่ม ${dTH(j.stageAt)}</small></span>
      ${i>0?`<button class="btn sm" data-stage="${STAGES[i-1].k}" ${dis}>← ย้อน</button>`:''}
      ${i<8?`<button class="btn sm pri" data-stage="${STAGES[i+1].k}" ${dis}>ขั้นถัดไป: ${esc(STAGES[i+1].s)} →</button>`:''}</div>
    <div class="tabs" role="tablist">${[['info','ข้อมูล'],['quote','ใบเสนอราคา'],['permit','ขออนุญาต'],['appts',`นัดหมาย${(j.appts||[]).length?` (${j.appts.length})`:''}`],['photos',`รูปถ่าย ${ph.d}/${ph.n}`],['log','ประวัติ']].map(([k,t])=>`<button role="tab" data-tab="${k}" aria-selected="${S.tab===k}">${t}</button>`).join('')}</div>
  </div>
  <div class="d-body">${S.tab==='info'?infoTab(j,dis):S.tab==='quote'?quoteTab(j,dis):S.tab==='permit'?permitTab(j,dis):S.tab==='appts'?apptTab(j,dis):S.tab==='photos'?photoTab(j,dis):logTab(j)}</div>`;
  el.querySelector('.d-body').scrollTop=bodyScroll;
  const at=el.querySelector('.tabs [aria-selected="true"]');if(at){const tb=at.parentElement;if(at.offsetLeft+at.offsetWidth>tb.scrollLeft+tb.clientWidth||at.offsetLeft<tb.scrollLeft)tb.scrollLeft=at.offsetLeft-24}
  if(S.tab==='info')initMini(j);
}
const opt=(arr,v)=>arr.map(([k,t])=>`<option value="${esc(k)}" ${String(v)===String(k)?'selected':''}>${esc(t)}</option>`).join('');
function infoTab(j,dis){
  const pmSel=j.pm||(j.pmName!=null&&j.pmName!==''||j.pmOther?'_other':'');
  return `<div class="roles">
    <div class="owner">${pmAv(j)||'<span class="av ini" style="background:var(--surface-2);color:var(--ink-3)">?</span>'}<span class="who"><small>ผู้ดูแลโครงการ</small>
      <select class="in sel-in" id="f-pm" data-pm="1" ${dis}>${teamOpts(pmSel,true)}</select>${pmSel==='_other'?`<input class="in" id="f-pmname" data-f="pmName" value="${esc(j.pmName)}" placeholder="พิมพ์ชื่อผู้ดูแลโครงการ" ${dis}>`:''}</span></div>
    <div class="owner">${av(j.owner)}<span class="who"><b>${esc(nm(j.owner))}</b><small>ผู้รับงาน / ฝ่ายขาย</small></span>${j.owner!==S.me&&S.me?`<button class="btn sm blue" data-act="claim" ${dis}>รับงานนี้</button>`:''}</div>
  </div>
  <div class="form">
    <div class="fld full"><label for="f-name">ชื่อลูกค้า</label><input class="in" id="f-name" data-f="name" value="${esc(j.name)}" ${dis}></div>
    <div class="fld"><label for="f-phone">เบอร์โทร</label><input class="in num" id="f-phone" data-f="phone" type="tel" value="${esc(j.phone)}" ${dis}></div>
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
    <div class="fld"><label for="f-roof">ชนิดหลังคา</label><select class="in" id="f-roof" data-f="roof" ${dis}>${opt(ROOFS.map(r=>[r,r]),j.roof)}</select></div>
    <div class="fld"><label for="f-created">วันที่รับงาน</label><input class="in" id="f-created" value="${dTH(j.createdAt)}" disabled></div>
    <div class="fld full"><label for="f-note">บันทึกหน้างาน</label><textarea class="in" id="f-note" data-f="note" placeholder="ทิศหลังคา เงาบัง จุดวางอินเวอร์เตอร์ ระยะสายถึงตู้ MDB" ${dis}>${esc(j.note)}</textarea></div>
  </div>
  ${S.canWrite?`<div class="acts"><button class="btn sm danger" data-act="delete">ลบงานนี้</button></div>`:''}`;
}
function initMini(j){const el=$('#minimap');if(!el||!window.L)return;const L=window.L;
  const c=hasLoc(j)?[+j.lat,+j.lng]:[13.75,100.5];const map=L.map(el,{zoomControl:true,attributionControl:false}).setView(c,hasLoc(j)?18:6);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20}).addTo(map);
  const icon=L.divIcon({className:'pin',html:`<span style="--c:#F0661A"><b>●</b></span>`,iconSize:[30,40],iconAnchor:[15,38]});
  let mk=hasLoc(j)?L.marker(c,{icon,draggable:S.canWrite}).addTo(map):null;
  const setLoc=ll=>{saveJob(S.open,{lat:+ll.lat.toFixed(6),lng:+ll.lng.toFixed(6)},'ปักหมุดตำแหน่งหน้างาน')};
  if(mk)mk.on('dragend',()=>setLoc(mk.getLatLng()));
  if(S.canWrite)map.on('click',e=>{if(mk)mk.setLatLng(e.latlng);else{mk=L.marker(e.latlng,{icon,draggable:true}).addTo(map);mk.on('dragend',()=>setLoc(mk.getLatLng()))}setLoc(e.latlng)});
  S.mini=map;setTimeout(()=>{if(S.mini===map)map.invalidateSize()},50)}
function quoteTab(j,dis){const t=quoteTotals(j);const e=estimate(j);const items=j.quote?.items||[];
  return `<div class="stage-row"><span class="now">ใบเสนอราคา ${esc(j.code)}<small>ระบบ ${fmt1(j.kw)} kWp ${j.type==='hybrid'?'Hybrid':'On-Grid'} · ${j.phase==='3'?'3':'1'} เฟส</small></span>
    <select class="in" style="width:auto" id="q-status" data-q="status" ${dis}>${opt([['draft','ร่าง'],['sent','ส่งลูกค้าแล้ว'],['approved','ลูกค้าอนุมัติ'],['rejected','ไม่ผ่าน']],j.quote?.status)}</select></div>
  <div class="tbl-wrap"><table class="qt"><thead><tr><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคา/หน่วย</th><th class="r">รวม</th><th></th></tr></thead><tbody>
  ${items.map((it,k)=>`<tr><td class="c-d"><input class="in" id="qi-${k}-d" data-i="${k}" data-k="d" value="${esc(it.d)}" ${dis}></td><td class="c-q"><input class="in num" id="qi-${k}-q" data-i="${k}" data-k="q" type="number" step="any" value="${esc(it.q)}" ${dis}></td><td class="c-u"><input class="in" id="qi-${k}-u" data-i="${k}" data-k="u" value="${esc(it.u)}" ${dis}></td><td class="c-p"><input class="in num" id="qi-${k}-p" data-i="${k}" data-k="p" type="number" step="any" value="${esc(it.p)}" ${dis}></td><td class="c-a">${fmt((+it.q||0)*(+it.p||0))}</td><td>${S.canWrite?`<button class="rm" data-rm="${k}" aria-label="ลบรายการ">✕</button>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="muted">ยังไม่มีรายการ</td></tr>'}
  </tbody></table></div>
  ${S.canWrite?`<div class="acts"><button class="btn sm" data-act="additem">+ เพิ่มรายการ</button><button class="btn sm blue" data-act="gen">สร้างรายการใหม่จากขนาดระบบ</button></div>`:''}
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
  const jobs=[...S.jobs].filter(([,x])=>x.stage!=='done').sort((a,b)=>a[1].name.localeCompare(b[1].name,'th'));
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
    ${L.length?`<div class="list">${L.map(a=>{const [t,c]=APPT[a.type]||APPT.other;return `<div class="li ev ${a.date<today?'past':''}"><span class="evbar" style="background:${c}"></span><span style="min-width:0"><b>${esc(t)}</b><span class="sub"><span>${dLong(a.date)}</span>${a.time?`<span class="num">${esc(a.time)} น.</span>`:''}${a.who?`<span>${esc(nm(a.who))}</span>`:''}${a.note?`<span class="muted">${esc(a.note)}</span>`:''}</span></span>${S.canWrite?`<button class="rm" data-rmappt="${esc(a.id)}" aria-label="ลบนัด">✕</button>`:''}</div>`}).join('')}</div>`:'<p class="muted" style="margin:0">ยังไม่มีนัดหมาย</p>'}
    ${(g.submit||g.inspect||g.meter)?`<p class="note" style="margin:0">วันจากการไฟฟ้า: ${[g.submit&&'ยื่นคำร้อง '+dTH(parseYmd(g.submit)),g.inspect&&'นัดตรวจ '+dTH(parseYmd(g.inspect)),g.meter&&'เปลี่ยนมิเตอร์ '+dTH(parseYmd(g.meter))].filter(Boolean).join(' · ')} (แก้ไขในแท็บขออนุญาต)</p>`:''}
  </div>
  ${S.canWrite?`<div class="sect"><h3>เพิ่มนัดหมาย</h3>${apptForm('apd',j)}</div>`:''}`}
function photoTab(j,dis){
  const by={};S.photos.forEach(p=>(by[p.cat]=by[p.cat]||[]).push(p));const ready=PHOTO_CATS.filter(([k])=>(by[k]||[]).length).length;
  const pdfOk=S.photos.length&&(BK.kind!=='artifact'||dl);
  return `<div class="stage-row"><span class="now">รูปถ่ายงานติดตั้ง<small>มีรูปแล้ว ${ready}/${PHOTO_CATS.length} หมวด · ${S.photos.length} รูป</small></span>
    <button class="btn pri" data-act="pdf" ${pdfOk?'':'disabled'}>สร้าง PDF รายงานรูปถ่าย</button></div>
  ${!S.photosLoaded?'<p class="muted" style="margin:0">กำลังโหลดรูป…</p>':''}
  <div class="pcats">${PHOTO_CATS.map(([k,t],n)=>{const ps=by[k]||[];return `<section class="pcat ${ps.length?'ok':''}"><div class="pch"><span class="pno num">${n+1}</span><h3>${esc(t)}</h3><span class="count">${ps.length}</span></div>
    <div class="pgrid">${ps.map(p=>`<button class="ph" data-photo="${esc(p.id)}"><img src="${p.data}" alt="${esc(p.cap||t)}" loading="lazy">${p.cap?`<span>${esc(p.cap)}</span>`:''}</button>`).join('')}
    ${S.canWrite?`<label class="phadd"><input type="file" accept="image/*" multiple data-upload="${k}" ${dis}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg><span>เพิ่มรูป</span></label>`:''}</div></section>`}).join('')}</div>
  <p class="note" style="margin:0">รูปถูกย่อขนาดอัตโนมัติก่อนบันทึก บนมือถือกด “เพิ่มรูป” แล้วเลือกถ่ายจากกล้องได้ทันที · แตะรูปเพื่อใส่คำบรรยาย ย้ายหมวด หรือลบ</p>`}
function logTab(j){const L=[...(j.log||[])].reverse();return `<div class="log">${L.map(e=>`<div class="e">${av(e.by,'sm')}<span><b>${esc(nm(e.by))}</b> ${esc(e.m)}<small>${tTH(e.t)}</small></span></div>`).join('')||'<p class="muted">ยังไม่มีประวัติ</p>'}</div>`}

/* ---------- lightbox ---------- */
function renderLightbox(){const m=$('#lightbox');if(!S.lb){m.hidden=true;m.innerHTML='';return}
  const p=S.photos.find(x=>x.id===S.lb);if(!p){S.lb=null;m.hidden=true;m.innerHTML='';return}
  if(m.contains(document.activeElement)&&/INPUT|SELECT/.test(document.activeElement.tagName)&&m.dataset.pid===p.id)return;
  m.dataset.pid=p.id;m.hidden=false;
  m.innerHTML=`<div class="lbbox" role="dialog" aria-label="รูปถ่าย"><img src="${p.data}" alt=""><div class="lbbar"><span class="lbl">${esc(PCAT[p.cat]||'')}</span>
    <input class="in" id="lb-cap" data-cap="${esc(p.id)}" value="${esc(p.cap||'')}" placeholder="คำบรรยายใต้รูป (แสดงใน PDF)" ${S.canWrite?'':'disabled'}>
    <span class="muted" style="font-size:12.5px">${esc(nm(p.by))} · ${tTH(p.at)}</span>
    <div class="acts">${S.canWrite?`<select class="in sel-sm" id="lb-cat" data-movecat="${esc(p.id)}" aria-label="ย้ายหมวด">${PHOTO_CATS.map(([k,t])=>`<option value="${k}" ${k===p.cat?'selected':''}>${esc(t)}</option>`).join('')}</select><button class="btn sm danger" data-delphoto="${esc(p.id)}">ลบรูป</button>`:''}<button class="btn sm" data-act="lbclose">ปิด</button></div></div></div>`}

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
  const newPage=()=>{cv=document.createElement('canvas');cv.width=W;cv.height=H;cx=cv.getContext('2d');pages.push(cv);
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
  const GAP=28,CW=(W-2*M-GAP)/2,IH=420,CAPH=58,CELL=IH+CAPH+18,BOTTOM=H-FOOT-20;
  const imgs={};await Promise.all(S.photos.map(async p=>{try{imgs[p.id]=await loadImg(p.data)}catch{}}));
  const title=(t,n,cont)=>{cx.fillStyle='#0A2350';cx.fillRect(M,y,W-2*M,52);cx.fillStyle='#F0661A';cx.fillRect(M,y,10,52);cx.fillStyle='#fff';cx.font=`600 23px ${FF}`;cx.textBaseline='middle';cx.fillText(`${n}. ${t}${cont?' (ต่อ)':''}`,M+28,y+27);cx.textBaseline='alphabetic';y+=70};
  PHOTO_CATS.forEach(([k,t],n)=>{const ps=by[k]||[];if(!ps.length)return;
    if(y+70+CELL>BOTTOM)newPage();title(t,n+1,false);
    for(let r=0;r<ps.length;r+=2){if(y+CELL>BOTTOM){newPage();title(t,n+1,true)}
      ps.slice(r,r+2).forEach((p,c)=>{const x=M+c*(CW+GAP);cx.fillStyle='#EBF0F9';cx.fillRect(x,y,CW,IH);const im=imgs[p.id];
        if(im){const s=Math.min(CW/im.naturalWidth,IH/im.naturalHeight);const dw=im.naturalWidth*s,dh=im.naturalHeight*s;cx.drawImage(im,x+(CW-dw)/2,y+(IH-dh)/2,dw,dh)}
        cx.strokeStyle='#D9E1EF';cx.lineWidth=2;cx.strokeRect(x,y,CW,IH);
        cx.fillStyle='#0D1A33';const cap=p.cap||`${t} (${r+c+1})`;wrap(cap,CW,`400 19px ${FF}`).slice(0,2).forEach((ln,li)=>cx.fillText(ln,x,y+IH+28+li*24))});
      y+=CELL}
    y+=10});
  pages.forEach((p,i)=>{cv=p;cx=p.getContext('2d');footer(i+1,pages.length)});
  const pdf=new jsPDF({unit:'pt',format:'a4',compress:true});
  pages.forEach((p,i)=>{if(i)pdf.addPage();pdf.addImage(p.toDataURL('image/jpeg',.86),'JPEG',0,0,595.28,841.89)});
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
  <div class="meta"><div><b>ลูกค้า</b><br>${esc(j.name)}<br>${esc(j.addr)} ${esc(j.prov)}<br>โทร ${esc(j.phone)}</div><div><b>ระบบที่เสนอ</b><br>${fmt1(j.kw)} kWp ${j.type==='hybrid'?'Hybrid + แบตเตอรี่':'On-Grid'}<br>มิเตอร์ ${j.phase==='3'?'3':'1'} เฟส · ${j.util==='MEA'?'การไฟฟ้านครหลวง':'การไฟฟ้าส่วนภูมิภาค'}<br>หลังคา ${esc(j.roof||'')}${pmName(j)?`<br>ผู้ดูแลโครงการ ${esc(pmName(j))}`:''}</div></div>
  <table><thead><tr><th>#</th><th>รายการ</th><th class="r">จำนวน</th><th>หน่วย</th><th class="r">ราคา/หน่วย</th><th class="r">จำนวนเงิน</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="tot"><div><span>รวมเป็นเงิน</span><span>${fmt(t.sub)}</span></div>${t.disc?`<div><span>ส่วนลด</span><span>-${fmt(t.disc)}</span></div>`:''}<div><span>ภาษีมูลค่าเพิ่ม 7%</span><span>${fmt(t.vat)}</span></div><div class="g"><span>รวมทั้งสิ้น</span><span>${fmt(t.total)} บาท</span></div></div>
  <div class="note"><b>ประมาณการ:</b> ผลิตไฟราว ${fmt(e.month)} หน่วย/เดือน ประหยัดค่าไฟราว ${fmt(e.monthSave)} บาท/เดือน คืนทุนประมาณ ${e.payback?e.payback.toFixed(1):'–'} ปี (ค่าไฟ ${e.tariff} บาท/หน่วย)<br>
  <b>เงื่อนไข:</b> ราคารวมการออกแบบ วิศวกรรับรอง และดำเนินการขออนุญาตท้องถิ่น แจ้ง กกพ. และยื่นขนานไฟกับการไฟฟ้า · ชำระมัดจำ 50% เมื่ออนุมัติ 40% เมื่อติดตั้งเสร็จ 10% เมื่อการไฟฟ้าเปลี่ยนมิเตอร์ · ใบเสนอราคามีอายุ 30 วัน</div>
  <div class="sign"><div>ผู้เสนอราคา</div><div>ลูกค้าผู้อนุมัติ</div></div>${autoPrint?'<script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script>':''}</body></html>`}
function quoteText(j){const t=quoteTotals(j);const e=estimate(j);return `ใบเสนอราคา SOLARTOUCH ${j.code}
ลูกค้า: ${j.name}
ระบบ: ${fmt1(j.kw)} kWp ${j.type==='hybrid'?'Hybrid':'On-Grid'} ${j.phase==='3'?'3':'1'} เฟส
${(j.quote?.items||[]).map((it,k)=>`${k+1}. ${it.d} × ${fmt1(it.q)} ${it.u} = ${fmt((+it.q||0)*(+it.p||0))}`).join('\n')}
รวมทั้งสิ้น (รวม VAT 7%): ${fmt(t.total)} บาท
ผลิตไฟราว ${fmt(e.month)} หน่วย/เดือน · ประหยัดราว ${fmt(e.monthSave)} บาท/เดือน · คืนทุนราว ${e.payback?e.payback.toFixed(1):'–'} ปี`}
const canDownload=()=>!!BK&&(BK.kind!=='artifact'||!!dl);
async function saveFile(name,data,type){
  if(BK.kind==='artifact'){try{await dl.save({filename:name,data})}catch(e){if(!e||e.code!=='declined')toast('บันทึกไฟล์ไม่สำเร็จ')}return}
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
function printQuote(j){const url=URL.createObjectURL(new Blob([quoteDoc(j,true)],{type:'text/html'}));const w=window.open(url,'_blank');if(!w){saveFile(`ใบเสนอราคา-${j.code}.html`,quoteDoc(j,false),'text/html');toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ จึงดาวน์โหลดไฟล์ให้แทน')}setTimeout(()=>URL.revokeObjectURL(url),60000)}
function csv(){const rows=[['รหัสงาน','ลูกค้า','โทร','จังหวัด','การไฟฟ้า','kWp','ขั้นตอน','ผู้ดูแลโครงการ','เอกสาร','หมวดรูป','มูลค่ารวม VAT','ละติจูด','ลองจิจูด','อัปเดตล่าสุด']];visibleJobs().forEach(j=>{const pp=permitProg(j),ph=photoProg(j);rows.push([j.code,j.name,j.phone,j.prov,j.util,j.kw,STAGES[SIDX[j.stage]].t,pmName(j),`${pp.d}/${pp.n}`,`${ph.d}/${ph.n}`,Math.round(quoteTotals(j).total),hasLoc(j)?j.lat:'',hasLoc(j)?j.lng:'',new Date(j.updatedAt).toISOString()])});return '﻿'+rows.map(r=>r.map(c=>`"${String(c??'').replace(/"/g,'""')}"`).join(',')).join('\n')}
async function copy(txt,okMsg){try{await navigator.clipboard.writeText(txt);toast(okMsg)}catch{const ta=document.createElement('textarea');ta.value=txt;document.body.appendChild(ta);ta.select();try{document.execCommand('copy');toast(okMsg)}catch{toast('คัดลอกไม่สำเร็จ')}ta.remove()}}

/* ---------- modals ---------- */
function modal(title,inner){const m=$('#modal');m.hidden=false;$('#scrim').hidden=false;
  m.innerHTML=`<div class="box" role="dialog" aria-label="${esc(title)}"><div class="mh"><h2>${esc(title)}</h2><button class="x" data-act="mclose" aria-label="ปิด"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>${inner}</div>`}
function openNew(){if(!S.canWrite)return;
  modal('งานติดตั้งใหม่',`<form id="nf"><div class="form">
    <div class="fld full"><label for="n-name">ชื่อลูกค้า</label><input class="in" id="n-name" name="name" required placeholder="คุณ…"></div>
    <div class="fld"><label for="n-phone">เบอร์โทร</label><input class="in" id="n-phone" name="phone" type="tel" placeholder="08x-xxx-xxxx"></div>
    <div class="fld"><label for="n-prov">จังหวัด</label><input class="in" id="n-prov" name="prov" placeholder="เช่น นนทบุรี"></div>
    <div class="fld full"><label for="n-addr">ที่อยู่ติดตั้ง</label><input class="in" id="n-addr" name="addr"></div>
    <div class="fld full"><label for="n-loc">ตำแหน่ง Google Maps (ถ้ามี)</label><input class="in" id="n-loc" name="loc" placeholder="วางลิงก์ Google Maps หรือพิกัด เช่น 13.7563, 100.5018"></div>
    <div class="fld"><label>การไฟฟ้า</label><div class="seg"><label><input type="radio" name="util" value="PEA" checked><span>กฟภ.</span></label><label><input type="radio" name="util" value="MEA"><span>กฟน.</span></label></div></div>
    <div class="fld"><label>มิเตอร์</label><div class="seg"><label><input type="radio" name="phase" value="1" checked><span>1 เฟส</span></label><label><input type="radio" name="phase" value="3"><span>3 เฟส</span></label></div></div>
    <div class="fld"><label>ประเภทระบบ</label><div class="seg"><label><input type="radio" name="type" value="ongrid" checked><span>On-Grid</span></label><label><input type="radio" name="type" value="hybrid"><span>Hybrid</span></label></div></div>
    <div class="fld"><label for="n-kw">ขนาดระบบ (kWp)</label><input class="in num" id="n-kw" name="kw" type="number" step="0.01" min="0.5" value="5" required></div>
    <div class="fld full"><label for="n-pm">ผู้ดูแลโครงการ</label><select class="in" id="n-pm" name="pm">${teamOpts('',true)}</select></div>
    <div class="fld full" id="n-pmname-w" hidden><label for="n-pmname">ชื่อผู้ดูแลโครงการ</label><input class="in" id="n-pmname" name="pmName"></div>
  </div>
  <p class="note" style="margin:0">ระบบจะสร้างรายการใบเสนอราคาเริ่มต้นจากขนาดระบบให้อัตโนมัติ แก้ไขได้ภายหลัง</p>
  <div class="acts" style="justify-content:flex-end"><button type="button" class="btn" data-act="mclose">ยกเลิก</button><button class="btn pri" type="submit">สร้างงาน</button></div></form>`);
  $('#n-name').focus();
  $('#n-pm').addEventListener('change',e=>$('#n-pmname-w').hidden=e.target.value!=='_other');
  $('#nf').addEventListener('submit',async ev=>{ev.preventDefault();const f=Object.fromEntries(new FormData(ev.target));if(f.loc&&!parseLoc(f.loc))toast('บันทึกลิงก์ไว้แล้ว แต่อ่านพิกัดจากลิงก์ย่อไม่ได้ ใส่พิกัดตัวเลขในหน้าข้อมูลงานเพื่อแสดงบนแผนที่');
    const id=rid('j');const j=makeJob(f);closeModal();await createJob(id,j);if(S.view==='dash'||S.view==='team')S.view='board';render();openDrawer(id,'quote');toast('สร้างงาน '+j.code+' แล้ว')});
}
function openApptModal(){if(!S.canWrite)return;modal('เพิ่มนัดหมาย',`<div style="padding:20px">${apptForm('apm',null)}</div>`)}
function closeModal(){$('#modal').hidden=true;$('#modal').innerHTML='';if(!S.open)$('#scrim').hidden=true}
function addAppt(jobId,f){const j=S.jobs.get(jobId);if(!j||!f.date)return;const a={id:rid('a'),date:f.date,time:f.time||'',type:f.type||'other',who:f.who||null,note:f.note||''};
  saveJob(jobId,{appts:[...(j.appts||[]),a]},`เพิ่มนัด${(APPT[a.type]||APPT.other)[0]} ${dTH(parseYmd(a.date))}${a.time?' '+a.time:''}`);toast('บันทึกนัดหมายแล้ว')}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-view],[data-act],[data-open],[data-stage],[data-tab],[data-filter],[data-stagejump],[data-rm],[data-rmmember],[data-cal],[data-day],[data-mapstage],[data-focus],[data-photo],[data-delphoto],[data-rmappt],[data-pmjump]');if(!t)return;
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
  if(a==='new')openNew();
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
  else if(a==='savequote')saveFile(`ใบเสนอราคา-${j.code}.html`,quoteDoc(j,false),'text/html');
  else if(a==='copyquote')copy(quoteText(j),'คัดลอกแล้ว วางในไลน์หรืออีเมลได้เลย');
  else if(a==='csv')saveFile(`solartouch-jobs-${new Date().toISOString().slice(0,10)}.csv`,csv(),'text/csv');
  else if(a==='pdf'){t.disabled=true;photoPDF({id:S.open,...j}).catch(err=>{console.error(err);toast('สร้าง PDF ไม่สำเร็จ')}).finally(()=>{if(t.isConnected)t.disabled=false})}
  else if(a==='mapfit')fitAll();
  else if(a==='geo'){toast('กำลังหาตำแหน่ง…');navigator.geolocation.getCurrentPosition(p=>{saveJob(S.open,{lat:+p.coords.latitude.toFixed(6),lng:+p.coords.longitude.toFixed(6)},'บันทึกตำแหน่งจาก GPS หน้างาน');toast(`บันทึกตำแหน่งแล้ว (แม่นยำ ±${Math.round(p.coords.accuracy)} ม.)`)},err=>toast(err.code===1?'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ตำแหน่งในเบราว์เซอร์':'หาตำแหน่งไม่สำเร็จ'),{enableHighAccuracy:true,timeout:15000})}
});
document.addEventListener('submit',e=>{const f=e.target;
  if(f.id==='addMember'){e.preventDefault();const em=$('#memEmail').value.trim().toLowerCase();if(!em)return;BK.put('members',em,{addedBy:S.me,addedAt:Date.now()}).then(()=>{toast('เพิ่ม '+em+' แล้ว');$('#memEmail').value=''}).catch(writeErr);return}
  if(f.id==='apd'||f.id==='apm'){e.preventDefault();const d=Object.fromEntries(new FormData(f));const jobId=f.id==='apd'?S.open:d.job;addAppt(jobId,d);if(f.id==='apm')closeModal();else{f.reset();S.drawerDirty=false}return}
});
document.addEventListener('change',e=>{const el=e.target;
  if(el.id==='pmFilter'){S.pmFilter=el.value;renderView();return}
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
  if(el.dataset.upload||el.closest('form.apptf'))return;
  if(el.dataset.f){const k=el.dataset.f;let v=el.value;if(k==='kw')v=+v||0;if(j[k]===v)return;const L={name:'ชื่อลูกค้า',phone:'เบอร์โทร',prov:'จังหวัด',addr:'ที่อยู่',util:'การไฟฟ้า',phase:'มิเตอร์',type:'ประเภทระบบ',kw:'ขนาดระบบ',roof:'ชนิดหลังคา',note:'บันทึกหน้างาน',pmName:'ผู้ดูแลโครงการ'};saveJob(id,{[k]:v},k==='pmName'?`กำหนดผู้ดูแลโครงการ: ${v}`:`แก้ไข${L[k]||k}`)}
  else if(el.dataset.pm){const v=el.value;if(v==='_other'){saveJob(id,{pm:null,pmName:j.pmName||'',pmOther:true}).then(()=>renderDrawer(true));return}saveJob(id,{pm:v||null,pmName:'',pmOther:false},v?`กำหนดผู้ดูแลโครงการ: ${nm(v)}`:'ยกเลิกผู้ดูแลโครงการ').then(()=>renderDrawer(true))}
  else if(el.dataset.loc){const v=el.value.trim();const p=parseLoc(v);if(!v){saveJob(id,{lat:null,lng:null,mapUrl:''},'ลบตำแหน่ง');return}
    if(p)saveJob(id,{lat:p.lat,lng:p.lng,mapUrl:/^https?:/.test(v)?v:''},'บันทึกตำแหน่ง Google Maps');
    else{saveJob(id,{mapUrl:/^https?:/.test(v)?v:''},'บันทึกลิงก์ Google Maps');toast('อ่านพิกัดจากลิงก์นี้ไม่ได้ (ลิงก์ย่อ) ปุ่มเปิดใน Google Maps ยังใช้ได้ ถ้าจะแสดงบนแผนที่ให้วางตัวเลขพิกัดแทน')}}
  else if(el.dataset.q){const k=el.dataset.q;let v=el.value;if(k!=='status')v=+v||0;const SL={draft:'ร่าง',sent:'ส่งลูกค้าแล้ว',approved:'ลูกค้าอนุมัติ',rejected:'ไม่ผ่าน'};saveJob(id,{quote:{[k]:v}},k==='status'?`ใบเสนอราคา: ${SL[v]}`:null)}
  else if(el.dataset.i!=null){const items=(j.quote?.items||[]).map(x=>({...x}));const it=items[+el.dataset.i];if(!it)return;it[el.dataset.k]=(el.dataset.k==='q'||el.dataset.k==='p')?(+el.value||0):el.value;saveJob(id,{quote:{items}})}
  else if(el.dataset.doc){const k=el.dataset.doc;const txt=DOCS.flatMap(g=>g.items).find(x=>x[0]===k)[1];saveJob(id,{permits:{[k]:{done:el.checked,at:Date.now(),by:S.me}}},`${el.checked?'✓':'ยกเลิก'} ${txt}`)}
  else if(el.dataset.g){const k=el.dataset.g;const L={ref:'เลขที่คำร้อง',submit:'วันยื่นคำร้อง',inspect:'วันนัดตรวจ',meter:'วันเปลี่ยนมิเตอร์'};saveJob(id,{grid:{[k]:el.value}},`บันทึก${L[k]} ${el.value}`)}
});
$('#drawer').addEventListener('focusout',()=>setTimeout(()=>{if(S.drawerDirty&&!$('#drawer').querySelector('form.apptf')?.contains(document.activeElement))renderDrawer()},0));

let dragId=null;
document.addEventListener('dragstart',e=>{const c=e.target.closest&&e.target.closest('.card');if(!c||!S.canWrite)return;dragId=c.dataset.id;c.classList.add('dragging');e.dataTransfer.effectAllowed='move';try{e.dataTransfer.setData('text/plain',dragId)}catch{}});
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
function onJobs(docs,meta){S.jobs=new Map(docs.map(d=>[d.id,d.data]));S.loaded=true;
  if(BK.kind==='firebase')S.mode=meta&&meta.fromCache&&!navigator.onLine?'offline':'live';
  if(S.open&&!S.jobs.has(S.open))closeDrawer();scheduleRender()}
async function bootDemo(){BK=memoryBackend();S.mode='demo';S.me='demo';
  [['demo','คุณ (โหมดตัวอย่าง)'],['t1','ช่างเอก (ตัวอย่าง)'],['t2','วิศวกรนภา (ตัวอย่าง)']].forEach(([id,n])=>{S.prof[id]={name:n};S.team.add(id)});
  BK.watch('jobs',onJobs);for(const j of demoJobs())await BK.put('jobs',rid('j'),j);
  const jid=[...(await new Promise(r=>{const u=BK.watch('jobs',d=>{u&&u();r(d)})}))].find(d=>d.data.stage==='grid');
  if(jid){const sw=(t,c1,c2)=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,800,600);g.addColorStop(0,c1);g.addColorStop(1,c2);x.fillStyle=g;x.fillRect(0,0,800,600);x.fillStyle='rgba(255,255,255,.92)';x.font='600 40px sans-serif';x.fillText(t,40,560);return c.toDataURL('image/jpeg',.7)};
    [['overview','#1E4FD6','#0A2350','Roof'],['overview','#F0661A','#FFB01F','South array'],['firmware','#0A2350','#46546F','Firmware'],['ct','#11905A','#0A2350','CT clamp'],['tie','#7783A0','#0A2350','MDB'],['combiner','#F0661A','#0A2350','Combiner']].forEach(([c,a,b,t],i)=>BK.put('photos','pd'+i,{job:jid.id,cat:c,data:sw(t+' (sample)',a,b),w:800,h:600,cap:'',at:Date.now()-(10-i)*1000,by:'t1'}))}
  showApp()}
async function bootArtifact(){
  const use=n=>window.claude.use(n).catch(()=>null);
  const [db,user,room,d]=await Promise.all(['db','user','room','downloads'].map(use));
  if(!db){await bootDemo();return}
  dl=d;userCap=user;BK=artifactBackend(db,room);S.mode='live';
  if(user){try{S.me=await user.id();if(S.me)S.team.add(S.me);const cw=await user.can('data.write');if(cw===false)S.canWrite=false;
    user.search('').then(hs=>{hs.forEach(h=>{S.team.add(h.id);S.prof[h.id]={name:h.name,photo:h.avatarUrl}});scheduleRender()}).catch(()=>{})}catch{}}
  BK.watch('jobs',onJobs,err=>{console.error(err);S.loaded=true;S.mode='offline';scheduleRender()});
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
