import React, { useEffect, useMemo, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * HEARTLANDS — v0.7 (Confetti + Hunt/Collected tabs + Finish story page + drag‑to‑simulate)
 * ----------------------------------------------------------------------
 * • Fixed artefacts: visible name, thumbnail, description, marker icons on map
 * • Random artefacts: appear as mystery cards ("?") until collected; circles on map
 * • Cards greyed when not within radius; light up & show a notification dot when nearby
 * • Big centered map (sticky); scrollable cards below; top bar hides on scroll
 * • Simulator is back: toggle on and DRAG the purple pin on the map to move location
 */

// ============================
// Utilities
// ============================
function haversineMeters(a, b) {
  const R = 6371000; // meters
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return R * c;
}
function formatMeters(m) { if (!isFinite(m)) return "—"; if (m < 1000) return `${Math.round(m)} m`; return `${(m/1000).toFixed(2)} km`; }
function mulberry32(seed){ return function(){ let t=(seed+=0x6D2B79F5); t=Math.imul(t^(t>>>15), t|1); t^=t+Math.imul(t^(t>>>7), t|61); return ((t^(t>>>14))>>>0)/4294967296; };}
function seededRandBetween(rng,min,max){ return rng()*(max-min)+min; }
function randomPointsInBBoxSeeded(bbox, n, seed){ const [minLng,minLat,maxLng,maxLat]=bbox; const rng=mulberry32(seed); return Array.from({length:n},(_,i)=>({id:`rnd-${i}-${Math.random().toString(36).slice(2,8)}`, lat:seededRandBetween(rng,minLat,maxLat), lng:seededRandBetween(rng,minLng,maxLng)})); }
function hashCode(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h<<5)-h+str.charCodeAt(i); h|=0; } return Math.abs(h); }

// ============================
// Inline styles (no Tailwind needed)
// ============================
const styles = {
  page: { background:'#0b0b0b', color:'#fafafa', minHeight:'100vh', fontFamily:'ui-sans-serif, system-ui, -apple-system' },
  container: { maxWidth:'1100px', margin:'0 auto', padding:'16px' },
  card: { background:'#121212', border:'1px solid #232323', borderRadius:'16px', padding:'16px' },
  button: { background:'#fff', color:'#000', border:'1px solid #2a2a2a', borderRadius:'12px', padding:'10px 14px', cursor:'pointer' },
  subtle: { color:'#a3a3a3' },
};

// ============================
// Thumbnails & Map Icons
// ============================
function thumb(label){
  const svg = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='160' height='120'>
    <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#1f2937'/><stop offset='100%' stop-color='#111827'/></linearGradient></defs>
    <rect width='100%' height='100%' fill='url(#g)'/>
    <text x='50%' y='55%' dominant-baseline='middle' text-anchor='middle' font-size='28' fill='#e5e7eb' font-family='ui-sans-serif,system-ui'>${label}</text>
  </svg>`);
  return `data:image/svg+xml;utf8,${svg}`;
}
const mysteryThumb = () => thumb('?');

function makeImageIcon(url){
  const html = `
    <div style="transform:translate(-50%,-100%); width:42px; height:42px; border-radius:10px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,.35); border:2px solid #0b0b0b">
      <img src='${url}' style='width:100%;height:100%;object-fit:cover;display:block' />
    </div>`;
  return L.divIcon({ html, className:"", iconSize:[42,42], iconAnchor:[21,40] });
}

const userIcon = L.divIcon({
  html: `<div style='transform:translate(-50%,-50%);width:18px;height:18px;border-radius:999px;background:#22c55e;border:2px solid #064e3b'></div>`,
  className: "",
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const simIcon = L.divIcon({
  html: `<div style='transform:translate(-50%,-50%);width:22px;height:22px;border-radius:999px;background:#7c3aed;border:2px solid #c4b5fd;box-shadow:0 0 0 6px rgba(124,58,237,.25)'></div>`,
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function badgeIcon(text = "COLLECT") {
  const html = `<div style="transform:translate(-50%,-130%);display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:#10b981;border:2px solid #064e3b;color:#062b23;font-weight:800;box-shadow:0 10px 20px rgba(16,185,129,.25);cursor:pointer">
    <span style='display:inline-block;width:10px;height:10px;border-radius:999px;background:#065f46'></span>
    <span style='color:#022c22;letter-spacing:.02em'>${text}</span>
  </div>`;
  return L.divIcon({ html, className: "", iconSize: [80, 28], iconAnchor: [40, 40] });
}

// ============================
// Data
// ============================
const DATA = {
  stacks: [
    {
      id: "jurong",
      name: "Jurong Lake Workers' Garden",
      cover: "/src/assets/Images/jurong cover.jpg",       // 👈 homepage card picture
      desc: "Industrialisation, leisure, and the West's weekend commons.",
      bbox: [103.7240, 1.3310, 103.7370, 1.3445],
      artefacts: [
        { id:"grand-arch", name:"Grand Arch", kind:"fixed", points:10, radiusM:120, coords:{lat:1.3386,lng:103.7300}, img:["/src/assets/Images/arch.png"], images: ["/src/assets/Images/jurong cover.jpg"], blurb:"1975 symbol of Jurong's postcard era — or tool to anchor labour?", history:"Opened 1975 alongside White Rainbow Bridge; amenity for new workers' estates." },
        { id:"double-beauty-bridge", name:"Bridge of Double Beauty", kind:"fixed", points:10, radiusM:120, coords:{lat:1.3369,lng:103.7286}, img:thumb('Double Beauty'), blurb:"Connection celebrated; erasures unmarked.", history:"Later link between Chinese/Japanese islands, echoing classical bridges." },
        { id:"bonsai-chip", name:"Bonsai Garden", kind:"fixed", points:10, radiusM:120, coords:{lat:1.3361,lng:103.7295}, img:thumb('Bonsai'), blurb:"Miniaturised nature as planning metaphor.", history:"Suzhou‑style (1992); living sculpture as control." },
        { id:"cloud-pagoda-sigil", name:"Cloud Pagoda", kind:"fixed", points:10, radiusM:140, coords:{lat:1.3380,lng:103.7306}, img:thumb('Pagoda'), blurb:"View from above; story from below.", history:"Seven‑storey pagoda; Sunday vantage for shift workers." },
        { id:"stoneboat-stamp", name:"Stoneboat", kind:"fixed", points:10, radiusM:120, coords:{lat:1.3375,lng:103.7292}, img:thumb('Stoneboat'), blurb:"A stationary voyage; a scripted journey.", history:"Pavilion once used by ROM; journeys without moving." },
        { id:"seiwaen-token", name:"Japanese Garden (Seiwaen)", kind:"fixed", points:10, radiusM:140, coords:{lat:1.3349,lng:103.7251}, img:thumb('Seiwaen'), blurb:"Cross‑border design in an industrial township.", history:"Opened 1973; tropical reinterpretation in 2024 with lilies & epiphytes." },
        { id:"rnd-shift-siren", name:"Shift Siren", kind:"random", rarity:"rare", points:25, blurb:"Factory shift changes that structured daily life.", spawn:{ bbox:[103.7240,1.3310,103.7370,1.3445], count:3, radiusM:60 } },
        { id:"rnd-mangrove-root", name:"Mangrove Root", kind:"random", rarity:"uncommon", points:15, blurb:"Swamp beneath the pagodas.", spawn:{ bbox:[103.7240,1.3310,103.7370,1.3445], count:4, radiusM:60 } },
        { id:"rnd-jtc-marker", name:"JTC Marker", kind:"random", rarity:"common", points:10, blurb:"Breadcrumbs of the 60s–70s push.", spawn:{ bbox:[103.7240,1.3310,103.7370,1.3445], count:5, radiusM:60 } },
      ],
    },
    {
      id: "civic",
      name: "Civic — Lost Shoreline",
      cover: "/src/assets/Images/cbd cover.jpg",       // 👈 homepage card picture
      desc: "Where land met sea, then policy.",
      bbox: [103.8490, 1.2880, 103.8565, 1.2952],
      artefacts: [
        { id:"esplanade-park-pin", name:"Esplanade Park", kind:"fixed", points:10, radiusM:120, coords:{lat:1.2926,lng:103.8537}, img:thumb('Esplanade'), blurb:"Reclamation layers underfoot.", history:"Phases of 19th/20th‑century reclamation reshaped the coast here." },
        { id:"rnd-sandbag", name:"Shore Sandbag", kind:"random", rarity:"rare", points:30, blurb:"City‑making by earthworks.", spawn:{ bbox:[103.8490,1.2880,103.8565,1.2952], count:3, radiusM:60 } },
        { id:"rnd-sea-glass", name:"Sea Glass", kind:"random", rarity:"uncommon", points:15, blurb:"Tumbled histories from a moved coast.", spawn:{ bbox:[103.8490,1.2880,103.8565,1.2952], count:4, radiusM:60 } },
        { id:"rnd-foreshore", name:"Foreshore Marker", kind:"random", rarity:"common", points:10, blurb:"Where breeze met bureaucracy.", spawn:{ bbox:[103.8490,1.2880,103.8565,1.2952], count:5, radiusM:60 } },
      ],
    },
  ],
};

function enumerateArtefactsForStack(stack){
  const items=[]; for(const a of stack.artefacts.filter(x=>x.kind==='fixed')) items.push(a);
  const seed = hashCode(stack.id);
  for(const tmpl of stack.artefacts.filter(x=>x.kind==='random')){
    const pts = randomPointsInBBoxSeeded(tmpl.spawn.bbox, tmpl.spawn.count, seed + hashCode(tmpl.id));
    for(let i=0;i<pts.length;i++) items.push({ id:`${tmpl.id}-${i}`, name:tmpl.name, kind:'random', rarity:tmpl.rarity, points:tmpl.points, blurb:tmpl.blurb, radiusM:tmpl.spawn.radiusM, coords:{lat:pts[i].lat, lng:pts[i].lng} });
  }
  return items;
}

// ============================
// Local Storage
// ============================
const KEY = "heartlands_progress_v05";
function loadProgress(){ try{ return JSON.parse(localStorage.getItem(KEY)||"{}"); }catch{ return {}; } }
function saveProgress(state){ localStorage.setItem(KEY, JSON.stringify(state)); }

// ============================
// Hide‑on‑scroll Top Bar
// ============================
function useHideOnScroll(){
  const [hidden, setHidden] = useState(false);
  useEffect(()=>{
    let lastY = window.scrollY; let ticking=false;
    function onScroll(){ if(!ticking){ window.requestAnimationFrame(()=>{ const y=window.scrollY; setHidden(y>lastY && y>40); lastY=y; ticking=false; }); ticking=true; } }
    window.addEventListener('scroll', onScroll, { passive:true });
    return ()=> window.removeEventListener('scroll', onScroll);
  },[]);
  return hidden;
}

// ============================
// App
// ============================
export default function App(){
  const [view, setView] = useState({ page:'home', stackId:null });
  const [progress, setProgress] = useState(loadProgress);
  const hidden = useHideOnScroll();

  function onCollect(stackId, artId, points){ const key=`${stackId}:${artId}`; if(progress[key]) return; const next={...progress, [key]:{ when:Date.now(), points }}; setProgress(next); saveProgress(next); }
  function goFinish(stackId){ setView({ page:'finish', stackId }); }
  function resetStackAndHome(stackId){
    const prefix = `${stackId}:`; const next = { ...progress };
    Object.keys(next).forEach(k => { if(k.startsWith(prefix)) delete next[k]; });
    setProgress(next); saveProgress(next); setView({ page:'home', stackId:null });
  }

  return (
    <div style={styles.page}>
      <TopBar hidden={hidden} progress={progress} />
      {view.page==='home' && (
        <Home stacks={DATA.stacks} progress={progress} onPlay={(stackId)=>setView({page:'play', stackId})} />
      )}
      {view.page==='play' && (
        <Play stack={DATA.stacks.find(s=>s.id===view.stackId)} progress={progress} onCollect={onCollect} onBack={()=>setView({page:'home', stackId:null})} onFinish={()=>goFinish(view.stackId)} />
      )}
      {view.page==='finish' && (
        <FinishView stack={DATA.stacks.find(s=>s.id===view.stackId)} progress={progress} onDownloadDone={()=>{}} onReset={()=>resetStackAndHome(view.stackId)} onBack={()=>setView({page:'play', stackId:view.stackId})} />
      )}
    </div>
  );
}

function TopBar({ hidden, progress }){
  const score = Object.values(progress).reduce((a,v)=>a+(v.points||0),0);
  return (
    <div style={{ position:'sticky', top:0, zIndex:20, transform:`translateY(${hidden?-60:0}px)`, transition:'transform .25s ease', backdropFilter:'blur(6px)', background:'rgba(11,11,11,.7)', borderBottom:'1px solid #1f1f1f' }}>
      <div style={{ ...styles.container, padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontWeight:700, letterSpacing:'0.02em' }}>HEARTLANDS</div>
        <div style={{ fontSize:14 }}>Score: <span style={{ fontFamily:'ui-monospace, SFMono-Regular', fontWeight:700 }}>{score}</span></div>
      </div>
    </div>
  );
}

// ============================
// HOME — Stacks with thumbnails
// ============================
function Home({ stacks, progress, onPlay }){
  // helpers: derive cover + intro if not provided
  const coverFor = (s) => s.cover || (s.artefacts.find(a=>a.kind==='fixed')?.images) || thumb(s.name);
  const introFor = (s) => s.intro || (
    s.id === 'jurong' ? "A workers' commons: pagodas and bridges beside shift sirens, bonsai control, and industrial housing stories." :
    s.id === 'civic' ? "Trace Singapore's lost shoreline: reclamation layers, foreshore markers, and sea-glass fragments of policy." :
    s.desc
  );

  return (
    <>
      {/* HERO */}
      <section style={{ ...styles.container, paddingTop:28 }}>
        <div style={{
          borderRadius:20, overflow:'hidden', border:'1px solid #232323',
          background:'linear-gradient(135deg, #0f172a 0%, #111827 50%, #0b0b0b 100%)'
        }}>
          <div style={{ padding:'28px 24px 22px 24px' }}>
            <h1 style={{ fontSize:40, lineHeight:1.05, fontWeight:900, letterSpacing:'-0.01em', marginBottom:10 }}>Walk. Collect. Argue with the city.</h1>
            <p style={{ ...styles.subtle, fontSize:16, maxWidth:860 }}>
              Heartlands is a self‑guided, item‑collecting walking game. Discover official landmarks and their alternative readings.
              Hunt mystery circles for rarer artefacts. Share your stamp sheet when you’re done.
            </p>
            <div style={{ marginTop:14 }}>
              <a href="#stacks" style={{ ...styles.button }}>Choose a stack ↓</a>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ ...styles.container, paddingTop:18, paddingBottom:6 }}>
        <div style={{ display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <HowItWorksStep n={1} title="Pick a stack" text="Each area has fixed icons (known sites) and random circles (mystery spawns)." />
          <HowItWorksStep n={2} title="Walk & hunt" text="Use the map. Fixed icons are visible; randoms appear as search radii. Get close to collect." />
          <HowItWorksStep n={3} title="Collect & share" text="Cards reveal context and debate prompts. Finish to export an Instagram story." />
        </div>
      </section>

      {/* STACK CARDS */}
      <section id="stacks" style={{ ...styles.container, paddingTop:8, paddingBottom:24 }}>
        <div style={{ display:'grid', gap:16, gridTemplateColumns:'repeat(auto-fill, minmax(300px,1fr))' }}>
          {stacks.map((s)=>{
            const all = enumerateArtefactsForStack(s);
            const collected = all.filter(a=>progress[`${s.id}:${a.id}`]);
            const totalPts = all.reduce((a,v)=>a+v.points,0); const gotPts = collected.reduce((a,v)=>a+v.points,0);
            const cover = coverFor(s);
            const intro = introFor(s);
            return (
              <div key={s.id} style={{ ...styles.card, padding:0, overflow:'hidden' }}>
                <div style={{ position:'relative', height:170, borderBottom:'1px solid #232323' }}>
                  <img src={cover} alt={s.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block', filter:'contrast(1.05) saturate(1.02)' }} />
                  <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(0,0,0,.0) 0%, rgba(0,0,0,.35) 65%, rgba(0,0,0,.55) 100%)' }} />
                  <div style={{ position:'absolute', left:14, bottom:12, fontWeight:800, fontSize:18 }}>{s.name}</div>
                </div>
                <div style={{ padding:16 }}>
                  <p style={{ ...styles.subtle, fontSize:14, marginBottom:10 }}>{intro}</p>
                  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10 }}>
                    <div style={{ ...styles.subtle, fontSize:12 }}>{collected.length}/{all.length} items • {gotPts}/{totalPts} pts</div>
                    <button style={{ ...styles.button }} onClick={()=>onPlay(s.id)}>Play</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function HowItWorksStep({ n, title, text }){
  return (
    <div style={{ ...styles.card }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
        <div style={{ width:26, height:26, borderRadius:8, background:'#fff', color:'#000', fontWeight:800, display:'grid', placeItems:'center' }}>{n}</div>
        <div style={{ fontWeight:700 }}>{title}</div>
      </div>
      <div style={{ ...styles.subtle, fontSize:14 }}>{text}</div>
    </div>
  );
}

// ============================
// PLAY — Centered sticky map + scrollable cards + drag-to-sim + tabs + Finish
// ============================
function Play({ stack, progress, onCollect, onBack, onFinish }){
  const [gpsLoc, setGpsLoc] = useState(null); // real GPS
  const [simLoc, setSimLoc] = useState(null); // simulated (drag pin)
  const [simOn, setSimOn] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState('hunt'); // 'hunt' | 'collected'
  const [modalA, setModalA] = useState(null); // artefact for detail modal

  // Confetti canvas over the map (so map-collect pops confetti)
  const mapConfettiRef = useRef(null);


  const allItems = useMemo(()=> enumerateArtefactsForStack(stack), [stack]);
  const fixedItems = allItems.filter(a=>a.kind==='fixed');
  const randomItems = allItems.filter(a=>a.kind==='random');

  useEffect(()=>{
    if(!('geolocation' in navigator)){ setError('Geolocation not supported.'); return; }
    const id = navigator.geolocation.watchPosition(
      (pos)=>{ const { latitude, longitude, speed } = pos.coords; if(speed!=null && speed>=5) return; setGpsLoc({ lat:latitude, lng:longitude, speed:speed??0 }); },
      (err)=> setError(err.message||'Location error'),
      { enableHighAccuracy:true, maximumAge:5000, timeout:10000 }
    );
    return ()=> navigator.geolocation.clearWatch(id);
  },[]);

  const effective = simOn && simLoc ? simLoc : gpsLoc;

  const withDist = useMemo(()=> allItems.map(a=>({ a, d: effective ? haversineMeters(effective, a.coords) : Infinity })), [allItems, effective]);
  const collectedSet = useMemo(()=> new Set(Object.keys(progress).filter(k=>k.startsWith(stack.id+':')).map(k=>k.split(':')[1])), [progress, stack.id]);
  const huntList = withDist.filter(({a})=> !collectedSet.has(a.id)).sort((p,q)=>p.d-q.d);
  const collectedList = withDist.filter(({a})=> collectedSet.has(a.id)).sort((p,q)=> (progress[`${stack.id}:${q.a.id}`]?.when||0) - (progress[`${stack.id}:${p.a.id}`]?.when||0));

  const withinIds = useMemo(()=> new Set(withDist.filter(({a,d})=> d <= (a.radiusM||80)).map(x=>x.a.id)), [withDist]);

  const totals = useMemo(()=>{
    const totalPts = allItems.reduce((s,x)=>s+x.points,0);
    const got = allItems.filter(a=>progress[`${stack.id}:${a.id}`]);
    const gotPts = got.reduce((s,a)=>s+a.points,0);
    return { totalItems: allItems.length, gotItems: got.length, totalPts, gotPts };
  }, [allItems, progress, stack.id]);

  function actuallyCollect(a){ onCollect(stack.id, a.id, a.points); }
  function mapAttemptCollect(a){
    if(!effective) return; const d = haversineMeters(effective, a.coords); const r = a.radiusM||80; if(d<=r){
      // Confetti over the map when collecting via badge/pin
      runConfetti(mapConfettiRef.current);
      actuallyCollect(a);
      setTimeout(()=> { setModalA(a); }, 750); } }
  function cardAttemptCollect(a){ if(!effective) return; const d=haversineMeters(effective,a.coords); const r=a.radiusM||80; if(d<=r){ actuallyCollect(a); setModalA(a); } }

  return (
    <section style={{ ...styles.container, paddingTop:16, paddingBottom:24 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
        <button onClick={onBack} style={{ ...styles.button, background:'#0b0b0b', color:'#e5e5e5' }}>← Back</button>
        <h2 style={{ fontWeight:800, fontSize:22 }}>{stack.name}</h2>
        <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
          <div style={{ ...styles.subtle, fontSize:12 }}>{totals.gotItems}/{totals.totalItems} items • {totals.gotPts}/{totals.totalPts} pts</div>
          <button onClick={onFinish} style={{ ...styles.button }}>Finish</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr min(980px, 94vw) 1fr', gap:16 }}>
        <div style={{ gridColumn:'2' }}>
          <div style={{ position:'sticky', top:'calc(50vh - 40vh)', height:'80vh', zIndex:10, borderRadius:16, overflow:'hidden', border:'1px solid #2a2a2a' }}>
            <div style={{ position:'relative', width:'100%', height:'100%' }}>
              <MapBox
                stack={stack}
                fixedItems={fixedItems}
                randomItems={randomItems}
                userLoc={effective}
                gpsLoc={gpsLoc}
                simOn={simOn}
                simLoc={simLoc}
                setSimLoc={setSimLoc}
                collectedSet={collectedSet}
                withinIds={withinIds}
                onCollectFromMap={mapAttemptCollect}
              />
              {/* Confetti overlay for map collects */}
              <canvas ref={mapConfettiRef} width={800} height={600} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:800, zIndex:800 }} />
            </div>
          </div>

          {/* Map toolbar */}
          <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ ...styles.subtle, fontSize:13 }}>
              {effective ? (
                <>You: <span style={{fontFamily:'ui-monospace,SFMono-Regular'}}>{effective.lat?.toFixed(5)}, {effective.lng?.toFixed(5)}</span>{effective.speed?` • ${effective.speed.toFixed(1)} m/s`:''}</>
              ) : (error ? <span style={{ color:'#ef4444' }}>{error}</span> : 'Allow location (HTTPS on iOS) for blue dot & distances.')}
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:8 }}>
              <button onClick={()=>setSimOn(v=>!v)} style={{ ...styles.button, background: simOn?'#7c3aed':'#111', color:'#fff', borderColor:'#5b21b6' }}>{simOn? 'Sim ON (drag pin)':'Sim OFF'}</button>
              <button onClick={()=>{ setSimOn(false); setSimLoc(null); }} style={{ ...styles.button, background:'#111', color:'#e5e5e5' }}>Use GPS</button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ marginTop:18 }}>
        <div style={{ display:'inline-flex', background:'#111', border:'1px solid #2a2a2a', borderRadius:12, overflow:'hidden' }}>
          <button onClick={()=>setTab('hunt')} style={{ padding:'8px 14px', fontWeight:600, color: tab==='hunt'? '#000':'#e5e5e5', background: tab==='hunt'? '#fff':'transparent', borderRight:'1px solid #2a2a2a' }}>Hunt ({huntList.length})</button>
          <button onClick={()=>setTab('collected')} style={{ padding:'8px 14px', fontWeight:600, color: tab==='collected'? '#000':'#e5e5e5', background: tab==='collected'? '#fff':'transparent' }}>Collected ({collectedList.length})</button>
        </div>
      </div>

      {/* Cards list */}
      <div style={{ marginTop:12 }}>
        <div style={{ display:'grid', gap:12 }}>
          {(tab==='hunt' ? huntList : collectedList).map(({a,d})=> (
            <ArtefactCard key={a.id} a={a} d={d} collected={!!progress[`${stack.id}:${a.id}`]} onCollect={()=>cardAttemptCollect(a)} onOpenModal={()=>setModalA(a)} />
          ))}
        </div>
      </div>

      {/* Modal overlay for rich detail */}
      <ArtefactModal open={!!modalA} a={modalA} onClose={()=>setModalA(null)} />
    </section>
  );
}

function MapBox({ stack, fixedItems, randomItems, userLoc, gpsLoc, simOn, simLoc, setSimLoc, collectedSet, withinIds, onCollectFromMap }){
  const center = fixedItems[0]?.coords || { lat: stack.bbox[1], lng: stack.bbox[0] };
  const mapRef = useRef(null);

  return (
    <MapContainer whenCreated={(m)=>mapRef.current=m} center={[center.lat, center.lng]} zoom={16} style={{ height:'100%', width:'100%' }} scrollWheelZoom>
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

      {/* Fixed artefacts with photo icons. If within & not collected, show a COLLECT badge. */}
      {fixedItems.map(f => (
        <React.Fragment key={f.id}>
          <Marker position={[f.coords.lat, f.coords.lng]} icon={makeImageIcon(f.img || thumb(f.name))} />
          {withinIds.has(f.id) && !collectedSet.has(f.id) && (
            <Marker position={[f.coords.lat, f.coords.lng]} icon={badgeIcon('COLLECT')} eventHandlers={{ click: ()=> onCollectFromMap(f) }} />
          )}
        </React.Fragment>
      ))}

      {/* Random spawns as radii; when within and not collected, show a temporary mystery icon + badge. */}
      {randomItems.map(r => (
        <React.Fragment key={r.id}>
          <Circle center={[r.coords.lat, r.coords.lng]} radius={r.radiusM || 60} pathOptions={{ color:'#9ca3af', weight:1, opacity:0.7, fillOpacity:0.08 }} />
          {withinIds.has(r.id) && !collectedSet.has(r.id) && (
            <>
              <Marker position={[r.coords.lat, r.coords.lng]} icon={makeImageIcon(thumb('?'))} />
              <Marker position={[r.coords.lat, r.coords.lng]} icon={badgeIcon('COLLECT')} eventHandlers={{ click: ()=> onCollectFromMap(r) }} />
            </>
          )}
        </React.Fragment>
      ))}

      {/* User / Sim markers */}
      {gpsLoc && !simOn && <Marker position={[gpsLoc.lat, gpsLoc.lng]} icon={userIcon} />}
      {simOn && (
        <Marker
          position={[ (simLoc?.lat ?? center.lat), (simLoc?.lng ?? center.lng) ]}
          draggable={true}
          icon={simIcon}
          eventHandlers={{ dragend: (e)=>{ const ll=e.target.getLatLng(); setSimLoc({ lat: ll.lat, lng: ll.lng, speed:0 }); } }}
        />
      )}

      <Recenter userLoc={userLoc || simLoc || gpsLoc} />
    </MapContainer>
  );
}

function Recenter({ userLoc }){ const map = useMap(); useEffect(()=>{ if(userLoc) map.setView([userLoc.lat, userLoc.lng]); },[userLoc, map]); return null; }

// ============================
// Artefact Card (mystery randoms, proximity glow, confetti)
// ============================
function ArtefactCard({ a, d, collected, onCollect, onOpenModal }){
  const [open, setOpen] = useState(false);
  const [burst, setBurst] = useState(false);
  const canvasRef = useRef(null);

  a.__open = () => setOpen(true);
  a.__celebrate = () => { setBurst(true); setTimeout(()=>setBurst(false), 900); runConfetti(canvasRef.current); };

  const radius = a.radiusM || 80; const within = d <= radius; const isFixed = a.kind==='fixed';
  const reveal = isFixed || collected;
  const nearby = within && !collected;

  const base = { ...styles.card, position:'relative', transition:'box-shadow .2s, border-color .2s, opacity .2s' };
  const vibe = nearby ? { boxShadow:'0 0 0 3px rgba(34,197,94,.35)', border:'1px solid #22c55e' } : (!within && !collected ? { opacity:.55 } : {});

  function handleCollect(){ if(within && !collected){ a.__celebrate && a.__celebrate(); setOpen(true); setTimeout(()=>{ onCollect(); onOpenModal && onOpenModal(); }, 650); } }

  return (
    <article style={{ ...base, ...vibe }}>
      <canvas ref={canvasRef} width={600} height={180} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {nearby && (<span style={{ position:'absolute', top:10, right:10, width:10, height:10, background:'#f59e0b', borderRadius:9999, boxShadow:'0 0 0 6px rgba(245,158,11,.15)' }} />)}

      <div style={{ display:'flex', gap:12 }}>
        <div style={{ width:88, height:66, borderRadius:12, overflow:'hidden', border:'1px solid #2a2a2a' }}>
          <img src={(reveal ? (a.img || thumb(a.name)) : thumb('?'))} alt={reveal ? a.name : 'Unknown'} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block', filter: reveal ? 'none' : 'grayscale(1) brightness(.8)' }} />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:8 }}>
            <h4 style={{ fontWeight:600 }}>{reveal ? a.name : 'Unknown artefact'} {reveal && a.rarity && <span style={{...styles.subtle, fontSize:12, marginLeft:6}}>{a.rarity}</span>}</h4>
            <div style={{ ...styles.subtle, fontSize:12 }}>{formatMeters(d)} • r{radius} • {a.points} pts</div>
          </div>
          <p style={{ ...styles.subtle, fontSize:14, marginTop:4 }}>{reveal ? (a.blurb || '') : 'Find & collect to reveal details.'}</p>
          <div style={{ marginTop:8, display:'flex', gap:8 }}>
            <button onClick={()=> onOpenModal && reveal && onOpenModal()} disabled={!reveal} style={{ ...styles.button, background:'#111', color:'#e5e5e5', opacity: reveal ? 1 : .6 }}>More info</button>
            <button onClick={handleCollect} disabled={!within || collected} style={{ ...styles.button, opacity:(!within||collected)?0.6:1 }}>{collected ? 'Collected' : within ? 'Collect' : 'Go closer'}</button>
          </div>
        </div>
      </div>

      
    </article>
  );
}

// Simple confetti animation (no libs)
function runConfetti(canvas){ if(!canvas) return; const ctx=canvas.getContext('2d'); const W=canvas.width=canvas.offsetWidth; const H=canvas.height=canvas.offsetHeight; const N=40; const parts=Array.from({length:N},()=>({ x:Math.random()*W, y:-10, r:4+Math.random()*4, vx:-2+Math.random()*4, vy:2+Math.random()*3, a:Math.random()*Math.PI, s:0.02+Math.random()*0.04, c:`hsl(${Math.floor(Math.random()*360)},90%,60%)` })); let t=0; let raf; function step(){ t+=16; ctx.clearRect(0,0,W,H); parts.forEach(p=>{ p.a+=p.s; p.x+=p.vx; p.y+=p.vy; p.vy+=0.05; ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.a); ctx.fillStyle=p.c; ctx.fillRect(-p.r/2,-p.r/2,p.r,p.r); ctx.restore(); }); if(t<1000) raf=requestAnimationFrame(step); else { ctx.clearRect(0,0,W,H); cancelAnimationFrame(raf); } } step(); }

// ============================
// MODAL — Fullscreen detail with images & links
// ============================
function ArtefactModal({ open, a, onClose }){
  if(!open || !a) return null;
  const imgs = a.images && a.images.length ? a.images : [a.img || thumb(a.name)];
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:50, display:'grid', placeItems:'center' }}>
      <div style={{ width:'min(920px, 94vw)', maxHeight:'86vh', overflow:'auto', background:'#0d0d0d', border:'1px solid #232323', borderRadius:16 }}>
        <div style={{ padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #1f1f1f' }}>
          <div style={{ fontWeight:800 }}>{a.name || 'Artefact'}</div>
          <button onClick={onClose} style={{ ...styles.button, background:'#111', color:'#e5e5e5' }}>✕</button>
        </div>
        <div style={{ padding:16 }}>
          {/* Images */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(180px,1fr))', gap:10 }}>
            {imgs.map((src,i)=> (
              <div key={i} style={{ borderRadius:12, overflow:'hidden', border:'1px solid #242424', height:160 }}>
                <img src={src} alt={a.name} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} />
              </div>
            ))}
          </div>
          {/* Text */}
          {a.blurb && <p style={{ ...styles.subtle, fontSize:15, marginTop:12 }}>{a.blurb}</p>}
          {a.history && (
            <div style={{ marginTop:12 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>History & context</div>
              <div style={{ color:'#e5e5e5', fontSize:14 }}>{a.history}</div>
            </div>
          )}
          {/* Links */}
          {Array.isArray(a.links) && a.links.length>0 && (
            <div style={{ marginTop:12 }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>Further reading</div>
              <ul style={{ paddingLeft:18, lineHeight:1.6 }}>
                {a.links.map((l,i)=> (
                  <li key={i}><a href={l.href} target="_blank" rel="noreferrer" style={{ color:'#93c5fd' }}>{l.title || l.href}</a></li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================
// FINISH VIEW — Instagram story style grid + reset
// ============================
function FinishView({ stack, progress, onDownloadDone, onReset, onBack }){
  const all = enumerateArtefactsForStack(stack);
  const collected = all.filter(a=>progress[`${stack.id}:${a.id}`]);
  const totals = { totalItems: all.length, gotItems: collected.length, totalPts: all.reduce((s,x)=>s+x.points,0), gotPts: collected.reduce((s,x)=>s+x.points,0) };

  async function downloadStory(){
    const canvas = document.createElement('canvas'); canvas.width=1080; canvas.height=1920; const ctx=canvas.getContext('2d');
    // bg
    const g = ctx.createLinearGradient(0,0,0,1920); g.addColorStop(0,'#0f172a'); g.addColorStop(1,'#111827'); ctx.fillStyle=g; ctx.fillRect(0,0,1080,1920);
    // headings
    ctx.fillStyle='#fff'; ctx.font='700 64px ui-sans-serif,system-ui'; ctx.fillText('HEARTLANDS',64,140);
    ctx.font='600 50px ui-sans-serif,system-ui'; ctx.fillText(stack.name,64,220);
    ctx.font='400 36px ui-sans-serif,system-ui'; ctx.fillText(`${totals.gotItems}/${totals.totalItems} items • ${totals.gotPts}/${totals.totalPts} pts`,64,280);
    // grid of stamps
    const cols=5, gap=14, cell=180; const gridW=cols*cell+(cols-1)*gap; let x0=(1080-gridW)/2, y0=340; let i=0;
    const imgs = await Promise.all(collected.map(async a=>{ const src=a.img || thumb(a.name); const img=new Image(); img.crossOrigin='anonymous'; img.src=src; await img.decode().catch(()=>{}); return { img, a }; }));
    for(const {img,a} of imgs){ const cx=x0+(i%cols)*(cell+gap); const cy=y0+Math.floor(i/cols)*(cell+gap); ctx.fillStyle='rgba(255,255,255,0.08)'; ctx.fillRect(cx,cy,cell,cell); try{ ctx.drawImage(img,cx,cy,cell,cell); }catch{} ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=2; ctx.strokeRect(cx+2,cy+2,cell-4,cell-4); i++; }
    // footer
    ctx.fillStyle='rgba(255,255,255,0.75)'; ctx.font='400 28px ui-sans-serif,system-ui'; ctx.fillText('Walk. Collect. Argue with the city.',64,1860);

    const url = canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download=`heartlands-${stack.id}-story.png`; a.click(); onDownloadDone && onDownloadDone();
  }

  return (
    <section style={{ ...styles.container, paddingTop:24, paddingBottom:24 }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
        <button onClick={onBack} style={{ ...styles.button, background:'#0b0b0b', color:'#e5e5e5' }}>← Back</button>
        <h2 style={{ fontWeight:800, fontSize:22 }}>Finish — {stack.name}</h2>
        <div style={{ marginLeft:'auto', ...styles.subtle, fontSize:12 }}>{totals.gotItems}/{totals.totalItems} items • {totals.gotPts}/{totals.totalPts} pts</div>
      </div>

      <div style={{ ...styles.card }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px,1fr))', gap:12 }}>
          {collected.map(a=> (
            <div key={a.id} style={{ border:'1px solid #2a2a2a', borderRadius:12, overflow:'hidden' }}>
              <img src={a.img || thumb(a.name)} alt={a.name} style={{ width:'100%', height:140, objectFit:'cover', display:'block' }} />
              <div style={{ padding:'8px 10px', fontSize:13 }}>{a.name}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop:14, ...styles.subtle, fontSize:13 }}>{collected.length} collected • {totals.gotPts} pts</div>
        <div style={{ marginTop:12, display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={downloadStory} style={{ ...styles.button }}>Download Story</button>
          <button onClick={onReset} style={{ ...styles.button, background:'#111', color:'#e5e5e5' }}>Return Home & Reset</button>
        </div>
      </div>
    </section>
  );
}




