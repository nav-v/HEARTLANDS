import React, { useEffect, useMemo, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default markers in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

/**
 * HEARTLANDS — v0.8
 * ----------------------------------------------------------------------
 * • Fixed artefacts: visible name, thumbnail, description, marker icons on map
 * • Random artefacts: appear as mystery cards ("?") until collected; circles on map
 * • Cards greyed when not within radius; light up & show a notification dot when nearby
 * • Big centered map (sticky); scrollable cards below; top bar hides on scroll
 * • Simulator: toggle on and DRAG the purple pin on the map to move location
 * • GPS heading arrow + optional compass permission on iOS
 * • Tap fixed icon → shows a white label ABOVE the icon with an arrow; arrow opens info card
 * • No auto‑recentering while you pan; a "Center" button does a one‑shot recenter
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

// Generate a random point within a circular radius from a center point
function generateRandomPointInRadius(centerLat, centerLng, radiusMeters) {
  // Convert radius from meters to degrees (approximate)
  const radiusDegrees = radiusMeters / 111000; // 1 degree ≈ 111km
  
  // Generate random angle and distance
  const angle = Math.random() * 2 * Math.PI;
  const distance = Math.sqrt(Math.random()) * radiusDegrees; // Square root for uniform distribution
  
  // Calculate new coordinates
  const lat = centerLat + (distance * Math.cos(angle));
  const lng = centerLng + (distance * Math.sin(angle));
  
  return { lat, lng };
}

// Generate a seeded random point within a circular radius from a center point
function generateRandomPointInRadiusSeeded(centerLat, centerLng, radiusMeters, seed) {
  // Convert radius from meters to degrees (approximate)
  const radiusDegrees = radiusMeters / 111000; // 1 degree ≈ 111km
  
  // Use seeded random generator
  const rng = mulberry32(seed);
  
  // Generate random angle and distance
  const angle = rng() * 2 * Math.PI;
  const distance = Math.sqrt(rng()) * radiusDegrees; // Square root for uniform distribution
  
  // Calculate new coordinates
  const lat = centerLat + (distance * Math.cos(angle));
  const lng = centerLng + (distance * Math.sin(angle));
  
  return { lat, lng };
}

// Generate a user-specific random point within a circular radius
function generateUserSpecificRandomPoint(centerLat, centerLng, radiusMeters, itemId, userId) {
  // Create a unique seed combining item ID and user ID
  const combinedSeed = hashCode(itemId + '_' + userId);
  return generateRandomPointInRadiusSeeded(centerLat, centerLng, radiusMeters, combinedSeed);
}
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
// Thumbnails, Asset Helper & Map Icons
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

// Ensure images work both locally and on GitHub Pages (/HEARTLANDS/ base)
function asset(p){
  if(!p) return p;
  if(/^data:/.test(p) || /^https?:\/\//.test(p)) return p;
  return `${import.meta.env.BASE_URL}${p.replace(/^\/+/, '')}`;
}

function makeImageIcon(url){
  const html = `
    <div style="width:42px; height:42px; border-radius:10px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,.35)">
      <img src='${asset(url)}' style='width:100%;height:100%;object-fit:cover;display:block' />
    </div>`;
  return L.divIcon({ html, className:"", iconSize:[42,42], iconAnchor:[21,21] });
}

function makeLandmarkIcon(url, name){
  const html = `
    <div style="text-align:center; width:100%;">
      <div style="width:42px; height:42px; overflow:hidden; margin:0 auto;">
        <img src='${asset(url)}' style='width:100%;height:100%;object-fit:cover;display:block' />
      </div>
      <div style="margin-top:4px; font-size:11px; font-weight:600; color:#333; text-shadow:0 1px 2px rgba(255,255,255,0.8); background:rgba(255,255,255,0.9); padding:2px 8px; border-radius:4px; border:1px solid rgba(0,0,0,0.1); display:inline-block; max-width:80px; word-wrap:break-word; text-align:center; line-height:1.2;">
        ${name}
      </div>
    </div>`;
  return L.divIcon({ html, className:"", iconSize:[60,60], iconAnchor:[30,30] });
}

// User and sim pins - pulsing dot with compass direction
function userIconWithHeading(deg){
  const rot = (typeof deg === 'number' && !Number.isNaN(deg)) ? deg : 0;
  const html = `
    <div style='position:relative;'>
      <!-- Outer ring that rotates with compass -->
      <div style='
        width:40px;height:40px;border-radius:999px;
        border:2px solid rgba(0,122,255,0.3);
        position:absolute;left:4px;top:4px;
        transform:rotate(${rot}deg);
        transition:transform 0.2s ease-out;
        transform-origin:center center;
      '>
        <!-- Direction indicator dot on the ring -->
        <div style='
          width:6px;height:6px;border-radius:999px;
          background:#007AFF;
          position:absolute;left:17px;top:-3px;
          box-shadow:0 0 8px rgba(0,122,255,0.8);
        '></div>
      </div>
      <!-- Inner pulsing blue circle -->
      <div style='
        width:20px;height:20px;border-radius:999px;
        background:#007AFF;border:3px solid #fff;
        box-shadow:0 0 0 4px rgba(0,122,255,0.3), 0 0 20px rgba(0,122,255,0.5);
        position:absolute;left:14px;top:14px;
        animation:pulse 2s infinite;
      '></div>
    </div>
    <style>
      @keyframes pulse {
        0% { box-shadow: 0 0 0 4px rgba(0,122,255,0.3), 0 0 20px rgba(0,122,255,0.5); }
        50% { box-shadow: 0 0 0 8px rgba(0,122,255,0.1), 0 0 30px rgba(0,122,255,0.3); }
        100% { box-shadow: 0 0 0 4px rgba(0,122,255,0.3), 0 0 20px rgba(0,122,255,0.5); }
      }
    </style>`;
  return L.divIcon({ html, className:"", iconSize:[48,48], iconAnchor:[24,24] });
}

const simIcon = L.divIcon({
  html: `<div style='transform:translate(-50%,-50%);width:22px;height:22px;border-radius:999px;background:#7c3aed;border:2px solid #c4b5fd;box-shadow:0 0 0 6px rgba(124,58,237,.25)'></div>`,
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function badgeIcon(text = "COLLECT") {
  const html = `<div style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:6px;background:#10b981;color:#fff;font-weight:800;box-shadow:0 2px 8px rgba(16,185,129,0.3);cursor:pointer">
    <span style='display:inline-block;width:10px;height:10px;border-radius:999px;background:#065f46'></span>
    <span style='color:#fff;letter-spacing:.02em'>${text}</span>
  </div>`;
  return L.divIcon({ html, className: "", iconSize: [80, 28], iconAnchor: [40, 55] });
}

function nameBadgeIcon(name){
  // White pill, black text; positioned ABOVE the icon
  const html = `<div style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:#fff;color:#111;border:1px solid #d4d4d4;box-shadow:0 6px 14px rgba(0,0,0,.15);font-weight:700;">${name}<span style='font-weight:900'>&#8594;</span></div>`;
  return L.divIcon({ html, className:"", iconSize:[10,10], iconAnchor:[5,40] });
}

// ============================
// Data
// ============================
const DATA = {
  stacks: [
    {
      id: "jurong",
      name: "The Worker's Garden: Jurong Lake",
      cover: "img/jurong cover.jpg",
      desc: "Industrialisation, leisure, and the West's weekend commons.",
      bbox: [103.7240, 1.3310, 103.7370, 1.3445],
      artefacts: [
        { id:"black-ship", name:"Black Ship", kind:"fixed", points:10, radiusM:30, searchRadiusM:70, radiusColourM:"#22c55e", coords:{lat:1.34147,lng:103.72379}, img:"img/ship.jpg", images: ["img/perry.jpg"], blurb:"Gunboat Diplomacy", 
          richHistory: `In 1852–1853, Commodore Matthew Perry's American East India Squadron undertook its now-famous expedition that forced Japan to open to world trade. Less well-known is the fact that Perry's squadron stopped in Singapore before Japan, where its officers surveyed the Jurong River.

[img:perry.jpg:The earliest known illustration of the Jurong River, created by Perry's expedition artists in 1853]

The survey of Jurong produced what is today the earliest known illustration of the Jurong River. Created by the expedition's artists, Peter Wilhelm Heine and Eliphalet Brown, the lithograph depicts Malay stilt houses, a canoe flying the United States flag, and Jurong's dense vegetation.

https://www.youtube.com/watch?v=MaZ95O6RmAc

In the distance, fires are shown beyond the trees, likely representing the frequent kampong blazes of the era, or the boiling cauldrons used for processing gambier leaves. This historical document provides a rare glimpse into Singapore's landscape before industrialization transformed the region.

The Perry expedition's visit to Singapore was part of a broader American strategy to establish trade routes and diplomatic relations across Asia. The detailed surveys and illustrations created during this time remain valuable historical records of Southeast Asia's colonial period.` },
        { id:"sandbag", name:"Sandbag", kind:"fixed", points:10, radiusM:30, searchRadiusM:60, radiusColourM:"#6b7280", coords:{lat:1.3429,lng:103.72288}, img:"img/sandbags.jpg", images: ["img/dam1.jpg", "img/dam2.jpg"], blurb:"Nation Building, Literally.", history:"The lake in front of you today did not exist 50 years ago. Before its creation, this was Sungei Jurong — a winding river running down to the sea, bordered by mangrove forests, mudflats, and sandbanks. In the 1960s, as part of Singapore's industrialisation push, planners at the Economic Development Board (EDB), and then the newly formed Jurong Town Corporation (JTC), decided to reshape the river into a lake. This was to make it easier to supply water for factories while also laying the groundwork for recreational amenities. Urban planners wanted Jurong to be more than just an industrial town. Conceived as Singapore's first garden industrial estate, 12 percent of its land was set aside for parks, gardens, and open spaces. The Jurong Lake area was planned as a vital green lung to separate factories from residential zones. At the inaugural JTC meeting in June 1968, Finance Minister Goh Keng Swee described a vision of eight islands within the lake, linked by bridges and landscaped into themed gardens. In practice, only three of these were built: one for the Japanese Garden, the Chinese Garden, and one for a golf course. Goh's aviary later became Jurong Bird Park near Jurong Hill, while the last two islands were never realised. In 1971, the upper section of the Jurong River was dammed, formally creating the 81-hectare Jurong Lake. Today, it functions as both a reservoir and a planned landscape" },
        { id:"prawn", name:"Prawn", kind:"fixed", points:10, radiusM:30, searchRadiusM:70, radiusColourM:"#22c55e", coords:{lat:1.34016,lng:103.7247}, img: "img/prawn.jpg", images: ["img/prawning.jpg"], blurb:"Ponds and More.", history:"farming. In the early 1900s, Chinese settlers introduced aquaculture practices, while Malay villagers combined net fishing with prawn ponds built in muddy estuaries and mangrove swamps. By the 1950s, Singapore had some 1,000 acres of prawn ponds, and half of them were in Jurong. These were the most productive in the country, yielding nearly 1,000 kilograms of prawns per acre compared to less than 45 kilograms at Pulau Ubin. The ponds you see around you today probably do not contain prawns, but they are meant to mimic tidal patterns, ripples, and currents similar to those at coastal shores where prawn ponds once stood. Clusia Cove, a three-hectare water playground in Jurong Lake Gardens, lets children experience water play while also learning about water cycles and ecological balance. Clusia Cove also demonstrates natural water cleansing. Water circulates in a closed loop through a cleansing biotope, the playground, and an eco-pond. Sand beds and semi-aquatic plants like the Common Susum (Hanguana malayanum) filter and oxygenate the water, while ultraviolet treatment ensures it remains safe. The eco-pond itself mimics a freshwater wetland, where substrate filters debris and plants provide further purification before the loop begins again. The cove is named after one such plant — the Autograph Tree (Clusia rosea)." },
        { id:"lantern", name:"Lantern", kind:"fixed", points:10, radiusM:25, searchRadiusM:70, radiusColourM:"#22c55e", coords:{lat:1.33936,lng:103.72579}, img:"img/lantern.jpg", images: ["img/mid-a.jpg"], blurb:"Let there be light.", history:"Lanterns have long been a symbol of celebration at Jurong Lake. From the 1970s, Mid-Autumn Festivals were marked at the Chinese Garden with hundreds of lanterns illuminating the grounds. Each year carried a different theme, and from 1987 onwards the festivities regularly drew crowds of over 100,000 visitors. In 1999, the gardens hosted their largest Mid-Autumn Festival to date, importing more than 2,000 lanterns from Guangdong, China. Its centrepiece was the dramatic Dragon and Phoenix Pillar Millennium Lantern, measuring 10 metres in length. The tradition continues today under the banner of Lights by the Lake, which has since 2019 become the signature Mid-Autumn celebration in the Jurong Lake District. In 2024, the event attracted 280,000 visitors. Across the Lakeside Field, Eco Pond, Chinese Garden, and Japanese Garden, themed lantern sets light up the landscape each September to October. Highlights in recent years have included Reflections of Twilight, featuring animal lanterns mirrored on the water's surface; Birds of Wonderland, with kingfishers and other birdlife; Nezha and the Dragon King, a large-scale mythological tableau; and Chang'e and her Moon Palace, a glowing recreation of the moon goddess's celestial home. Bridges, pagodas, and lawns across the gardens are transformed during the festival. The White Rainbow Bridge becomes the Dragon and Phoenix Bridge, while projection mapping on the Chinese Garden's Main Arch creates the Blessing of the Moon show. Lanterns at the Japanese Garden include origami-inspired sets and floral displays at the Sunken Garden." },
        { id:"tooth", name:"Crocodile Tooth", kind:"fixed", points:10, radiusM:30, searchRadiusM:55, radiusColourM:"#22c55e", coords:{lat:1.34059,lng:103.72588}, img:"img/tooth.jpg", blurb:"A stationary voyage; a scripted journey.", history:"Pavilion once used by ROM; journeys without moving." },
        { id:"lake-lookout", name:"Lake Lookout", kind:"landmark", coords:{lat:1.3429,lng:103.72288}, img:"img/lookout.jpg", images: ["img/dam1.jpg", "img/dam2.jpg"], blurb:"Nation Building, Literally.", history:"The lake in front of you today did not exist 50 years ago. Before its creation, this was Sungei Jurong — a winding river running down to the sea, bordered by mangrove forests, mudflats, and sandbanks. In the 1960s, as part of Singapore's industrialisation push, planners at the Economic Development Board (EDB), and then the newly formed Jurong Town Corporation (JTC), decided to reshape the river into a lake. This was to make it easier to supply water for factories while also laying the groundwork for recreational amenities. Urban planners wanted Jurong to be more than just an industrial town. Conceived as Singapore's first garden industrial estate, 12 percent of its land was set aside for parks, gardens, and open spaces. The Jurong Lake area was planned as a vital green lung to separate factories from residential zones. At the inaugural JTC meeting in June 1968, Finance Minister Goh Keng Swee described a vision of eight islands within the lake, linked by bridges and landscaped into themed gardens. In practice, only three of these were built: one for the Japanese Garden, the Chinese Garden, and one for a golf course. Goh's aviary later became Jurong Bird Park near Jurong Hill, while the last two islands were never realised. In 1971, the upper section of the Jurong River was dammed, formally creating the 81-hectare Jurong Lake. Today, it functions as both a reservoir and a planned landscape", nearbyItems: ["sandbag"] },

      ],
    },
  ],
};

function enumerateArtefactsForStack(stack){
  const items=[]; 
  for(const a of stack.artefacts.filter(x=>x.kind==='fixed')) items.push(a);
  for(const a of stack.artefacts.filter(x=>x.kind==='landmark')) items.push(a);
  return items;
}

function findArtefactById(itemId){
  for(const stack of DATA.stacks){
    const artefact = stack.artefacts.find(a => a.id === itemId);
    if(artefact) return artefact;
  }
  return null;
}

// ============================
// Local Storage
// ============================
const KEY = "heartlands_progress_v05";
const USER_ID_KEY = "heartlands_user_id_v01";

function loadProgress(){ try{ return JSON.parse(localStorage.getItem(KEY)||"{}"); }catch{ return {}; } }
function saveProgress(state){ localStorage.setItem(KEY, JSON.stringify(state)); }

function getUserId() {
  let userId = localStorage.getItem(USER_ID_KEY);
  if (!userId) {
    // Generate a new unique user ID
    userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(USER_ID_KEY, userId);
  }
  return userId;
}

// ============================
// Hide‑on‑scroll Top Bar (fixed)
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

  // Debug logging
  useEffect(() => {
    console.log('HEARTLANDS App loaded successfully');
    console.log('Current view:', view);
    console.log('Progress:', progress);
  }, [view, progress]);

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
          <Home stacks={DATA.stacks} progress={progress} onPlay={(stackId)=>setView({page:'splash', stackId})} />
        )}
        {view.page==='splash' && (
          <SplashScreen stack={DATA.stacks.find(s=>s.id===view.stackId)} onPlay={()=>setView({page:'play', stackId:view.stackId})} onBack={()=>setView({page:'home', stackId:null})} />
        )}
              {view.page==='play' && (
          <Play stack={DATA.stacks.find(s=>s.id===view.stackId)} progress={progress} onCollect={onCollect} onBack={()=>setView({page:'splash', stackId:view.stackId})} onFinish={()=>goFinish(view.stackId)} />
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
  const coverFor = (s) => asset(s.cover) || asset(s.artefacts.find(a=>a.kind==='fixed')?.images?.[0]) || thumb(s.name);
  const introFor = (s) => s.intro || (
    s.id === 'jurong' ? "A workers' commons: Once the Sungei Jurong, its waters supported fishing villages, prawn ponds, and farms. In the 1960s, the river was reshaped into a lake to supply Singapore’s first industrial estate — and to keep its supply of workers happy. Today, Jurong Lake Gardens continues this legacy, welcoming residents and workers of all kinds as a place of respite." :
    s.id === 'civic' ? "XXXX" :
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
            <h1 style={{ fontSize:40, lineHeight:1.05, fontWeight:900, letterSpacing:'-0.01em', marginBottom:10 }}>Walk. Collect. Understand.</h1>
            <p style={{ ...styles.subtle, fontSize:16, maxWidth:860 }}>
              Heartlands is a self‑guided, walking game. Discover landmarks and collect items along the way.
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
          <HowItWorksStep n={1} title="Pick a quest" text="Each area has fixed icons (known sites) and random circles (mystery spawns)." />
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
                  <div style={{ position:'absolute', left:14, bottom:12 }}>
                    <div style={{ fontWeight:800, fontSize:18, color:'#fff', marginBottom:2 }}>
                      {s.id === 'jurong' ? 'Jurong Lake' : s.name}
                    </div>
                    <div style={{ fontSize:12, color:'rgba(255,255,255,0.9)' }}>
                      {s.id === 'jurong' ? 'The Worker\'s Garden' : 'Historical Expedition'}
                    </div>
                  </div>
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

// ============================
// SPLASH — Mission info and start button
// ============================
function SplashScreen({ stack, onPlay, onBack }){
  const all = enumerateArtefactsForStack(stack);
  const fixedItems = all.filter(a => a.kind === 'fixed');
  const landmarkItems = all.filter(a => a.kind === 'landmark');
  
  // Set mission duration and distance manually
  const missionDuration = 3; // hours
  const missionDistance = 2.5; // km
  
  return (
    <section style={{ ...styles.container, paddingTop:24, paddingBottom:24 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        <button onClick={onBack} style={{ ...styles.button, background:'#0b0b0b', color:'#e5e5e5' }}>← Back</button>
        <div>
          <h1 style={{ fontWeight:800, fontSize:32, marginBottom:4 }}>
            {stack.id === 'jurong' ? 'Jurong Lake' : stack.name}
          </h1>
          <div style={{ ...styles.subtle, fontSize:16, color:'#a3a3a3' }}>
            {stack.id === 'jurong' ? 'The Worker\'s Garden' : 'Historical Expedition'}
          </div>
        </div>
      </div>

      {/* Location Image */}
      <div style={{ ...styles.card, padding:0, overflow:'hidden', marginBottom:24 }}>
        <div style={{ position:'relative', height:200 }}>
          <img 
            src={asset(stack.cover) || asset(stack.artefacts.find(a=>a.kind==='random')?.images?.[0]) || thumb(stack.name)} 
            alt={stack.name} 
            style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} 
          />
          <div style={{ position:'absolute', inset:0, background:'linear-gradient(180deg, rgba(0,0,0,.0) 0%, rgba(0,0,0,.35) 65%, rgba(0,0,0,.55) 100%)' }} />
          <div style={{ position:'absolute', left:16, bottom:16 }}>
            <div style={{ fontWeight:800, fontSize:24, color:'#fff', marginBottom:2 }}>
              {stack.id === 'jurong' ? 'Jurong Lake' : stack.name}
            </div>
            <div style={{ fontSize:14, color:'rgba(255,255,255,0.9)' }}>
              {stack.id === 'jurong' ? 'The Worker\'s Garden' : 'Historical Expedition'}
            </div>
          </div>
        </div>
      </div>

      {/* Mission Overview */}
      <div style={{ ...styles.card, marginBottom:24 }}>
        <h2 style={{ fontWeight:700, fontSize:20, marginBottom:16 }}>Mission Overview</h2>
        <div style={{ display:'grid', gap:16, gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div style={{ textAlign:'center', padding:'16px 12px', background:'rgba(255,255,255,0.05)', borderRadius:12 }}>
            <div style={{ fontSize:24, fontWeight:800, color:'#22c55e', marginBottom:4 }}>{missionDuration}</div>
            <div style={{ ...styles.subtle, fontSize:14 }}>Hours</div>
          </div>
          <div style={{ textAlign:'center', padding:'16px 12px', background:'rgba(255,255,255,0.05)', borderRadius:12 }}>
            <div style={{ fontSize:24, fontWeight:800, color:'#22c55e', marginBottom:4 }}>{missionDistance}</div>
            <div style={{ ...styles.subtle, fontSize:14 }}>Kilometers</div>
          </div>
          <div style={{ textAlign:'center', padding:'16px 12px', background:'rgba(255,255,255,0.05)', borderRadius:12 }}>
            <div style={{ fontSize:24, fontWeight:800, color:'#22c55e', marginBottom:4 }}>{all.length}</div>
            <div style={{ ...styles.subtle, fontSize:14 }}>Items to Collect</div>
          </div>
        </div>
      </div>

      {/* Mission Description */}
      <div style={{ ...styles.card, marginBottom:24 }}>
        <h2 style={{ fontWeight:700, fontSize:20, marginBottom:16 }}>About This Mission</h2>
        <p style={{ ...styles.subtle, fontSize:15, lineHeight:1.6 }}>
          {stack.id === 'jurong' ? 
            "Explore the transformation of Jurong from a rural river system to Singapore's first industrial estate. Discover how the Sungei Jurong became Jurong Lake, and learn about the workers' commons that emerged. This mission takes you through historical prawn ponds, lantern festivals, and the engineering marvels that shaped modern Jurong." :
            stack.desc || "Embark on a journey through this area's unique history and culture. Each landmark tells a story, and every mystery item reveals hidden connections to the past."
          }
        </p>
      </div>

      {/* What to Expect */}
      <div style={{ ...styles.card, marginBottom:24 }}>
        <h2 style={{ fontWeight:700, fontSize:20, marginBottom:16 }}>What to Expect</h2>
        <div style={{ display:'grid', gap:12 }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#22c55e', marginTop:6, flexShrink:0 }}></div>
            <div>
              <div style={{ fontWeight:600, marginBottom:4 }}>Collectible Items</div>
              <div style={{ ...styles.subtle, fontSize:14 }}>Find {fixedItems.length} historical items. Green circles show search areas, but items appear at random points within them.</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#3b82f6', marginTop:6, flexShrink:0 }}></div>
            <div>
              <div style={{ fontWeight:600, marginBottom:4 }}>Landmarks</div>
              <div style={{ ...styles.subtle, fontSize:14 }}>Visit {landmarkItems.length} permanent landmarks that tell the story of Jurong Lake.</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#8b5cf6', marginTop:6, flexShrink:0 }}></div>
            <div>
              <div style={{ fontWeight:600, marginBottom:4 }}>Interactive Map</div>
              <div style={{ ...styles.subtle, fontSize:14 }}>Use GPS navigation, compass direction, and real-time location tracking.</div>
            </div>
          </div>
        </div>
      </div>

      {/* Start Mission Button */}
      <div style={{ textAlign:'center' }}>
        <button onClick={() => {
          window.scrollTo(0, 0);
          onPlay();
        }} style={{ 
          ...styles.button, 
          fontSize:18, 
          padding:'16px 32px',
          background:'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
          border:'none',
          boxShadow:'0 4px 20px rgba(34,197,94,0.3)'
        }}>
          🚀 Start Mission
        </button>
      </div>
    </section>
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
  // --- state (single declarations, fixed) ---
  const [gpsLoc, setGpsLoc] = useState(null);     // real GPS
  const [simLoc, setSimLoc] = useState(null);     // simulated (drag pin)
  const [simOn, setSimOn]   = useState(false);
  const [error, setError]   = useState("");
  const [tab, setTab]       = useState('landmarks');   // 'landmarks' | 'collected'
  const [modalA, setModalA] = useState(null);     // artefact for detail modal
  const [circleColor, setCircleColor] = useState('green'); // 'green' | 'gray'

  const [heading, setHeading]     = useState(null); // degrees
  const [compassOn, setCompassOn] = useState(false);
  const [centerKey, setCenterKey] = useState(0);    // bump to recenter once
  const [compassOffset, setCompassOffset] = useState(0); // calibration offset
  const [lastHeadingUpdate, setLastHeadingUpdate] = useState(0);
  const [mapStyle, setMapStyle] = useState('hybrid'); // 'hybrid', 'satellite', 'apple', 'standard'
  
  // Item collection popup state
  const [itemPopup, setItemPopup] = useState(null); // { item, taps: 0, stage: 'crate' | 'opening' | 'item' }
  const [crateTaps, setCrateTaps] = useState(0);
  
  // Finish warning state
  const [showFinishWarning, setShowFinishWarning] = useState(false);

  // Confetti canvas over the map (so map-collect pops confetti)
  const mapConfettiRef = useRef(null);

  const allItems = useMemo(()=> enumerateArtefactsForStack(stack), [stack]);
  const fixedItems = allItems.filter(a=>a.kind==='fixed');
  const landmarkItems = allItems.filter(a=>a.kind==='landmark');

  // Geolocation (no auto recentre elsewhere)
  useEffect(()=>{
    if(!('geolocation' in navigator)){ setError('Geolocation not supported.'); return; }
    const id = navigator.geolocation.watchPosition(
      (pos)=>{
        const { latitude, longitude, speed, heading:hdg } = pos.coords;
        setGpsLoc({ lat: latitude, lng: longitude, speed: speed ?? 0, heading: hdg });
        
        // Only use GPS heading if compass is not enabled (GPS heading is less accurate)
        if (!compassOn && typeof hdg === 'number' && !Number.isNaN(hdg)) {
          updateHeading(hdg);
        }
      },
      (err)=> setError(err.message||'Location error'),
      { enableHighAccuracy:true, maximumAge:2000, timeout:10000 }
    );
    return ()=> navigator.geolocation.clearWatch(id);
  },[compassOn]);

  // Improved compass / heading implementation
  function enableCompass(){
    try{
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function'){
        DeviceOrientationEvent.requestPermission().then((state)=>{ 
          if(state==='granted') {
            setCompassOn(true);
            // Reset offset when enabling compass
            setCompassOffset(0);
          }
        });
      } else { 
        setCompassOn(true);
        setCompassOffset(0);
      }
    } catch { 
      setCompassOn(true);
      setCompassOffset(0);
    }
  }

  // Smooth heading updates with filtering
  function updateHeading(newHeading) {
    const now = Date.now();
    if (now - lastHeadingUpdate < 100) return; // Throttle updates to max 10Hz
    
    if (typeof newHeading === 'number' && !Number.isNaN(newHeading)) {
      // Normalize heading to 0-360
      let normalizedHeading = newHeading % 360;
      if (normalizedHeading < 0) normalizedHeading += 360;
      
      // Apply offset calibration
      normalizedHeading = (normalizedHeading + compassOffset) % 360;
      if (normalizedHeading < 0) normalizedHeading += 360;
      
      console.log('Updating heading:', normalizedHeading, 'from raw:', newHeading);
      setHeading(normalizedHeading);
      setLastHeadingUpdate(now);
    }
  }

  useEffect(()=>{
    if (!compassOn) return;
    
    function onOrientation(e){
      let h = null;
      
      // iOS Safari - use webkitCompassHeading if available (most accurate)
      if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
        h = e.webkitCompassHeading;
      }
      // Android/Chrome - use alpha with proper coordinate system conversion
      else if (typeof e.alpha === 'number' && !Number.isNaN(e.alpha)) {
        // Convert device orientation alpha to compass heading
        // Alpha: 0° = North, 90° = East, 180° = South, 270° = West
        h = (360 - e.alpha) % 360;
      }
      
      if (h !== null) {
        updateHeading(h);
      }
    }
    
    // Try absolute orientation first (more accurate)
    window.addEventListener('deviceorientationabsolute', onOrientation, { passive: true });
    window.addEventListener('deviceorientation', onOrientation, { passive: true });
    
    return ()=>{
      window.removeEventListener('deviceorientationabsolute', onOrientation);
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [compassOn, compassOffset, lastHeadingUpdate]);

  const effective = simOn && simLoc ? simLoc : gpsLoc;
  // Ensure we always have a fallback location for collection logic
  const effectiveForCollection = effective || (fixedItems[0]?.coords || { lat: stack.bbox[1], lng: stack.bbox[0] });

  const withDist = useMemo(()=> allItems.map(a=>({ a, d: effective ? haversineMeters(effective, a.coords) : Infinity })), [allItems, effective]);
  const collectedSet = useMemo(()=> new Set(Object.keys(progress).filter(k=>k.startsWith(stack.id+':')).map(k=>k.split(':')[1])), [progress, stack.id]);
  const huntList = withDist.filter(({a})=> !collectedSet.has(a.id)).sort((p,q)=>p.d-q.d);
  const collectedList = withDist.filter(({a})=> collectedSet.has(a.id)).sort((p,q)=> (progress[`${stack.id}:${q.a.id}`]?.when||0) - (progress[`${stack.id}:${p.a.id}`]?.when||0));

  const withinIds = useMemo(()=> new Set(withDist.filter(({a,d})=> d <= (a.radiusM||80)).map(x=>x.a.id)), [withDist]);

  const totals = useMemo(()=>{
    const totalPts = fixedItems.reduce((s,x)=>s+x.points,0);
    const got = fixedItems.filter(a=>progress[`${stack.id}:${a.id}`]);
    const gotPts = got.reduce((s,a)=>s+a.points,0);
    return { totalItems: fixedItems.length, gotItems: got.length, totalPts, gotPts };
  }, [fixedItems, progress, stack.id]);

  function actuallyCollect(a){ onCollect(stack.id, a.id, a.points); }
  function mapAttemptCollect(a){
    if(!effective) return; 
    
    // Find the user-specific random collection point for this item
    const randomCollectionPoint = generateUserSpecificRandomPoint(a.coords.lat, a.coords.lng, a.searchRadiusM || 60, a.id, getUserId());
    const d = haversineMeters(effective, randomCollectionPoint); 
    const r = a.radiusM || 20; 
    
    if(d <= r){
      // Trigger full-screen popup instead of direct collection
      // Randomize tap count between 3-8
      const randomTapsNeeded = Math.floor(Math.random() * 6) + 3; // 3-8 taps
      setItemPopup({ item: a, stage: 'crate', taps: 0, tapsNeeded });
      setCrateTaps(0);
    }
  }
  function cardAttemptCollect(a){ 
    if(!effective) return; 
    
    // Find the user-specific random collection point for this item
    const randomCollectionPoint = generateUserSpecificRandomPoint(a.coords.lat, a.coords.lng, a.searchRadiusM || 60, a.id, getUserId());
    const d = haversineMeters(effective, randomCollectionPoint); 
    const r = a.radiusM || 20; 
    
    if(d <= r){ 
      actuallyCollect(a); 
      setModalA(a); 
    } 
  }

  // simple responsive height
  const mapHeight = typeof window !== 'undefined' && window.innerWidth < 640 ? '68vh' : '80vh';

  return (
    <section style={{ ...styles.container, paddingTop:16, paddingBottom:24 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
          <button onClick={onBack} style={{ ...styles.button, background:'#0b0b0b', color:'#e5e5e5' }}>← Back</button>
          <div>
            <h2 style={{ fontWeight:800, fontSize:22, marginBottom:2 }}>
              {stack.id === 'jurong' ? 'Jurong Lake' : stack.name}
            </h2>
            <div style={{ ...styles.subtle, fontSize:14, color:'#a3a3a3' }}>
              {stack.id === 'jurong' ? 'The Worker\'s Garden' : 'Historical Expedition'}
            </div>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
            <div style={{ ...styles.subtle, fontSize:12 }}>{totals.gotItems}/{totals.totalItems} items • {totals.gotPts}/{totals.totalPts} pts</div>
            <button onClick={() => setShowFinishWarning(true)} style={{ ...styles.button }}>Finish</button>
          </div>
        </div>

      {/* map wrapper: centered; no weird zoom on mobile */}
      <div style={{ maxWidth:980, margin:'0 auto' }}>
        <div style={{ position:'sticky', top:12, height:mapHeight, zIndex:10, borderRadius:16, overflow:'hidden', border:'1px solid #2a2a2a' }}>
          <div style={{ position:'relative', width:'100%', height:'100%' }}>
            <MapBox
              stack={stack}
              fixedItems={fixedItems}
              landmarkItems={landmarkItems}
              userLoc={effectiveForCollection}
              gpsLoc={gpsLoc}
              simOn={simOn}
              simLoc={simLoc}
              setSimLoc={setSimLoc}
              collectedSet={collectedSet}
              withinIds={withinIds}
              onCollectFromMap={mapAttemptCollect}
              onOpenModal={(a)=>setModalA(a)}
              heading={heading}
              centerKey={centerKey}
              onCenter={()=>setCenterKey(k=>k+1)}
              onEnableCompass={enableCompass}
              compassOn={compassOn}
              mapStyle={mapStyle}
              setMapStyle={setMapStyle}
              onAutoTriggerPopup={(item, tapsNeeded) => {
                setItemPopup({ item, stage: 'crate', taps: 0, tapsNeeded });
                setCrateTaps(0);
              }}
            />
            {/* Confetti overlay for map collects */}
            <canvas ref={mapConfettiRef} width={800} height={600} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:800 }} />
          </div>
        </div>

        {/* Map toolbar */}
        <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ ...styles.subtle, fontSize:13 }}>
            {effective ? (
              <>You: <span style={{fontFamily:'ui-monospace,SFMono-Regular'}}>{effective.lat?.toFixed(5)}, {effective.lng?.toFixed(5)}</span>{typeof heading==='number'?` • ${Math.round(heading)}°`:''}{effective.speed?` • ${effective.speed.toFixed(1)} m/s`:''}</>
            ) : (error ? <span style={{ color:'#ef4444' }}>{error}</span> : 'Allow location (HTTPS on iOS) for blue dot & distances.')}
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={()=>setSimOn(v=>!v)} style={{ ...styles.button, background: simOn?'#7c3aed':'#111', color:'#fff', borderColor:'#5b21b6' }}>{simOn? 'Sim ON (drag pin)':'Sim OFF'}</button>
            <button onClick={()=>{ setSimOn(false); setSimLoc(null); }} style={{ ...styles.button, background:'#111', color:'#e5e5e5' }}>Use GPS</button>

          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ marginTop:18 }}>
        <div style={{ display:'inline-flex', background:'#111', border:'1px solid #2a2a2a', borderRadius:12, overflow:'hidden' }}>
          <button onClick={()=>setTab('landmarks')} style={{ padding:'8px 14px', fontWeight:600, color: tab==='landmarks'? '#000':'#e5e5e5', background: tab==='landmarks'? '#fff':'transparent', borderRight:'1px solid #2a2a2a' }}>Landmarks</button>
          <button onClick={()=>setTab('collected')} style={{ padding:'8px 14px', fontWeight:600, color: tab==='collected'? '#000':'#e5e5e5', background: tab==='collected'? '#fff':'transparent' }}>Items Collected ({collectedList.length}/{fixedItems.length})</button>
        </div>
      </div>

      {/* Cards list */}
      <div style={{ marginTop:12 }}>
        <div style={{ display:'grid', gap:12 }}>
          {tab==='landmarks' && landmarkItems.map((a)=> (
            <LandmarkCard key={a.id} a={a} onOpenModal={()=>setModalA(a)} />
          ))}
          {tab==='collected' && collectedList.map(({a,d})=> (
            <ArtefactCard key={a.id} a={a} d={d} collected={!!progress[`${stack.id}:${a.id}`]} onCollect={()=>cardAttemptCollect(a)} onOpenModal={()=>setModalA(a)} />
          ))}
        </div>
      </div>

      {/* Modal overlay for rich detail */}
      <ArtefactModal open={!!modalA} a={modalA} onClose={()=>setModalA(null)} />
      
      {/* Item collection popup */}
      <ItemCollectionPopup 
        popup={itemPopup}
        onClose={() => setItemPopup(null)}
        onCollect={(item) => {
          runConfetti(mapConfettiRef.current);
          actuallyCollect(item);
          setTimeout(() => { setModalA(item); }, 750);
        }}
        onTapCrate={() => {
          const newTaps = crateTaps + 1;
          setCrateTaps(newTaps);
          
          if (newTaps >= itemPopup.tapsNeeded) {
            // Play sound effect (if available)
            try {
              const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUarm7blmGgU7k9n1unEiBS13yO/eizEIHWq+8+OWT');
              audio.volume = 0.3;
              audio.play().catch(() => {}); // Ignore errors if audio fails
            } catch (e) {}
            
            // Transition to opening stage
            setItemPopup(prev => ({ ...prev, stage: 'opening' }));
            
            // After opening animation, show item
            setTimeout(() => {
              setItemPopup(prev => ({ ...prev, stage: 'item' }));
            }, 800);
          } else {
            // Update popup with new tap count
            setItemPopup(prev => ({ ...prev, taps: newTaps }));
          }
        }}
      />
      
      {/* Finish warning dialog */}
      <FinishWarningDialog 
        show={showFinishWarning}
        onConfirm={() => {
          setShowFinishWarning(false);
          onFinish();
        }}
        onCancel={() => setShowFinishWarning(false)}
      />
    </section>
  );
}

// ============================
// ITEM COLLECTION POPUP
// ============================
function ItemCollectionPopup({ popup, onClose, onCollect, onTapCrate }){
  if (!popup) return null;

  const { item, stage, taps, tapsNeeded } = popup;

  const handleCrateTap = () => {
    onTapCrate();
  };

  const handleCollect = () => {
    onCollect(item);
    onClose();
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.9)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: 20
    }}>
      {/* Background blur effect */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
        opacity: 0.95
      }} />
      
      {/* Main content */}
      <div style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 30,
        maxWidth: 400,
        width: '100%'
      }}>
        
        {/* Item name or discovery message */}
        <h2 style={{
          color: '#fff',
          fontSize: 28,
          fontWeight: 'bold',
          textAlign: 'center',
          margin: 0,
          textShadow: '0 2px 4px rgba(0,0,0,0.5)'
        }}>
          {stage === 'crate' ? 'You\'ve discovered a new item!' : item.name}
        </h2>

        {/* Crate or item display */}
        <div style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 200
        }}>
          
          {stage === 'crate' && (
            <div style={{
              position: 'relative',
              cursor: 'pointer',
              transform: `scale(${1 + (taps * 0.1)})`,
              transition: 'transform 0.2s ease-out'
            }} onClick={handleCrateTap}>
              {/* Crate image */}
              <img 
                src="img/crate.jpg" 
                alt="Mystery Crate"
                style={{
                  width: 200,
                  height: 200,
                  objectFit: 'cover',
                  borderRadius: 15,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                  border: '3px solid #ffd700'
                }}
              />
              
              {/* Tap indicator */}
              <div style={{
                position: 'absolute',
                bottom: -40,
                left: '50%',
                transform: 'translateX(-50%)',
                color: '#fff',
                fontSize: 16,
                textAlign: 'center',
                background: 'rgba(0,0,0,0.7)',
                padding: '8px 16px',
                borderRadius: 20,
                border: '1px solid #ffd700'
              }}>
                Tap to open!
              </div>
            </div>
          )}

          {stage === 'opening' && (
            <div style={{
              position: 'relative',
              animation: 'crateBreak 0.8s ease-out forwards'
            }}>
              {/* Breaking crate effect */}
              <img 
                src="img/crate.jpg" 
                alt="Breaking Crate"
                style={{
                  width: 200,
                  height: 200,
                  objectFit: 'cover',
                  borderRadius: 15,
                  filter: 'brightness(1.2) contrast(1.1)',
                  transform: 'rotate(5deg) scale(1.1)'
                }}
              />
              
              {/* Sparkle effects */}
              <div style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%)',
                animation: 'sparkle 0.8s ease-out'
              }} />
            </div>
          )}

          {stage === 'item' && (
            <div style={{
              position: 'relative',
              animation: 'itemAppear 0.6s ease-out forwards'
            }}>
              {/* Item icon emerging from crate */}
              <div style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 20
              }}>
                {/* Item image */}
                <img 
                  src={item.img || `img/${item.name.toLowerCase().replace(/\s+/g, '')}.jpg`}
                  alt={item.name}
                  style={{
                    width: 120,
                    height: 120,
                    objectFit: 'cover',
                    borderRadius: 15,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                    border: '3px solid #22c55e',
                    background: 'transparent'
                  }}
                />
                
                {/* Collect button */}
                <button
                  onClick={handleCollect}
                  style={{
                    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                    color: '#fff',
                    border: 'none',
                    padding: '15px 30px',
                    borderRadius: 25,
                    fontSize: 18,
                    fontWeight: 'bold',
                    cursor: 'pointer',
                    boxShadow: '0 5px 15px rgba(34, 197, 94, 0.4)',
                    transition: 'all 0.2s ease',
                    textTransform: 'uppercase',
                    letterSpacing: 1
                  }}
                  onMouseOver={(e) => {
                    e.target.style.transform = 'translateY(-2px)';
                    e.target.style.boxShadow = '0 8px 20px rgba(34, 197, 94, 0.6)';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = 'translateY(0)';
                    e.target.style.boxShadow = '0 5px 15px rgba(34, 197, 94, 0.4)';
                  }}
                >
                  Collect Item!
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 60,
            right: 20,
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.3)',
            color: '#fff',
            width: 40,
            height: 40,
            borderRadius: '50%',
            cursor: 'pointer',
            fontSize: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 40,
            minHeight: 40,
            padding: 0
          }}
        >
          ×
        </button>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes crateBreak {
          0% { transform: scale(1) rotate(0deg); }
          50% { transform: scale(1.1) rotate(5deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
        
        @keyframes sparkle {
          0% { opacity: 0; transform: scale(0.5); }
          50% { opacity: 1; transform: scale(1.2); }
          100% { opacity: 0; transform: scale(1); }
        }
        
        @keyframes itemAppear {
          0% { opacity: 0; transform: translateY(20px) scale(0.8); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}

function FinishWarningDialog({ show, onConfirm, onCancel }) {
  if (!show) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.8)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}>
      <div style={{
        background: '#1a1a1a',
        borderRadius: 20,
        padding: 30,
        maxWidth: 400,
        width: '90%',
        textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.1)'
      }}>
        <h3 style={{ color: '#fff', fontSize: 24, marginBottom: 16, fontWeight: 600 }}>
          ⚠️ Finish Tour?
        </h3>
        <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 16, lineHeight: 1.5, marginBottom: 24 }}>
          Once you finish, your progress will be saved and you won't be able to continue collecting items. 
          You can still view your collection and download your story, but the tour will be complete.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={onCancel}
            style={{
              background: 'rgba(255,255,255,0.1)',
              border: '1px solid rgba(255,255,255,0.3)',
              color: '#fff',
              padding: '12px 24px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 16
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              border: 'none',
              color: '#fff',
              padding: '12px 24px',
              borderRadius: 8,
              cursor: 'pointer',
              fontSize: 16,
              fontWeight: 600
            }}
          >
            Finish Tour
          </button>
        </div>
      </div>
    </div>
  );
}

function MapBox({ stack, fixedItems, landmarkItems, userLoc, gpsLoc, simOn, simLoc, setSimLoc, collectedSet, withinIds, onCollectFromMap, onOpenModal, heading, centerKey, onCenter, onEnableCompass, compassOn, mapStyle, setMapStyle, onAutoTriggerPopup }){
  const center = fixedItems[0]?.coords || { lat: stack.bbox[1], lng: stack.bbox[0] };
  const mapRef = useRef(null);
  const [labelFor, setLabelFor] = useState(null); // which fixed id has a label open
  const [triggeredItems, setTriggeredItems] = useState(new Set()); // Track which items have already triggered popup



  // Map style configurations
  const mapStyles = {
    hybrid: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
      subdomains: "",
      overlay: {
        url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
        attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
        subdomains: ""
      }
    },
    satellite: {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
      subdomains: ""
    },
    apple: {
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd"
    },
    standard: {
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> contributors',
      subdomains: "abc"
    }
  };

  const currentStyle = mapStyles[mapStyle] || mapStyles.hybrid;

  return (
    <MapContainer whenCreated={(m)=>mapRef.current=m} center={[center.lat, center.lng]} zoom={16} style={{ height:'100%', width:'100%' }} scrollWheelZoom>
      {/* Dynamic map tiles based on selected style */}
      <TileLayer 
        attribution={currentStyle.attribution}
        url={currentStyle.url}
        subdomains={currentStyle.subdomains}
        maxZoom={20}
      />
      {/* Overlay for hybrid map (roads and labels on satellite) */}
      {currentStyle.overlay && (
        <TileLayer 
          attribution={currentStyle.overlay.attribution}
          url={currentStyle.overlay.url}
          subdomains={currentStyle.overlay.subdomains}
          maxZoom={20}
          opacity={0.7}
        />
      )}

      {/* Fixed artefacts with search radius circles and random collection points */}
      {fixedItems.map(f => {
        // Generate user-specific random collection point within the search radius
        const randomCollectionPoint = !collectedSet.has(f.id) ? 
          generateUserSpecificRandomPoint(f.coords.lat, f.coords.lng, f.searchRadiusM || 60, f.id, getUserId()) : null;
        
        // Check if player is close enough to the random collection point to see the item
        const playerCloseToItem = randomCollectionPoint && (() => {
          // Use the effective location (GPS or simulation)
          const effectiveLoc = userLoc || gpsLoc || simLoc;
          if (!effectiveLoc) {
            console.log(`No effective location for ${f.name}`);
            return false;
          }
          
          const distanceToItem = haversineMeters(effectiveLoc, randomCollectionPoint);
          
          console.log(`${f.name}: Player at (${effectiveLoc.lat?.toFixed(5)}, ${effectiveLoc.lng?.toFixed(5)}), item at (${randomCollectionPoint.lat?.toFixed(5)}, ${randomCollectionPoint.lng?.toFixed(5)}), distance: ${distanceToItem.toFixed(1)}m, required: ${f.radiusM || 20}m`);
          
          // radiusM determines how close you need to be to collect the item
          return distanceToItem <= (f.radiusM || 20);
        })();

        // Auto-trigger popup when player gets close to item for the first time
        if (playerCloseToItem && !triggeredItems.has(f.id) && !collectedSet.has(f.id)) {
          console.log(`Auto-triggering popup for ${f.name}`);
          setTriggeredItems(prev => new Set([...prev, f.id]));
          // Randomize tap count between 3-8
          const randomTapsNeeded = Math.floor(Math.random() * 6) + 3; // 3-8 taps
          onAutoTriggerPopup(f, randomTapsNeeded);
        }
        
        return (
          <React.Fragment key={f.id}>
            {/* Only show circle if item hasn't been collected */}
            {!collectedSet.has(f.id) && (
              <Circle center={[f.coords.lat, f.coords.lng]} radius={f.searchRadiusM || 60} pathOptions={{ color:f.radiusColourM || '#22c55e', weight:2, opacity:0.8, fillOpacity:0.1 }} />
            )}
            
            {/* Only show item when player is close enough to the random collection point */}
            {playerCloseToItem && randomCollectionPoint && (
              <>
                <Marker position={[randomCollectionPoint.lat, randomCollectionPoint.lng]} icon={makeImageIcon(f.img || thumb(f.name))} />
                <Marker position={[randomCollectionPoint.lat, randomCollectionPoint.lng]} icon={badgeIcon('COLLECT')} eventHandlers={{ click: ()=> onCollectFromMap(f) }} />
              </>
            )}
            

          </React.Fragment>
        );
      })}

      {/* Landmarks - always visible, clickable for info */}
      {landmarkItems.map(l => (
        <React.Fragment key={l.id}>
          <Marker position={[l.coords.lat, l.coords.lng]} icon={makeLandmarkIcon(l.img || thumb(l.name), l.name)} eventHandlers={{ click: ()=> onOpenModal && onOpenModal(l) }} />
        </React.Fragment>
      ))}

      {/* User / Sim markers */}
      {gpsLoc && !simOn && (
        <Marker 
          position={[gpsLoc.lat, gpsLoc.lng]} 
          icon={userIconWithHeading(heading)} 
          eventHandlers={{
            click: () => {
              console.log('User location clicked, heading:', heading, 'compassOn:', compassOn);
            }
          }}
        />
      )}
      {simOn && (
        <Marker
          position={[ (simLoc?.lat ?? center.lat), (simLoc?.lng ?? center.lng) ]}
          draggable={true}
          icon={simIcon}
          eventHandlers={{ dragend: (e)=>{ const ll=e.target.getLatLng(); setSimLoc({ lat: ll.lat, lng: ll.lng, speed:0 }); } }}
        />
      )}

      <Recenter userLoc={userLoc || simLoc || gpsLoc} centerKey={centerKey} />
      
      {/* Map Controls - Center, Compass, and Map Style buttons */}
      <div style={{ position:'absolute', bottom:20, right:20, display:'flex', flexDirection:'column', gap:8, zIndex:1000 }}>
        <button 
          onClick={onCenter} 
          style={{ 
            width:48, height:48, borderRadius:'50%', background:'#fff', border:'1px solid #ccc', 
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            boxShadow:'0 2px 8px rgba(0,0,0,0.15)'
          }}
          title="Center on location"
        >
          <img src={asset('img/target.png')} alt="Center" width="24" height="24" style={{ display:'block' }} />
        </button>
        <button 
          onClick={onEnableCompass}
          onContextMenu={(e) => {
            e.preventDefault();
            // Right-click or long-press to calibrate compass
            if (compassOn) {
              setCompassOffset(0);
              setHeading(null);
              console.log('Compass calibrated');
            }
          }}
          style={{ 
            width:48, height:48, borderRadius:'50%', 
            background: compassOn ? '#22c55e' : '#fff', 
            border:'1px solid #ccc', 
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            boxShadow:'0 2px 8px rgba(0,0,0,0.15)'
          }}
          title={compassOn ? 'Compass enabled (right-click to calibrate)' : 'Enable compass'}
        >
          <img src={asset('img/compass.png')} alt="Compass" width="20" height="20" style={{ display:'block' }} />
        </button>
        <button 
          onClick={() => {
            const styles = ['hybrid', 'satellite', 'apple', 'standard'];
            const currentIndex = styles.indexOf(mapStyle);
            const nextIndex = (currentIndex + 1) % styles.length;
            const newStyle = styles[nextIndex];
            console.log('Changing map style from', mapStyle, 'to', newStyle);
            setMapStyle(newStyle);
          }}
          style={{ 
            width:48, height:48, borderRadius:'50%', 
            background: mapStyle === 'hybrid' ? '#2E8B57' : mapStyle === 'satellite' ? '#8B4513' : mapStyle === 'apple' ? '#007AFF' : '#6B7280', 
            border:'1px solid #ccc', 
            display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer',
            boxShadow:'0 2px 8px rgba(0,0,0,0.15)',
            color: '#fff',
            fontSize: '12px',
            fontWeight: 'bold'
          }}
          title={`Map style: ${mapStyle} (tap to change)`}
        >
          {mapStyle === 'hybrid' ? '🛰️🏷️' : mapStyle === 'satellite' ? '🛰️' : mapStyle === 'apple' ? '🍎' : '🗺️'}
        </button>
      </div>
    </MapContainer>
  );
}

function Recenter({ userLoc, centerKey }){ const map = useMap(); useEffect(()=>{ if(centerKey && userLoc) map.setView([userLoc.lat, userLoc.lng]); },[centerKey]); return null; }

// ============================
// Landmark Card (non-collectible landmarks)
// ============================
function LandmarkCard({ a, onOpenModal }){
  return (
    <div style={{ ...styles.card, position:'relative', overflow:'hidden' }}>
      {/* Landmark Icon */}
      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16, padding:'16px 0' }}>
        <div style={{ 
          width:80, height:80, 
          borderRadius:12, 
          overflow:'hidden',
          border:'1px solid #2a2a2a',
          flexShrink:0
        }}>
          <img 
            src={asset(a.img)} 
            alt={a.name} 
            style={{ 
              width:'100%', 
              height:'100%', 
              objectFit:'cover',
              display:'block'
            }} 
          />
        </div>
        <div style={{ flex:1 }}>
          <h3 style={{ fontWeight:700, fontSize:18, marginBottom:4, color:'#fff' }}>{a.name}</h3>
          <p style={{ ...styles.subtle, fontSize:14, lineHeight:1.4, color:'#a3a3a3' }}>{a.blurb}</p>
        </div>
      </div>

      {/* Collection Hint Box */}
      {a.nearbyItems && a.nearbyItems.length > 0 && (
        <div style={{ 
          background:'rgba(34,197,94,0.1)', 
          border:'1px solid rgba(34,197,94,0.3)', 
          borderRadius:12, 
          padding:16, 
          marginBottom:16 
        }}>
          <div style={{ fontWeight:600, fontSize:14, color:'#22c55e', marginBottom:12 }}>
            🎯 Items to Collect Nearby
          </div>
          <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
            {a.nearbyItems.map((itemId, index) => {
              // Find the item data by ID
              const item = findArtefactById(itemId);
              if (!item) return null;
              
              return (
                <div key={itemId} style={{ 
                  display:'flex', 
                  flexDirection:'column', 
                  alignItems:'center', 
                  gap:8 
                }}>
                  <div style={{ 
                    width:48, height:48, 
                    borderRadius:8, 
                    overflow:'hidden', 
                    border:'2px solid #22c55e',
                    background:'#fff'
                  }}>
                    <img src={asset(item.img) || thumb(item.name)} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                  </div>
                  <div style={{ 
                    fontSize:12, 
                    fontWeight:600, 
                    color:'#22c55e', 
                    textAlign:'center',
                    maxWidth:48
                  }}>
                    {item.name}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      
      {/* Read History Button */}
      {a.history && (
        <div style={{ marginBottom:16 }}>
          <button onClick={()=>onOpenModal(a)} style={{ ...styles.button, background:'#111', color:'#e5e5e5', borderColor:'#333', fontSize:14 }}>
            Read History
          </button>
        </div>
      )}
    </div>
  );
}

// ============================
// Artefact Card (mystery randoms, proximity glow, confetti)
// ============================
function ArtefactCard({ a, d, collected, onCollect, onOpenModal }){
  const canvasRef = useRef(null);

  const radius = a.radiusM || 80; const within = d <= radius; const isFixed = a.kind==='fixed';
  const reveal = isFixed || collected;
  const nearby = within && !collected;

  const base = { ...styles.card, position:'relative', transition:'box-shadow .2s, border-color .2s, opacity .2s' };
  const vibe = nearby ? { boxShadow:'0 0 0 3px rgba(34,197,94,.35)', border:'1px solid #22c55e' } : (!within && !collected ? { opacity:.55 } : {});

  function handleCollect(){ if(within && !collected){ runConfetti(canvasRef.current); setTimeout(()=>{ onCollect(); onOpenModal && onOpenModal(); }, 650); } }

  return (
    <article style={{ ...base, ...vibe }}>
      <canvas ref={canvasRef} width={600} height={180} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }} />
      {nearby && (<span style={{ position:'absolute', top:10, right:10, width:10, height:10, background:'#f59e0b', borderRadius:9999, boxShadow:'0 0 0 6px rgba(245,158,11,.15)' }} />)}

      <div style={{ display:'flex', gap:12 }}>
        <div style={{ width:88, height:66, borderRadius:12, overflow:'hidden', border:'1px solid #2a2a2a' }}>
          <img src={(reveal ? asset(a.img || thumb(a.name)) : thumb('?'))} alt={reveal ? a.name : 'Unknown'} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block', filter: reveal ? 'none' : 'grayscale(1) brightness(.8)' }} />
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
  const [fullscreenImage, setFullscreenImage] = useState(null);
  
  if(!open || !a) return null;
  
  // Parse rich content with images and videos
  const parseRichContent = (content) => {
    if (!content) return [];
    
    // Split by double line breaks to get paragraphs
    const paragraphs = content.split('\n\n').filter(p => p.trim());
    const elements = [];
    
    paragraphs.forEach((paragraph, index) => {
      const trimmed = paragraph.trim();
      
      // Check if it's a YouTube link
      const youtubeMatch = trimmed.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
      if (youtubeMatch) {
        elements.push({
          type: 'youtube',
          videoId: youtubeMatch[1],
          key: `youtube-${index}`
        });
        return;
      }
      
      // Check if it's an image reference [img:filename.jpg] or [img:filename.jpg:caption]
      const imgMatch = trimmed.match(/\[img:([^:\]]+)(?::([^\]]+))?\]/);
      if (imgMatch) {
        elements.push({
          type: 'image',
          src: `img/${imgMatch[1]}`,
          caption: imgMatch[2] || null,
          key: `img-${index}`
        });
        return;
      }
      
      // Regular text paragraph
      elements.push({
        type: 'text',
        content: trimmed,
        key: `text-${index}`
      });
    });
    
    return elements;
  };
  
  const richContent = a.richHistory ? parseRichContent(a.richHistory) : null;
  const imgs = a.images && a.images.length ? a.images : [a.img || thumb(a.name)];
  
  return (
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:50, display:'grid', placeItems:'center' }}>
        <div style={{ width:'min(920px, 94vw)', maxHeight:'86vh', overflow:'auto', background:'#0d0d0d', border:'1px solid #232323', borderRadius:16 }}>
          <div style={{ padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #1f1f1f' }}>
            <div style={{ fontWeight:800 }}>{a.name || 'Artefact'}</div>
            <button onClick={onClose} style={{ ...styles.button, background:'#111', color:'#e5e5e5' }}>✕</button>
          </div>
          <div style={{ padding:16 }}>
            {/* Main Icon - Centered */}
            <div style={{ textAlign:'center', marginBottom:16 }}>
              <div style={{ 
                display:'inline-block',
                width:120, 
                height:120, 
                borderRadius:20, 
                overflow:'hidden', 
                border:'3px solid #22c55e',
                cursor:'pointer'
              }} onClick={() => setFullscreenImage(a.img || thumb(a.name))}>
                <img 
                  src={asset(a.img || thumb(a.name))} 
                  alt={a.name} 
                  style={{ 
                    width:'100%', 
                    height:'100%', 
                    objectFit:'contain', 
                    display:'block' 
                  }} 
                />
              </div>
            </div>
            
            {/* Collection Hint Box for Landmarks */}
            {a.kind === 'landmark' && a.nearbyItems && a.nearbyItems.length > 0 && (
              <div style={{ 
                background:'rgba(34,197,94,0.1)', 
                border:'1px solid rgba(34,197,94,0.3)', 
                borderRadius:12, 
                padding:16, 
                marginTop:16 
              }}>
                <div style={{ fontWeight:600, fontSize:14, color:'#22c55e', marginBottom:12 }}>
                  🎯 Items to Collect Nearby
                </div>
                <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                  {a.nearbyItems.map((itemId, index) => {
                    // Find the item data by ID
                    const item = findArtefactById(itemId);
                    if (!item) return null;
                    
                    return (
                      <div key={itemId} style={{ 
                        display:'flex', 
                        flexDirection:'column', 
                        alignItems:'center', 
                        gap:8 
                      }}>
                        <div style={{ 
                          width:48, height:48, 
                          borderRadius:8, 
                          overflow:'hidden', 
                          border:'2px solid #22c55e',
                          background:'#fff'
                        }}>
                          <img src={asset(item.img) || thumb(item.name)} alt={item.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                        </div>
                        <div style={{ 
                          fontSize:12, 
                          fontWeight:600, 
                          color:'#22c55e', 
                          textAlign:'center',
                          maxWidth:48
                        }}>
                          {item.name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* Blurb */}
            {a.blurb && <p style={{ ...styles.subtle, fontSize:15, marginTop:12 }}>{a.blurb}</p>}
            
            {/* Rich Content or Regular History */}
            {richContent ? (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:700, marginBottom:12 }}>History & context</div>
                {richContent.map((element) => {
                  switch (element.type) {
                    case 'text':
                      return (
                        <p key={element.key} style={{ color:'#e5e5e5', fontSize:14, lineHeight:1.6, marginBottom:16 }}>
                          {element.content}
                        </p>
                      );
                    case 'image':
                      return (
                        <div key={element.key} style={{ marginBottom:16, textAlign:'center' }}>
                          <img 
                            src={asset(element.src)} 
                            alt={element.caption || "Historical image"}
                            style={{ 
                              maxWidth:'100%', 
                              height:'auto', 
                              borderRadius:8, 
                              border:'1px solid #242424',
                              cursor:'pointer'
                            }}
                            onClick={() => setFullscreenImage(element.src)}
                          />
                          {element.caption && (
                            <div style={{ 
                              marginTop:8, 
                              fontSize:12, 
                              color:'rgba(255,255,255,0.6)', 
                              fontStyle:'italic',
                              lineHeight:1.4
                            }}>
                              {element.caption}
                            </div>
                          )}
                        </div>
                      );
                    case 'youtube':
                      return (
                        <div key={element.key} style={{ marginBottom:16, textAlign:'center' }}>
                          <div style={{ 
                            position:'relative', 
                            width:'100%', 
                            height:0, 
                            paddingBottom:'56.25%', // 16:9 aspect ratio
                            borderRadius:8,
                            overflow:'hidden',
                            border:'1px solid #242424'
                          }}>
                            <iframe
                              src={`https://www.youtube.com/embed/${element.videoId}`}
                              style={{
                                position:'absolute',
                                top:0,
                                left:0,
                                width:'100%',
                                height:'100%',
                                border:0
                              }}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          </div>
                        </div>
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            ) : a.history ? (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>History & context</div>
                <div style={{ color:'#e5e5e5', fontSize:14, lineHeight:1.6 }}>{a.history}</div>
              </div>
            ) : null}
            
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
      
      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div style={{
          position:'fixed',
          inset:0,
          background:'rgba(0,0,0,0.9)',
          zIndex:60,
          display:'flex',
          alignItems:'center',
          justifyContent:'center',
          padding:20
        }} onClick={() => setFullscreenImage(null)}>
          <div style={{ position:'relative', maxWidth:'90vw', maxHeight:'90vh' }}>
            <img 
              src={asset(fullscreenImage)} 
              alt="Fullscreen view"
              style={{ 
                maxWidth:'100%', 
                maxHeight:'100%', 
                objectFit:'contain',
                borderRadius:8
              }}
            />
            <button
              onClick={() => setFullscreenImage(null)}
              style={{
                position:'absolute',
                top:-10,
                right:-10,
                background:'rgba(0,0,0,0.7)',
                border:'1px solid rgba(255,255,255,0.3)',
                color:'#fff',
                width:40,
                height:40,
                borderRadius:'50%',
                cursor:'pointer',
                fontSize:20,
                display:'flex',
                alignItems:'center',
                justifyContent:'center'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ============================
// FINISH ITEM MODAL — Rich content modal for finish screen
// ============================
function FinishItemModal({ item, onClose, collected, all, getDiscoveredLandmarks }){
  const [fullscreenImage, setFullscreenImage] = useState(null);
  
  if(!item) return null;
  
  // Parse rich content with images and videos (same as ArtefactModal)
  const parseRichContent = (content) => {
    if (!content) return [];
    
    // Split by double line breaks to get paragraphs
    const paragraphs = content.split('\n\n').filter(p => p.trim());
    const elements = [];
    
    paragraphs.forEach((paragraph, index) => {
      const trimmed = paragraph.trim();
      
      // Check if it's a YouTube link
      const youtubeMatch = trimmed.match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
      if (youtubeMatch) {
        elements.push({
          type: 'youtube',
          videoId: youtubeMatch[1],
          key: `youtube-${index}`
        });
        return;
      }
      
      // Check if it's an image reference [img:filename.jpg] or [img:filename.jpg:caption]
      const imgMatch = trimmed.match(/\[img:([^:\]]+)(?::([^\]]+))?\]/);
      if (imgMatch) {
        elements.push({
          type: 'image',
          src: `img/${imgMatch[1]}`,
          caption: imgMatch[2] || null,
          key: `img-${index}`
        });
        return;
      }
      
      // Regular text paragraph
      elements.push({
        type: 'text',
        content: trimmed,
        key: `text-${index}`
      });
    });
    
    return elements;
  };
  
  const richContent = item.richHistory ? parseRichContent(item.richHistory) : null;
  
  return (
    <>
      <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.55)', zIndex:50, display:'grid', placeItems:'center' }}>
        <div style={{ width:'min(920px, 94vw)', maxHeight:'86vh', overflow:'auto', background:'#0d0d0d', border:'1px solid #232323', borderRadius:16 }}>
          <div style={{ padding:'12px 14px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid #1f1f1f' }}>
            <div style={{ fontWeight:800 }}>{item.name || 'Artefact'}</div>
            <button onClick={onClose} style={{ ...styles.button, background:'#111', color:'#e5e5e5' }}>✕</button>
          </div>
          <div style={{ padding:16 }}>
            {/* Main Icon - Centered */}
            <div style={{ textAlign:'center', marginBottom:16 }}>
              <div style={{ 
                display:'inline-block',
                width:120, 
                height:120, 
                borderRadius:20, 
                overflow:'hidden', 
                border:'3px solid #22c55e',
                cursor:'pointer'
              }} onClick={() => setFullscreenImage(item.img || thumb(item.name))}>
                <img 
                  src={asset(item.img || thumb(item.name))} 
                  alt={item.name} 
                  style={{ 
                    width:'100%', 
                    height:'100%', 
                    objectFit:'contain', 
                    display:'block' 
                  }} 
                />
              </div>
            </div>
            
            {/* Collection Hint Box for Landmarks */}
            {item.kind === 'landmark' && item.nearbyItems && item.nearbyItems.length > 0 && (
              <div style={{ 
                background:'rgba(34,197,94,0.1)', 
                border:'1px solid rgba(34,197,94,0.3)', 
                borderRadius:12, 
                padding:16, 
                marginTop:16 
              }}>
                <div style={{ fontWeight:600, fontSize:14, color:'#22c55e', marginBottom:12 }}>
                  🎯 Items to Collect Nearby
                </div>
                <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                  {item.nearbyItems.map((itemId, index) => {
                    // Find the item data by ID
                    const nearbyItem = all.find(a => a.id === itemId);
                    if (!nearbyItem) return null;
                    
                    return (
                      <div key={itemId} style={{ 
                        display:'flex', 
                        flexDirection:'column', 
                        alignItems:'center', 
                        gap:8 
                      }}>
                        <div style={{ 
                          width:48, height:48, 
                          borderRadius:8, 
                          overflow:'hidden', 
                          border:'2px solid #22c55e',
                          background:'#fff'
                        }}>
                          <img src={asset(nearbyItem.img) || thumb(nearbyItem.name)} alt={nearbyItem.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                        </div>
                        <div style={{ 
                          fontSize:12, 
                          fontWeight:600, 
                          color:'#22c55e', 
                          textAlign:'center',
                          maxWidth:48
                        }}>
                          {nearbyItem.name}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            {/* Blurb */}
            {item.blurb && <p style={{ ...styles.subtle, fontSize:15, marginTop:12 }}>{item.blurb}</p>}
            
            {/* Rich Content or Regular History */}
            {richContent ? (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:700, marginBottom:12 }}>History & context</div>
                {richContent.map((element) => {
                  switch (element.type) {
                    case 'text':
                      return (
                        <p key={element.key} style={{ color:'#e5e5e5', fontSize:14, lineHeight:1.6, marginBottom:16 }}>
                          {element.content}
                        </p>
                      );
                    case 'image':
                      return (
                        <div key={element.key} style={{ marginBottom:16, textAlign:'center' }}>
                          <img 
                            src={asset(element.src)} 
                            alt={element.caption || "Historical image"}
                            style={{ 
                              maxWidth:'100%', 
                              height:'auto', 
                              borderRadius:8, 
                              border:'1px solid #242424',
                              cursor:'pointer'
                            }}
                            onClick={() => setFullscreenImage(element.src)}
                          />
                          {element.caption && (
                            <div style={{ 
                              marginTop:8, 
                              fontSize:12, 
                              color:'rgba(255,255,255,0.6)', 
                              fontStyle:'italic',
                              lineHeight:1.4
                            }}>
                              {element.caption}
                            </div>
                          )}
                        </div>
                      );
                    case 'youtube':
                      return (
                        <div key={element.key} style={{ marginBottom:16, textAlign:'center' }}>
                          <div style={{ 
                            position:'relative', 
                            width:'100%', 
                            height:0, 
                            paddingBottom:'56.25%', // 16:9 aspect ratio
                            borderRadius:8,
                            overflow:'hidden',
                            border:'1px solid #242424'
                          }}>
                            <iframe
                              src={`https://www.youtube.com/embed/${element.videoId}`}
                              style={{
                                position:'absolute',
                                top:0,
                                left:0,
                                width:'100%',
                                height:'100%',
                                border:0
                              }}
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                            />
                          </div>
                        </div>
                      );
                    default:
                      return null;
                  }
                })}
              </div>
            ) : item.history ? (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>History & context</div>
                <div style={{ color:'#e5e5e5', fontSize:14, lineHeight:1.6 }}>{item.history}</div>
              </div>
            ) : null}
            
            {/* Collection Status */}
            <div style={{ marginTop:16 }}>
              {item.kind === 'landmark' ? (
                // Landmark status - based on discovery, not collection
                (() => {
                  const discoveredLandmarks = getDiscoveredLandmarks();
                  const isDiscovered = discoveredLandmarks.includes(item.name);
                  return isDiscovered ? (
                    <div style={{
                      background:'rgba(34,197,94,0.1)', 
                      border:'1px solid rgba(34,197,94,0.3)', 
                      borderRadius:12, 
                      padding:16, 
                      textAlign:'center'
                    }}>
                      <div style={{ fontWeight:600, fontSize:16, color:'#22c55e', marginBottom:4 }}>
                        ✓ Seen
                      </div>
                      <div style={{ color:'#e5e5e5', fontSize:14 }}>
                        Landmark discovered
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      background:'rgba(239,68,68,0.1)', 
                      border:'1px solid rgba(239,68,68,0.3)', 
                      borderRadius:12, 
                      padding:16, 
                      textAlign:'center'
                    }}>
                      <div style={{ fontWeight:600, fontSize:16, color:'#ef4444', marginBottom:4 }}>
                        Not Seen
                      </div>
                      <div style={{ color:'#e5e5e5', fontSize:14 }}>
                        Landmark not discovered
                      </div>
                    </div>
                  );
                })()
              ) : (
                // Item status - based on collection
                collected.some(c => c.id === item.id) ? (
                  <div style={{
                    background:'rgba(34,197,94,0.1)', 
                    border:'1px solid rgba(34,197,94,0.3)', 
                    borderRadius:12, 
                    padding:16, 
                    textAlign:'center'
                  }}>
                    <div style={{ fontWeight:600, fontSize:16, color:'#22c55e', marginBottom:4 }}>
                      ✓ Collected
                    </div>
                    <div style={{ color:'#e5e5e5', fontSize:14 }}>
                      {item.points} points earned
                    </div>
                  </div>
                ) : (
                  <div style={{
                    background:'rgba(249,115,22,0.1)', 
                    border:'1px solid rgba(249,115,22,0.3)', 
                    borderRadius:12, 
                    padding:16, 
                    textAlign:'center'
                  }}>
                    <div style={{ fontWeight:600, fontSize:16, color:'#f97316', marginBottom:4 }}>
                      Not Collected
                    </div>
                    <div style={{ color:'#e5e5e5', fontSize:14 }}>
                      {item.points} points available
                    </div>
                  </div>
                )
              )}
            </div>
            
            {/* Links */}
            {Array.isArray(item.links) && item.links.length>0 && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>Further reading</div>
                <ul style={{ paddingLeft:18, lineHeight:1.6 }}>
                  {item.links.map((l,i)=> (
                    <li key={i}><a href={l.href} target="_blank" rel="noreferrer" style={{ color:'#93c5fd' }}>{l.title || l.href}</a></li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Fullscreen Image Modal */}
      {fullscreenImage && (
        <div style={{
          position:'fixed',
          inset:0,
          background:'rgba(0,0,0,0.9)',
          zIndex:60,
          display:'flex',
          alignItems:'center',
          justifyContent:'center',
          padding:20
        }} onClick={() => setFullscreenImage(null)}>
          <div style={{ position:'relative', maxWidth:'90vw', maxHeight:'90vh' }}>
            <img 
              src={asset(fullscreenImage)} 
              alt="Fullscreen view"
              style={{ 
                maxWidth:'100%', 
                maxHeight:'100%', 
                objectFit:'contain',
                borderRadius:8
              }}
            />
            <button
              onClick={() => setFullscreenImage(null)}
              style={{
                position:'absolute',
                top:-10,
                right:-10,
                background:'rgba(0,0,0,0.7)',
                border:'1px solid rgba(255,255,255,0.3)',
                color:'#fff',
                width:40,
                height:40,
                borderRadius:'50%',
                cursor:'pointer',
                fontSize:20,
                display:'flex',
                alignItems:'center',
                justifyContent:'center'
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ============================
// FINISH VIEW — Instagram story style grid + reset
// ============================
function FinishView({ stack, progress, onDownloadDone, onReset, onBack }){
  const all = enumerateArtefactsForStack(stack);
  const collected = all.filter(a=>progress[`${stack.id}:${a.id}`]);
  const totals = { totalItems: all.length, gotItems: collected.length, totalPts: all.reduce((s,x)=>s+x.points,0), gotPts: collected.reduce((s,x)=>s+x.points,0) };
  
  // State for selected item modal
  const [selectedItem, setSelectedItem] = useState(null);

  // Determine which landmarks were discovered based on collected items
  const getDiscoveredLandmarks = () => {
    // Get all landmarks from the stack
    const landmarks = all.filter(a => a.kind === 'landmark');
    
    // Find landmarks where all their nearbyItems have been collected
    const discoveredLandmarks = landmarks.filter(landmark => {
      if (!landmark.nearbyItems || landmark.nearbyItems.length === 0) {
        return false;
      }
      
      // Check if ALL nearby items for this landmark have been collected
      return landmark.nearbyItems.every(nearbyItemId => 
        collected.some(collectedItem => collectedItem.id === nearbyItemId)
      );
    });
    
    return discoveredLandmarks.map(landmark => landmark.name);
  };

  const discoveredLandmarks = getDiscoveredLandmarks();

  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    return {
      date: date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      }),
      time: date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true 
      })
    };
  };

  async function downloadStory(){
    const canvas = document.createElement('canvas'); 
    canvas.width=1080; 
    canvas.height=1920; 
    const ctx=canvas.getContext('2d');
    
    // Clean dark background
    ctx.fillStyle='#0a0a0a'; 
    ctx.fillRect(0,0,1080,1920);
    
    let yPos = 60;
    
    // Main title - bigger and more prominent
    ctx.fillStyle='#ffffff'; 
    ctx.font='700 64px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; 
    ctx.fillText('HEARTLANDS', 60, yPos);
    yPos += 80;
    
    // Stack name - clean typography
    ctx.fillStyle='#ffffff'; 
    ctx.font='600 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; 
    ctx.fillText(stack.name, 60, yPos);
    yPos += 50;
    
    // Stack blurb/description
    if(stack.desc) {
      ctx.fillStyle='rgba(255,255,255,0.7)'; 
      ctx.font='400 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; 
      const descLines = stack.desc.match(/.{1,60}/g) || [stack.desc];
      for(const line of descLines) {
        ctx.fillText(line, 60, yPos);
        yPos += 28;
      }
      yPos += 20;
    }
    
    // Progress summary - clean stats
    ctx.fillStyle='rgba(255,255,255,0.8)'; 
    ctx.font='500 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; 
    ctx.fillText(`${totals.gotItems}/${totals.totalItems} items • ${totals.gotPts}/${totals.totalPts} pts`, 60, yPos);
    yPos += 60;
    
    // Landmarks Section - First
    const allLandmarks = all.filter(a => a.kind === 'landmark');
    if(allLandmarks.length > 0) {
      // Section title - larger
      ctx.fillStyle='#ffffff'; 
      ctx.font='600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; 
      ctx.fillText('🏛️ Landmarks', 60, yPos);
      yPos += 50;
      
      // Landmarks grid - 5 columns like items
      const landmarkCols = 5;
      const landmarkSize = 160;
      const landmarkGap = 20;
      const landmarkGridWidth = landmarkCols * landmarkSize + (landmarkCols - 1) * landmarkGap;
      const landmarkStartX = (1080 - landmarkGridWidth) / 2;
      
      for(let i = 0; i < allLandmarks.length; i++) {
        const landmark = allLandmarks[i];
        const isDiscovered = discoveredLandmarks.includes(landmark.name);
        const x = landmarkStartX + (i % landmarkCols) * (landmarkSize + landmarkGap);
        const cy = yPos + Math.floor(i / landmarkCols) * (landmarkSize + 50);
        
        // Simple square background
        ctx.fillStyle = isDiscovered ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, cy, landmarkSize, landmarkSize);
        
        // Simple border
        ctx.strokeStyle = isDiscovered ? '#22c55e' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, cy, landmarkSize, landmarkSize);
        
        // Landmark image
        if(landmark.img) {
          try {
            const landmarkImg = new Image();
            landmarkImg.crossOrigin = 'anonymous';
            landmarkImg.src = asset(landmark.img);
            await landmarkImg.decode();
            const imgSize = landmarkSize - 30;
            const imgX = x + (landmarkSize - imgSize) / 2;
            const imgY = cy + (landmarkSize - imgSize) / 2;
            ctx.drawImage(landmarkImg, imgX, imgY, imgSize, imgSize);
          } catch(e) {
            console.log('Landmark image failed to load');
          }
        }
        
        // Discovered indicator - simple dot
        if(isDiscovered) {
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(x + landmarkSize - 12, cy + 12, 6, 0, 2 * Math.PI);
          ctx.fill();
        }
        
        // Landmark name below - larger
        ctx.fillStyle = isDiscovered ? '#22c55e' : 'rgba(255,255,255,0.7)';
        ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(landmark.name, x + landmarkSize/2, cy + landmarkSize + 25);
        ctx.textAlign = 'left';
      }
      
      yPos += Math.ceil(allLandmarks.length / landmarkCols) * (landmarkSize + 50) + 60;
    }
    
    // Items Section
    const allFixedItems = all.filter(a => a.kind === 'fixed');
    if(allFixedItems.length > 0) {
      // Section title - larger
      ctx.fillStyle='#ffffff'; 
      ctx.font='600 32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; 
      ctx.fillText('📖 Collection', 60, yPos);
      yPos += 50;
      
      // Items grid - simple squares with names
      const cols = 5;
      const itemSize = 160;
      const itemGap = 20;
      const gridWidth = cols * itemSize + (cols - 1) * itemGap;
      const startX = (1080 - gridWidth) / 2;
      
      const imgs = await Promise.all(allFixedItems.map(async a => {
        const src = a.img || thumb(a.name);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = asset(src);
        await img.decode().catch(() => {});
        return { img, a };
      }));
      
      for(let i = 0; i < imgs.length; i++) {
        const {img, a} = imgs[i];
        const isCollected = collected.some(c => c.id === a.id);
        const x = startX + (i % cols) * (itemSize + itemGap);
        const cy = yPos + Math.floor(i / cols) * (itemSize + 50);
        
        // Simple square background
        ctx.fillStyle = isCollected ? 'rgba(34,197,94,0.1)' : 'rgba(255,255,255,0.05)';
        ctx.fillRect(x, cy, itemSize, itemSize);
        
        // Simple border
        ctx.strokeStyle = isCollected ? '#22c55e' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, cy, itemSize, itemSize);
        
        // Item image - centered
        try {
          const imgSize = itemSize - 30;
          const imgX = x + (itemSize - imgSize) / 2;
          const imgY = cy + (itemSize - imgSize) / 2;
          ctx.drawImage(img, imgX, imgY, imgSize, imgSize);
        } catch(e) {
          console.log('Item image failed to draw');
        }
        
        // Collected indicator - simple dot
        if(isCollected) {
          ctx.fillStyle = '#22c55e';
          ctx.beginPath();
          ctx.arc(x + itemSize - 12, cy + 12, 6, 0, 2 * Math.PI);
          ctx.fill();
        }
        
        // Item name below - larger
        ctx.fillStyle = isCollected ? '#22c55e' : 'rgba(255,255,255,0.7)';
        ctx.font = '500 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(a.name, x + itemSize/2, cy + itemSize + 25);
        ctx.textAlign = 'left';
      }
      
      yPos += Math.ceil(allFixedItems.length / cols) * (itemSize + 50) + 40;
    }
    
    // Footer - clean and minimal
    ctx.fillStyle='rgba(255,255,255,0.5)'; 
    ctx.font='400 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; 
    ctx.fillText('Walk. Collect. Argue with the city.', 60, 1850);

    const url = canvas.toDataURL('image/png'); 
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = `heartlands-${stack.id}-story.png`; 
    a.click(); 
    onDownloadDone && onDownloadDone();
  }

  return (
    <section style={{ ...styles.container, paddingTop:24, paddingBottom:24 }}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:12 }}>
          <div>
            <h2 style={{ fontWeight:800, fontSize:22, marginBottom:2 }}>
              Finish — {stack.id === 'jurong' ? 'Jurong Lake' : stack.name}
            </h2>
            <div style={{ ...styles.subtle, fontSize:14, color:'#a3a3a3' }}>
              {stack.id === 'jurong' ? 'The Worker\'s Garden' : 'Historical Expedition'}
            </div>
            <div style={{ ...styles.subtle, fontSize:16, color:'#e5e5e5', marginTop:8, lineHeight:1.4 }}>
              🎉 Congratulations! You've completed your journey through {stack.id === 'jurong' ? 'Jurong Lake' : 'the historical sites'}. 
              Your collection tells the story of {stack.id === 'jurong' ? 'Singapore\'s industrial transformation and the people who built it' : 'the rich history you\'ve discovered'}.
            </div>
          </div>
          <div style={{ marginLeft:'auto', ...styles.subtle, fontSize:12 }}>{totals.gotItems}/{totals.totalItems} items • {totals.gotPts}/{totals.totalPts} pts</div>
        </div>

      {/* Landmarks Section - First */}
      <div style={{ ...styles.card, marginBottom: 16 }}>
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#fff' }}>Landmark Seen</h3>
          <div style={{ ...styles.subtle, fontSize: 14 }}>Places you've explored on your journey</div>
        </div>
        
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', 
          gap: 12 
        }}>
          {all.filter(a => a.kind === 'landmark').map(landmark => {
            const isDiscovered = discoveredLandmarks.includes(landmark.name);
            
            return (
              <div 
                key={landmark.id} 
                onClick={() => setSelectedItem(landmark)}
                style={{
                  background: isDiscovered 
                    ? 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.05) 100%)'
                    : 'linear-gradient(135deg, rgba(239,68,68,0.1) 0%, rgba(239,68,68,0.05) 100%)',
                  border: isDiscovered ? '2px solid #22c55e' : '2px solid #ef4444',
                  borderRadius: 12,
                  padding: 12,
                  textAlign: 'center',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = 'none';
                }}
              >
                {/* Discovered badge */}
                {isDiscovered && (
                  <div style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    background: '#22c55e',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 'bold',
                    padding: '2px 5px',
                    borderRadius: 6,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    zIndex: 10
                  }}>
                    ✓ Seen
                  </div>
                )}
                
                <img 
                  src={asset(landmark.img || 'img/compass.png')} 
                  alt={landmark.name}
                  style={{
                    width: 60,
                    height: 60,
                    objectFit: 'cover',
                    borderRadius: 8,
                    marginBottom: 8,
                    display: 'block',
                    margin: '0 auto 8px auto'
                  }}
                />
                <div style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: isDiscovered ? '#22c55e' : '#ef4444'
                }}>
                  {landmark.name}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Collection Stamp Book - Second */}
      <div style={{ ...styles.card }}>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: '#fff' }}> Items Collected</h3>
          <div style={{ ...styles.subtle, fontSize: 14 }}>All items from your journey</div>
        </div>

        {/* All Items Grid (Collected + Uncollected) */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px,1fr))', gap:12, marginBottom: 24 }}>
          {all.filter(a => a.kind === 'fixed').map(a => {
            const isCollected = collected.some(c => c.id === a.id);
            const progressData = progress[`${stack.id}:${a.id}`];
            const timestamp = progressData ? formatTimestamp(progressData.when) : null;
            
            return (
              <div 
                key={a.id} 
                onClick={() => setSelectedItem(a)}
                style={{ 
                  border: isCollected ? '2px solid #22c55e' : '2px solid #f97316', 
                  borderRadius:12, 
                  overflow:'hidden',
                  background: isCollected 
                    ? 'linear-gradient(135deg, rgba(34,197,94,0.1) 0%, rgba(34,197,94,0.05) 100%)'
                    : 'linear-gradient(135deg, rgba(249,115,22,0.1) 0%, rgba(249,115,22,0.05) 100%)',
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease'
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = 'translateY(-2px)';
                  e.target.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = 'translateY(0)';
                  e.target.style.boxShadow = 'none';
                }}
              >
                {/* Stamp effect for collected items */}
                {isCollected && (
                  <div style={{
                    position: 'absolute',
                    top: 6,
                    right: 6,
                    background: '#22c55e',
                    color: '#fff',
                    fontSize: 9,
                    fontWeight: 'bold',
                    padding: '2px 5px',
                    borderRadius: 6,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    zIndex: 10
                  }}>
                    ✓ Collected
                  </div>
                )}
                
                <img 
                  src={asset(a.img || thumb(a.name))} 
                  alt={a.name} 
                  style={{ 
                    width:'100%', 
                    height:100, 
                    objectFit:'cover', 
                    display:'block',
                    borderBottom: isCollected 
                      ? '1px solid rgba(34,197,94,0.2)' 
                      : '1px solid rgba(249,115,22,0.2)'
                  }} 
                />
                
                <div style={{ padding:'10px' }}>
                  <div style={{ 
                    fontSize:12, 
                    fontWeight:600, 
                    marginBottom:4,
                    color: '#fff'
                  }}>
                    {a.name}
                  </div>
                  
                  {isCollected && timestamp && (
                    <div style={{ 
                      fontSize:10, 
                      color:'#a3a3a3',
                      lineHeight: 1.2
                    }}>
                      <div>📅 {timestamp.date}</div>
                      <div>🕐 {timestamp.time}</div>
                    </div>
                  )}
                  
                  <div style={{ 
                    fontSize:10, 
                    color: isCollected ? '#22c55e' : '#f97316',
                    fontWeight: 500,
                    marginTop: 4
                  }}>
                    {isCollected ? `+${a.points} pts` : `${a.points} pts`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Summary Stats */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          padding: '16px 0',
          borderTop: '1px solid #2a2a2a',
          marginBottom: 16
        }}>
          <div style={{ ...styles.subtle, fontSize: 14 }}>
            <div>📦 {collected.length}/{all.filter(a => a.kind === 'fixed').length} items collected</div>
            <div>🏛️ {discoveredLandmarks.length} landmarks discovered</div>
          </div>
          <div style={{ 
            fontSize: 18, 
            fontWeight: 700, 
            color: '#22c55e' 
          }}>
            {totals.gotPts} pts
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
          <button onClick={downloadStory} style={{ ...styles.button }}>📱 Download Story</button>
          <button onClick={onReset} style={{ ...styles.button, background:'#111', color:'#e5e5e5' }}>🏠 Return Home & Reset</button>
        </div>
      </div>
      
      {/* Selected Item Modal - Same as ArtefactModal with Rich Content */}
      {selectedItem && (
        <FinishItemModal 
          item={selectedItem} 
          onClose={() => setSelectedItem(null)} 
          collected={collected}
          all={all}
          getDiscoveredLandmarks={getDiscoveredLandmarks}
        />
      )}
    </section>
  );
}
