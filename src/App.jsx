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
    <div style="width:42px; height:42px; border-radius:10px; overflow:hidden;">
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
      <div style="margin-top:4px; font-size:11px; font-weight:600; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.8); display:inline-block; max-width:80px; word-wrap:break-word; text-align:center; line-height:1.2;">
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

        // New items from database.csv
        { id:"fishing-rod", name:"Fishing Rod", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.3401631,lng:103.7247079}, img:"img/rod.png", blurb:"Prawn Ponds & More", history:"Prawn Ponds & More" },
        { id:"tire", name:"Car Tire", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.334457,lng:103.7280321}, img:"img/tire.png", blurb:"Allotment gardens and rubber history", 
          richHistory: `You are now standing in Jurong Lake Gardens' allotment gardens. These are green spaces where aspiring gardeners can lease small plots to grow vegetables, herbs, and fruits. Across Singapore, there are now more than 2,400 allotment plots in 28 parks and gardens. Under NParks' Allotment Gardening Scheme, households can ballot for a raised planter bed, complete with soil and storage space, at just over $62 a year. Schemes like Gardening with Edibles have encouraged more Singaporeans to grow their own food, with a goal of 3,000 allotment plots by 2030.

This is not the first time the banks of the Jurong River have been used for farming. In the 19th century, plantations of gambier and pepper cleared the surrounding jungles, but the crop quickly exhausted the soil. By the early 1900s, global demand for rubber transformed Jurong again. With the booming automobile industry requiring rubber for tyres, Malaya supplied half the world's production by 1920. Much of it was traded through Singapore, which became the "rubber capital of the world."

Rubber estates soon dominated Jurong's landscape, owned by figures such as Chew Boon Lay, Tan Lark Sye, and members of the Chettiar community. Chew's plantation was so extensive and prominent that the area itself, and later the Boon Lay MRT station, took his name from him.` },

 
        { id:"yin-and-yang-token", name:"Yin and Yang Token", kind:"fixed", points:10, radiusM:25, searchRadiusM:30, radiusColourM:"#FFBF00", coords:{lat:1.3396371,lng:103.7283051}, img:"img/yinyang.png", blurb:"Balance is one of the guiding principles", 
          richHistory: `Balance is one of the guiding principles of the Chinese Garden, and it greets you from the very entrance. Guarding the gates are two mighty marble lions, symbols of authority and felicity. They always appear in pairs, manifesting yin and yang. The male lion rests his paw on an embroidered ball, representing the external and material world. The female steadies a cub beneath her paw, symbolising the cycle of life and the living spirit within. Together, they protect both the structure and the soul. In some traditions the male's mouth is open while the female's is closed, forming the sacred syllable "om" - creation and completion.

The theme of balance continues deeper inside. In front of you, the Twin Pagodas embody yin and yang in architectural form. The broader Cloud Draping Tower (Pi Yun Ge) represents Yang, active and expansive, its very name evoking clouds enveloping the sky. Opposite it, the slender Moon Receiving Tower (Yeh Yueh Lou) represents Yin, receptive and nurturing, welcoming the moon's gentle light. Both rise three storeys high, reflecting the auspicious use of odd numbers in Chinese architecture.

More generally, during the construction of the Chinese Garden in the early 1970s, great attention was paid to harmony and proportion. Traditional Chinese architects decreed that every structure must be balanced in height and size, and that buildings should harmonise with plants, flowing streams, and winding pebble paths. The contractors overseeing construction made multiple trips to China to study classical styles and consult experts, ensuring that every element of Jurong's Chinese Garden reflected this enduring principle of balance.

On a grander level, when looking at the lake as a whole, where the Chinese Garden is designed to be visually exciting, the Japanese Gardens are designed with a calmness to evoke inner peace and a meditative state.` },

        // New items from database_2.csv
        { id:"cannon", name:"Cannon", kind:"fixed", points:10, radiusM:25, searchRadiusM:30, radiusColourM:"#22c55e", coords:{lat:1.3414779,lng:103.7237969}, img:"img/cannon.png", blurb:"Commodore Matthew Perry's American East India Squadron", 
          richHistory: `Commodore Matthew Perry's American East India Squadron undertook its now-famous expedition that forced Japan to open to world trade. Less well-known is the fact that Perry's squadron stopped in Singapore before Japan, where its officers surveyed the Jurong River.

[img:perry.jpg:The earliest known illustration of the Jurong River, created by Perry's expedition artists in 1853]

The survey of Jurong produced what is today the earliest known illustration of the Jurong River. Created by the expedition's artists, Peter Wilhelm Heine and Eliphalet Brown, the lithograph depicts Malay stilt houses, a canoe flying the United States flag, and Jurong's dense vegetation.

https://www.youtube.com/watch?v=MaZ95O6RmAc

In the distance, fires are shown beyond the trees, likely representing the frequent kampong blazes of the era, or the boiling cauldrons used for processing gambier leaves. This historical document provides a rare glimpse into Singapore's landscape before industrialization transformed the region.` },

        { id:"lake-lookout", name:"Lake Lookout", kind:"landmark", points:0, radiusM:25, searchRadiusM:50, radiusColourM:"#808080", coords:{lat:1.3430237,lng:103.7227063}, img:"img/lookout.jpg", blurb:"The lake in front of you today did not exist 50 years ago", 
          richHistory: `The lake in front of you today did not exist 50 years ago. Before its creation, this was Sungei Jurong — a winding river running down to the sea, bordered by mangrove forests, mudflats, and sandbanks. In the 1960s, as part of Singapore's industrialisation push, planners at the Economic Development Board (EDB), and then the newly formed Jurong Town Corporation (JTC), decided to reshape the river into a lake. This was to make it easier to supply water for factories while also laying the groundwork for recreational amenities.

[img: river.png]

Urban planners wanted Jurong to be more than just an industrial town. Conceived as Singapore's first garden industrial estate, 12 percent of its land was set aside for parks, gardens, and open spaces. The Jurong Lake area was planned as a vital green lung to separate factories from residential zones. At the inaugural JTC meeting in June 1968, Finance Minister Goh Keng Swee described a vision of eight islands within the lake, linked by bridges and landscaped into themed gardens. In practice, only three of these were built: one for the Japanese Garden, the Chinese Garden, and one for a golf course. Goh's aviary later became Jurong Bird Park near Jurong Hill, while the last two islands were never realised. In 1971, the upper section of the Jurong River was dammed, formally creating the 81-hectare Jurong Lake. Today, it functions as both a reservoir and a planned landscape`, nearbyItems: ["sandbag"] },

        { id:"sandbag", name:"Sandbag", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#FFBF00", coords:{lat:1.3430237,lng:103.7227063}, img:"img/sandbags.jpg", blurb:"The lake in front of you today did not exist 50 years ago", 
          richHistory: `The lake in front of you today did not exist 50 years ago. Before its creation, this was Sungei Jurong — a winding river running down to the sea, bordered by mangrove forests, mudflats, and sandbanks. In the 1960s, as part of Singapore's industrialisation push, planners at the Economic Development Board (EDB), and then the newly formed Jurong Town Corporation (JTC), decided to reshape the river into a lake. This was to make it easier to supply water for factories while also laying the groundwork for recreational amenities.

          [img: river.png]

Urban planners wanted Jurong to be more than just an industrial town. Conceived as Singapore's first garden industrial estate, 12 percent of its land was set aside for parks, gardens, and open spaces. The Jurong Lake area was planned as a vital green lung to separate factories from residential zones. At the inaugural JTC meeting in June 1968, Finance Minister Goh Keng Swee described a vision of eight islands within the lake, linked by bridges and landscaped into themed gardens. In practice, only three of these were built: one for the Japanese Garden, the Chinese Garden, and one for a golf course. Goh's aviary later became Jurong Bird Park near Jurong Hill, while the last two islands were never realised. In 1971, the upper section of the Jurong River was dammed, formally creating the 81-hectare Jurong Lake. Today, it functions as both a reservoir and a planned landscape` },

 
        { id:"chainsaw", name:"Chainsaw", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.3381212,lng:103.7320312}, img:"img/chainsaw.png", blurb:"You're now at Cascading Creek, a facsimile of a Southeast Asian river", 
          richHistory: `You're now at Cascading Creek, a facsimile of a Southeast Asian river. It hints at what Jurong once was: a tangle of jungle and swamp stitched by the old Jurong River. An amusing account of a police raid on a Jurong counterfeiting den in 1904 captures this:

"Last night at 10.45 Insp. Branagan and a party of detectives raided a house … in the jungle. It would have been a difficult matter even in daylight to get to the house, but at night it was extremely dangerous as the path led through dense jungle and swamp … when the party arrived at the house they were rather done up and some presented a wretched appearance, having been unfortunate enough to fall into swamp holes."

[img:cascadingcreek.jpg]

Jurong's river story is one of twin clearings. Up to the 1820s, Orang Laut and Malay villages lined the river mouths while the interior stayed a green. The first big clearing came in the 19th century: gambier and pepper estates chewed through forest, exhausting soils and shifting on. By the early 1900s, rubber took over; with tyres fuelling the automobile age, Malaya supplied about half the world's rubber by 1920, and Singapore styled itself the "rubber capital of the world." Forest fell to rows of plantation trees; streams were tapped, straightened, and tamed.

[img:industrialisation.jpg]

The second upheaval was industrialisation in the 1960s–70s. As Finance Minister Hon Sui Sen noted at the Chinese Garden's opening, Jurong once "possessed those elements" of lakes, streams, woods, hills, and plains – yet development demanded earth and access. Some corridors, like the upper Jurong River, were set aside; beyond them, many hills were levelled and lowlands infilled with millions of tons of earth. The lake you see today is a by-product of this remaking – Economic Development Board officers converted Sungei Jurong into a managed lake to supply industry and create new leisure on its shores.` },


        { id:"movie-ticket", name:"Movie Ticket", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.3311575,lng:103.7267383}, img:"img/ticket.png", blurb:"Where you are standing once housed the Jurong Drive-In Cinema", 
          richHistory: `Where you are standing once housed the Jurong Drive-In Cinema, run by the Cathay Organisation. Opened on 14 July 1971, it was Singapore's first and only drive-in theatre.

The drive-in could accommodate 900 cars and 300 walk-in visitors in a front gallery, all watching an elevated screen 14.3 by 30.4 metres wide. Tickets cost $2 for adults and $1 for children. Sound was played over nearly 900 standing speakers, with some cars having individual speakers clipped to their windows.

For courting couples, the cinema quickly became a popular destination due to the long drive to the west. Sales executive Felix Goh recalled going on a double date, where the prized back seats were in demand. "We tossed a coin over which couple should occupy the back seat. My friend won," he quipped.

The venue also became notorious for antisocial behaviour, from car and motorcycle racing before shows to sleepless nights for nearby residents. In 1982, a police crackdown impounded 84 motorcycles and issued 20 speeding tickets. Even crime played out here, though not always successfully: in 1977, eight masked youths armed with parangs broke into the cinema office, escaping with only a torchlight worth $5.25.

Practical problems plagued the venue. Without air-conditioning, cars became stifling in Singapore's humid nights, while rain left windscreens fogged or splashed. By the 1980s, attendance had dwindled to 200 viewers a night. The arrival of cheap pirated videotapes sealed its fate, and on 30 September 1985, the Jurong Drive-In closed with just 50 cars present at its final screenings.

Today, both the cinema and the Cathay Organisation that ran it are gone` },

        { id:"bonsai-garden", name:"Bonsai Garden", kind:"landmark", points:0, radiusM:20, searchRadiusM:30, radiusColourM:"#808080", coords:{lat:1.3382391,lng:103.7301145}, img:"img/bonsai.png", blurb:"Opened in 1992, the Bonsai Garden in Jurong's Chinese Garden", 
          richHistory: `Opened in 1992, the Bonsai Garden in Jurong's Chinese Garden is the largest Suzhou-style bonsai garden outside of China. It houses a curated collection of beautifully manicured miniature trees, shaped with artistry and patience.

As you walk through this section, you may notice a shift in atmosphere. The rest of the Chinese Garden was built in the grand, symmetrical Imperial style. In Imperial gardens, glazed tiles, elaborate carvings, and bright colours such as red and yellow dominate, as these were traditionally associated with royalty. By contrast, the Suzhou section is more subdued. Here, dark grey unglazed clay tiles, plainer roofs, and meandering paths create a quieter, humbler aesthetic that complements the bonsai on display.

In its original plans, the Bonsai Garden was meant to showcase over 2,000 bonsai from around the world, arranged in groups according to style and the rocks and plants used. Another 400 bonsai were to be created locally, using raw material from across ASEAN. Although bonsai is a Japanese word, the art itself originated in China, where it is known as penjing or penzai. Penjing often presents miniature landscapes combining rocks, trees, and figurines in a wilder, natural style, while bonsai tends toward a more refined, stylised depiction of single trees. To learn more about bonsai and penjing, visit the Visitors Centre at the western end of this section.

img: sip.jpg

Beyond this garden, Jurong has another connection to Suzhou. In the early 1990s, Singapore was deepening its engagement with China as it began to see investment in China as a natural extension of its economic strategy. In fact, plans for this Bonsai Garden were first unveiled in Suzhou during a two-week trip to China by then-Deputy Prime Minister Lee Hsien Loong. Soon after, then-Senior Minister Lee Kuan Yew proposed a government-to-government venture to build a modern industrial estate in Suzhou, blending Singapore's Jurong Industrial Estate expertise with China's development needs. The China–Singapore Suzhou Industrial Park (CS-SIP) was formally launched on 26 February 1994. Though ultimately successful, the project was highly controversial, with the elder Lee himself criticising bureaucratic hurdles, weak local support, and competition from cheaper nearby sites.`, nearbyItems: ["bonsai"] },

        { id:"bonsai", name:"Bonsai", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#FFBF00", coords:{lat:1.3382391,lng:103.7301145}, img:"img/bonsai.png", blurb:"Opened in 1992, the Bonsai Garden in Jurong's Chinese Garden", 
          richHistory: `Opened in 1992, the Bonsai Garden in Jurong's Chinese Garden is the largest Suzhou-style bonsai garden outside of China. It houses a curated collection of beautifully manicured miniature trees, shaped with artistry and patience.

As you walk through this section, you may notice a shift in atmosphere. The rest of the Chinese Garden was built in the grand, symmetrical Imperial style. In Imperial gardens, glazed tiles, elaborate carvings, and bright colours such as red and yellow dominate, as these were traditionally associated with royalty. By contrast, the Suzhou section is more subdued. Here, dark grey unglazed clay tiles, plainer roofs, and meandering paths create a quieter, humbler aesthetic that complements the bonsai on display.

In its original plans, the Bonsai Garden was meant to showcase over 2,000 bonsai from around the world, arranged in groups according to style and the rocks and plants used. Another 400 bonsai were to be created locally, using raw material from across ASEAN. Although bonsai is a Japanese word, the art itself originated in China, where it is known as penjing or penzai. Penjing often presents miniature landscapes combining rocks, trees, and figurines in a wilder, natural style, while bonsai tends toward a more refined, stylised depiction of single trees. To learn more about bonsai and penjing, visit the Visitors Centre at the western end of this section.

img: sip.jpg

Beyond this garden, Jurong has another connection to Suzhou. In the early 1990s, Singapore was deepening its engagement with China as it began to see investment in China as a natural extension of its economic strategy. In fact, plans for this Bonsai Garden were first unveiled in Suzhou during a two-week trip to China by then-Deputy Prime Minister Lee Hsien Loong. Soon after, then-Senior Minister Lee Kuan Yew proposed a government-to-government venture to build a modern industrial estate in Suzhou, blending Singapore's Jurong Industrial Estate expertise with China's development needs. The China–Singapore Suzhou Industrial Park (CS-SIP) was formally launched on 26 February 1994. Though ultimately successful, the project was highly controversial, with the elder Lee himself criticising bureaucratic hurdles, weak local support, and competition from cheaper nearby sites.` },

        { id:"rasau-walk", name:"Rasau Walk", kind:"landmark", points:0, radiusM:25, searchRadiusM:50, radiusColourM:"#808080", coords:{lat:1.3318083,lng:103.7281636}, img:"img/rasau.png", blurb:"You're now at Rasau Walk, a 300m boardwalk", 
          richHistory: `You're now at Rasau Walk, a 300m boardwalk that showcases a restored freshwater swamp. Before heavy industry reached Jurong, mangroves like these were part of the range of the estuarine crocodile (Crocodylus porosus). Even the old place-names hint at this. Pulau Buaya (Malay for "Crocodile Island") appears on maps dating back all the way to the early 1800s. Reclamation has folded the islet into today's Jurong Island.

[img:crocs.jpg]

Through the 1970s–90s, crocodiles were still occasionally reported around Jurong Lake and the Chinese/Japanese Gardens. Warning signs were still up in the 1980s, and a 1992 news report noted at least three crocodiles seen here over several years (one was even captured by a professional "croc hunter"). Today, you won't find crocodiles in Jurong Lake, with their stronghold in Singapore being up north around Sungei Buloh and the Straits of Johor. If you see a big, scaly reptile here, it's almost certainly the Malayan/Asian water monitor - a cousin of the Komodo dragon and a common sight in Jurong Lake Gardens.

Jurong also had another connection to crocodiles. In the 70s and 80s, the crocodile trade was flourishing in Singapore, with about 90 farms raising crocodiles, exporting over 92,000 kg of crocodile skin in 1980. Crocodile leather handbags and clothing hence became popular items sold to tourists in this period.

[img:crocparadise.jpg]

To capitalise on this interest, the Jurong Town Corporation (JTC) announced plans to open Jurong Crocodile Paradise in 1986. The $10 million park project, which was situated on a plot next to Jurong Bird Park, aimed to provide both entertainment and education, featuring an amusement center, tanning workshops, and a 200-seat auditorium for visitors. The park ultimately closed in 2006 due to financial reasons, being unable to compete with the Singapore Zoo or Bird Park.

Though there is only one crocodile farm left in Singapore, the city-state continues to play a large role in the crocodile skin trade. In 2018, for instance, Singapore was the largest importer of reptile skins from Africa, accounting for 60% of all reptile skins exported. This dominance is largely due to the presence of major tanneries in the country - chief among them, Heng Long Leather. Heng Long has long been a global player, supplying tanned crocodile leather to fashion houses like Hermès and Gucci, even before LVMH (Louis Vuitton Moët Hennessy) acquired a 51% stake in the company in 2011. As Heng Long's executive director Koh Choon Heong once remarked to The Straits Times:

"Few Singaporeans realise that if they own a crocodile-skin bag, it was most likely dyed in their very own backyard."`, nearbyItems: ["crocodile-tooth"] },

        { id:"crocodile-tooth", name:"Crocodile Tooth", kind:"fixed", points:10, radiusM:25, searchRadiusM:30, radiusColourM:"#FFBF00", coords:{lat:1.3318083,lng:103.7281636}, img:"img/tooth.jpg", blurb:"You're now at Rasau Walk, a 300m boardwalk", 
          richHistory: `You're now at Rasau Walk, a 300m boardwalk that showcases a restored freshwater swamp. Before heavy industry reached Jurong, mangroves like these were part of the range of the estuarine crocodile (Crocodylus porosus). Even the old place-names hint at this. Pulau Buaya (Malay for "Crocodile Island") appears on maps dating back all the way to the early 1800s. Reclamation has folded the islet into today's Jurong Island.

[img:crocs.jpg]

Through the 1970s–90s, crocodiles were still occasionally reported around Jurong Lake and the Chinese/Japanese Gardens. Warning signs were still up in the 1980s, and a 1992 news report noted at least three crocodiles seen here over several years (one was even captured by a professional "croc hunter"). Today, you won't find crocodiles in Jurong Lake, with their stronghold in Singapore being up north around Sungei Buloh and the Straits of Johor. If you see a big, scaly reptile here, it's almost certainly the Malayan/Asian water monitor - a cousin of the Komodo dragon and a common sight in Jurong Lake Gardens.

Jurong also had another connection to crocodiles. In the 70s and 80s, the crocodile trade was flourishing in Singapore, with about 90 farms raising crocodiles, exporting over 92,000 kg of crocodile skin in 1980. Crocodile leather handbags and clothing hence became popular items sold to tourists in this period.

[img:crocparadise.jpg]

To capitalise on this interest, the Jurong Town Corporation (JTC) announced plans to open Jurong Crocodile Paradise in 1986. The $10 million park project, which was situated on a plot next to Jurong Bird Park, aimed to provide both entertainment and education, featuring an amusement center, tanning workshops, and a 200-seat auditorium for visitors. The park ultimately closed in 2006 due to financial reasons, being unable to compete with the Singapore Zoo or Bird Park.

Though there is only one crocodile farm left in Singapore, the city-state continues to play a large role in the crocodile skin trade. In 2018, for instance, Singapore was the largest importer of reptile skins from Africa, accounting for 60% of all reptile skins exported. This dominance is largely due to the presence of major tanneries in the country - chief among them, Heng Long Leather. Heng Long has long been a global player, supplying tanned crocodile leather to fashion houses like Hermès and Gucci, even before LVMH (Louis Vuitton Moët Hennessy) acquired a 51% stake in the company in 2011. As Heng Long's executive director Koh Choon Heong once remarked to The Straits Times:

"Few Singaporeans realise that if they own a crocodile-skin bag, it was most likely dyed in their very own backyard."` },

        { id:"twin-pagoda", name:"Twin Pagoda", kind:"landmark", points:0, radiusM:25, searchRadiusM:50, radiusColourM:"#808080", coords:{lat:1.3396371,lng:103.7283051}, img:"img/twinp.png", blurb:"Balance is one of the guiding principles of the Chinese Garden", 
          richHistory: `Balance is one of the guiding principles of the Chinese Garden, and it greets you from the very entrance. Guarding the gates are two mighty marble lions, symbols of authority and felicity. They always appear in pairs, manifesting yin and yang. The male lion rests his paw on an embroidered ball, representing the external and material world. The female steadies a cub beneath her paw, symbolising the cycle of life and the living spirit within. Together, they protect both the structure and the soul. In some traditions the male's mouth is open while the female's is closed, forming the sacred syllable "om" - creation and completion.

The Chinese phrase 乾坤清气 (qián kūn qīng qì) gracing the Grand Arch symbolises "the pure energy of Heaven and Earth", represents the balance of masculine and feminine energies (乾坤).

The theme of balance continues deeper inside. In front of you, the Twin Pagodas embody yin and yang in architectural form. The broader Cloud Draping Tower (Pi Yun Ge) represents Yang, active and expansive, its very name evoking clouds enveloping the sky. Opposite it, the slender Moon Receiving Tower (Yeh Yueh Lou) represents Yin, receptive and nurturing, welcoming the moon's gentle light. Both rise three storeys high, reflecting the auspicious use of odd numbers in Chinese architecture.

More generally, during the construction of the Chinese Garden in the early 1970s, great attention was paid to harmony and proportion. Traditional Chinese architects decreed that every structure must be balanced in height and size, and that buildings should harmonise with plants, flowing streams, and winding pebble paths. The contractors overseeing construction made multiple trips to China to study classical styles and consult experts, ensuring that every element of Jurong's Chinese Garden reflected this enduring principle of balance.

On a grander level, when looking at the lake as a whole, where the Chinese Garden is designed to be visually exciting, the Japanese Gardens are designed with a calmness to evoke inner peace and a meditative state.`, nearbyItems: ["yin-and-yang-token"] },

        { id:"crown", name:"Crown", kind:"fixed", points:10, radiusM:25, searchRadiusM:30, radiusColourM:"#22c55e", coords:{lat:1.3382861,lng:103.7297358}, img:"img/crown.png", blurb:"Along this path you will find eight sculptures of legendary Chinese heroes", 
          richHistory: `Along this path you will find eight sculptures of legendary Chinese heroes, each chosen to embody virtues such as loyalty, righteousness, and patriotism. Among them are Lin Zexu, the Qing official who fought the opium trade in 1840; Zheng He, the Ming navigator whose voyages brought him to Southeast Asia and Africa; Wen Tianxiang, a Song general who resisted the invading Mongols; Hua Mulan, the woman warrior who disguised herself as a man; and Guan Yu, celebrated in the Romance of the Three Kingdoms for loyalty and courage.

[img:statues.jpg]

These sculptures were not state commissions but gifts. In 1991, businessman Goi Seng Hui, better known as Sam Goi, the "Popiah King," donated S$1 million to create and install the statues at Marina City Park, then envisioned as Singapore's premier "City in a Garden" park. Goi expressed hope that they would not be "just another backdrop for wedding photos," but a permanent showcase of values such as filial piety, loyalty, righteousness, benevolence, and love for all races.

Their unveiling sparked public debate. Prime Minister Goh Chok Tong, who officiated the ceremony, said he hoped to see a multicultural representation of heroes at the park, including figures from Malay and Indian traditions. Community leaders suggested that their own legendary heroes, such as the Malay warrior Hang Tuah and the Indian sage Thiruvalluvar, could one day be represented alongside the Chinese figures. Others, however, argued that statues were a low priority compared to urgent needs like improving children's education. MUIS President Zainul Abidin Rasheed added that Malay heroes should be honoured in symbolic rather than physical form.

When Marina City Park closed in 2007 to make way for Gardens by the Bay, the statues were relocated here.

[img:sam_g.jpg]

Sam Goi's own story is tied to Jurong. Arriving in Singapore as a child migrant, he began with little, eventually setting up a mechanical engineering workshop serving businesses in Jurong. In 1977, he diversified by acquiring a small popiah skin factory, Tee Yih Jia, which he transformed into a global frozen foods leader. Its flagship brand Spring Home is now sold worldwide.` },

        { id:"stoneboat", name:"Stoneboat", kind:"landmark", points:0, radiusM:25, searchRadiusM:50, radiusColourM:"#808080", coords:{lat:1.338935,lng:103.7288695}, img:"img/stoneboat.png", blurb:"The Stoneboat is a famous feature of traditional Chinese architecture", 
          richHistory: `The Stoneboat is a famous feature of traditional Chinese architecture, designed so visitors can admire the surrounding scenery while feeling as if they were aboard a vessel floating on water. The version here in Jurong's Chinese Garden follows the Beijing style, with some adaptations in its materials and design.

[img:stoneboat.jpg]

In Singapore, the Stoneboat also served another purpose. In the late 1970s, the Chinese Garden became a popular destination for wedding photography. It was estimated that around 200 couples each month came here in their wedding finery to pose amid the bridges, pavilions, and lakeside views. To serve this demand, in June 1982 the Registry of Marriages opened a branch in the garden's Stone Boat itself. The location offered couples the convenience of solemnising their marriages and taking photographs in the same picturesque setting.

At its peak, at least 100 couples used the Stone Boat registry each month, especially on weekends. But the numbers dwindled after 1984, as couples found it more convenient to marry at the centrally located Fort Canning registry, and the branch soon close.

Across the pond, you'll see the Tea Pavilion, featuring three pavilions connected by a winding corridor, seemingly floating above the Lotus Pond – a design inspired by the Summer Palace. A poetic stone inscription greets visitors, inviting contemplation of the serene surroundings, including views of the Stoneboat.`, nearbyItems: ["wedding-ring"] },

        { id:"wedding-ring", name:"Wedding Ring", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#FFBF00", coords:{lat:1.338935,lng:103.7288695}, img:"img/ring.png", blurb:"The Stoneboat is a famous feature of traditional Chinese architecture", 
          richHistory: `The Stoneboat is a famous feature of traditional Chinese architecture, designed so visitors can admire the surrounding scenery while feeling as if they were aboard a vessel floating on water. The version here in Jurong's Chinese Garden follows the Beijing style, with some adaptations in its materials and design.

Stone boats are not just ornamental. Their boat-like form, blending seamlessly with the water, reflects Taoist ideals of harmony with nature. At the same time, the paradox of a vessel that cannot sail plays with the theme of illusion and reality, so central to Chinese art and literature. These pavilions also served as scholarly retreats, places for poetry and quiet contemplation, and their solidity came to symbolise permanence — an eternal counterpoint to wooden boats that decay or sink.

[img:stoneboat.jpg]

In Singapore, the Stoneboat also served another purpose. In the late 1970s, the Chinese Garden became a popular destination for wedding photography. It was estimated that around 200 couples each month came here in their wedding finery to pose amid the bridges, pavilions, and lakeside views. To serve this demand, in June 1982 the Registry of Marriages opened a branch in the garden's Stone Boat itself. The location offered couples the convenience of solemnising their marriages and taking photographs in the same picturesque setting.

At its peak, at least 100 couples used the Stone Boat registry each month, especially on weekends. But the numbers dwindled after 1984, as couples found it more convenient to marry at the centrally located Fort Canning registry, and the branch soon close.

Across the pond, you'll see the Tea Pavilion, featuring three pavilions connected by a winding corridor, seemingly floating above the Lotus Pond – a design inspired by the Summer Palace. A poetic stone inscription greets visitors, inviting contemplation of the serene surroundings, including views of the Stoneboat.` },

        { id:"cloud-piercing-pagoda", name:"Cloud Pagoda", kind:"landmark", points:0, radiusM:25, searchRadiusM:50, radiusColourM:"#808080", coords:{lat:1.3391409,lng:103.7309275}, img:"img/cloudp.png", blurb:"You are now standing in front of the Cloud Piercing Pagoda", 
          richHistory: `You are now standing in front of the Cloud Piercing Pagoda (Ru Yun T'a), the seven-storey pagoda that rises over the Chinese Garden. Its design is a faithful replica of the Linggu Temple Pagoda in Nanjing, one of many landmarks carefully copied here in Jurong when the garden opened in 1975. Faithful replication was the guiding principle. As Mr Tan, the engineer in charge, explained at the time: "Everything is designed to be as authentic as possible. We don't want a watered-down version."The garden's design principles were based on classical northern Chinese imperial architecture, particular the Song Dynasty period (960-1279).

The 13-arch White Rainbow Bridge echoes Beijing's Seventeen-Arch Bridge. The tea house recreates the meandering corridors of the Summer Palace. On the northern shore, the twin pagodas mirrores the Spring and Autumn Pagodas in Kaohsiung, Taiwan. Together they created, in one reporter's words, a "many-splendoured thing."

But these structures were hard to build. This was the first project of its kind in Singapore, and local labourers had little experience with traditional Chinese architectural techniques. Translating two-dimensional plans into timber, stone, and tile required specialised skills. Workers were trained on the job, guided by Taiwanese mentors who brought their expertise to Jurong.`, nearbyItems: ["hardhat"] },

        { id:"hardhat", name:"Hardhat", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#FFBF00", coords:{lat:1.3391409,lng:103.7309275}, img:"img/hardhat.png", blurb:"You are now standing in front of the Cloud Piercing Pagoda", 
          richHistory: `You are now standing in front of the Cloud Piercing Pagoda (Ru Yun T'a), the seven-storey pagoda that rises over the Chinese Garden. Its design is a faithful replica of the Linggu Temple Pagoda in Nanjing, one of many landmarks carefully copied here in Jurong when the garden opened in 1975. Faithful replication was the guiding principle. As Mr Tan, the engineer in charge, explained at the time: "Everything is designed to be as authentic as possible. We don't want a watered-down version."The garden's design principles were based on classical northern Chinese imperial architecture, particular the Song Dynasty period (960-1279).

The 13-arch White Rainbow Bridge echoes Beijing's Seventeen-Arch Bridge. The tea house recreates the meandering corridors of the Summer Palace. On the northern shore, the twin pagodas mirrores the Spring and Autumn Pagodas in Kaohsiung, Taiwan. Together they created, in one reporter's words, a "many-splendoured thing."

But these structures were hard to build. This was the first project of its kind in Singapore, and local labourers had little experience with traditional Chinese architectural techniques. Translating two-dimensional plans into timber, stone, and tile required specialised skills. Workers were trained on the job, guided by Taiwanese mentors who brought their expertise to Jurong.` },

        { id:"giftbox", name:"Giftbox", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.335076,lng:103.7295396}, img:"img/giftbox.png", blurb:"The Japanese Garden was the first island to be built out on Jurong Lake", 
          richHistory: `The Japanese Garden was the first island to be built out on Jurong Lake, opening in 1973 as the largest Japanese garden outside of Japan at the time. It is also known as Seiwaen, a name derived from Sei (Singapore), Wa (Japan), and En (Garden) — literally "Singapore's Japanese Garden."

The project cost about $3 million, with $1.8 million provided by a Singapore Government grant and the remainder donated, largely by the Japanese Government. Through its Overseas Technical Cooperation Agency, Japan contributed the expertise of Professor Kinsaku Nakane, the country's leading garden and landscape artist at the time. Designing the garden with his assistants, he took inspiration from the aesthetics of gardens during the Muromachi period (1392-1568) and the Momoyama period (1568-1615).

The Japanese Chamber of Commerce also contributed 500 tons of rocks, valued at over $180,000, along with 10 stone lanterns. Some of these lanterns can still be seen in front of you today.

This tradition of gifting continues. In 2021, US chipmaker Micron Technology donated S$1 million to support the development of the Water Lily Pond at the Japanese Garden. Their contribution funded a smart water management system that uses natural vegetation and microbes to filter the water, with sensors monitoring quality in real time.` },

        { id:"grasslands", name:"Grasslands", kind:"landmark", points:0, radiusM:25, searchRadiusM:50, radiusColourM:"#808080", coords:{lat:1.3326227,lng:103.7274602}, img:"img/grassland.png", blurb:"You're now in the Grasslands of Lakeside Gardens", 
          richHistory: `You're now in the Grasslands of Lakeside Gardens, a rolling patch of tall grass and gentle mounds. It forms part of the intertidal habitat, found within freshwater swamp forests, transiting from dry grassland of the inland area towards wet grasslands at the shore edge. Over 3.5 hectare in size, the Grasslands aim to create a transition that provides refuge areas and nesting grounds for both migratory and resident avian population.

Three bird hides ring the area, perfect for observing the over 205 bird species that have spotting at Jurong Lake. The gardens is said to be one of the five bird watching hotspots in Singapore with over 200 species recorded.

[img:brahminy.jpg]

Keep an eye out for grassland regulars: paddyfield pipit (a brown ground-runner that tail-bobs between clumps) and the long-tailed shrike (the black-masked perch-hunter. Listen for the zitting cisticola (making its "zit-zit" display flights overhead). Over the mounds, raptors patrol – black-winged kite (hovering white-grey in the wind, and the brahminy kite (chestnut body, white head and breast) which has even been seen perching on the Lone Tree. Speaking of the Lone Tree, it is a sculpture, forged from recycled iron reinforcing bars salvaged from the old Jurong Lake Park, alluding to Jurong's industrial origins.

[img:lonetree.jpg]

This area also links to a bigger bird story. In 1967–68, Finance Minister Goh Keng Swee floated the idea of starting an aviary after visits to similar facilities in Rio and Bangkok. While a 20.4-hectare site on Jurong Hill became Jurong Bird Park in 1971, an early notion was to situate the park on the island just across the water from here. That land instead hosted a golf course from the 1970s till 2017, when it was cleared for the planned Singapore–Kuala Lumpur High-Speed Rail terminus. With the HSR cancelled, the site today remains a white plot, held for detailed planning.`, nearbyItems: ["feather"] },

        { id:"feather", name:"Feather", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#FFBF00", coords:{lat:1.3326227,lng:103.7274602}, img:"img/feather.png", blurb:"You're now in the Grasslands of Lakeside Gardens", 
          richHistory: `You're now in the Grasslands of Lakeside Gardens, a rolling patch of tall grass and gentle mounds. It forms part of the intertidal habitat, found within freshwater swamp forests, transiting from dry grassland of the inland area towards wet grasslands at the shore edge. Over 3.5 hectare in size, the Grasslands aim to create a transition that provides refuge areas and nesting grounds for both migratory and resident avian population.

Three bird hides ring the area, perfect for observing the over 205 bird species that have spotting at Jurong Lake. The gardens is said to be one of the five bird watching hotspots in Singapore with over 200 species recorded.

[img:brahminy.jpg]

Keep an eye out for grassland regulars: paddyfield pipit (a brown ground-runner that tail-bobs between clumps) and the long-tailed shrike (the black-masked perch-hunter. Listen for the zitting cisticola (making its "zit-zit" display flights overhead). Over the mounds, raptors patrol – black-winged kite (hovering white-grey in the wind, and the brahminy kite (chestnut body, white head and breast) which has even been seen perching on the Lone Tree. Speaking of the Lone Tree, it is a sculpture, forged from recycled iron reinforcing bars salvaged from the old Jurong Lake Park, alluding to Jurong's industrial origins.

[img:lonetree.jpg]

This area also links to a bigger bird story. In 1967–68, Finance Minister Goh Keng Swee floated the idea of starting an aviary after visits to similar facilities in Rio and Bangkok. While a 20.4-hectare site on Jurong Hill became Jurong Bird Park in 1971, an early notion was to situate the park on the island just across the water from here. That land instead hosted a golf course from the 1970s till 2017, when it was cleared for the planned Singapore–Kuala Lumpur High-Speed Rail terminus. With the HSR cancelled, the site today remains a white plot, held for detailed planning.` },

        { id:"megaphone", name:"Megaphone", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.3353566,lng:103.7306983}, img:"img/megaphone.png", blurb:"You're now in the Sunken Garden, a gorge-like passage", 
          richHistory: `You're now in the Sunken Garden, a gorge-like passage where walls rise to 3.5 m and drip with more than 200 epiphyte species (plants that grow on other plants or structures). A living moss wall of Paras stone keeps the air cool and damp. At its heart, a cenote-inspired water feature acts as both showpiece and rain-harvesting system – an air-well that draws daylight down to a still pool and recycles stormwater through the garden (a "cenote" is a natural sinkhole formed when limestone collapses to expose groundwater, most famously on Mexico's Yucatán Peninsula).

[img:cenote.jpg]

Walk out of the passage and you enter the Floral Garden, a showcase partly imagined and laid out by students from ITE College East, NAFA, and Singapore Polytechnic. The garden is used as a practical learning platform to let students design planting plots and learn about the evolution of a landscape.

Both spaces were shaped by the community. NParks set out to make Jurong Lake "a people's garden", by the people, for the people, and "more than 32,000 voices" fed into its design. During the design stage, a roaming exhibition and townhall sessions surfaced priorities; during construction, tree-planting days and public displays kept the loop open. One clear preference - "water-sensitive" landscapes - now runs through the precinct: from the cenote lightwell and rain-recycling pool in the Sunken Gardens to the Water Lily Garden beyond.` },

        { id:"cobwebs", name:"Cobwebs", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.3363554,lng:103.7307327}, img:"img/cobwebs.png", blurb:"You're now walking the newly rejuvenated Japanese Garden", 
          richHistory: `You're now walking the newly rejuvenated Japanese Garden. In the late 1980s–2000s, these once-showpiece islands drifted into neglect; peeling paint, thinning crowds, and a murky lake.

[img:news1.jpg]

A 1994 letter to The Straits Times caught the mood: the "grand" approach from Chinese Garden MRT felt flat - a small ticket kiosk, a tired bridge. Inside, debris floated on the lake, paint flaked from bridges, and rest spots were scarce. Another visitor called the Japanese Garden "run down and neglected": carp gone from the ponds, a forlorn shelter with a lone hawker, stonework and bridges in disrepair. Two beautiful and historic gardens - starved of care.

The turn began in 2008, when URA unveiled the Jurong Lake District blueprint, Singapore's "second CBD" wrapped around a 220-hectare lakeside with 70 hectares of water. Plans promised new green space, an enhanced promenade, and a waterfront park by Lakeside MRT, with the Chinese and Japanese Gardens earmarked for fresh facilities and livelier programming.

[https://www.youtube.com/watch?v=LFCubeVXzYQ]

A decade on, momentum became mandate. In June 2014, then-PM Lee Hsien Loong apparently visited the gardens and noted that "still looked basically the same as they did in the 1970s", asking planners to consider rework the gardens. At the National Day Rally that year a single National Garden, Jurong Lake Gardens, uniting the Chinese Garden, Japanese Garden, and Jurong Lake Park, alongside a new Science Centre on the lake's north shore was announced. In September 2024, the rejuvenated Chinese and Japanese Gardens finally reopened, officiated by Senior Minister Lee Hsien Loong.` },

        { id:"bamboo", name:"Bamboo", kind:"fixed", points:10, radiusM:20, searchRadiusM:25, radiusColourM:"#22c55e", coords:{lat:1.33767,lng:103.72968}, img:"img/bamboo.png", blurb:"You're now at the Bamboo Grove and waterfall", 
          richHistory: `You're now at the Bamboo Grove and waterfall, where wind off the falling water is intended to turn the bamboo tunnel into a "cool corridor."

[img:oldwaterfall.jpg]

But did you know that Jurong might have once had an actual waterfall? On two historic maps (1873 and 1911), the label "Ayer Toorjoon" appears at a meander of Sungei Jurong - likely a misspelling of Air Terjun (Malay for "waterfall")- opposite the river, southeast of today's Japanese Garden and near the current Science Centre site. The name vanishes from maps after 1911, and not much else is known about the mystery waterfall.

[img:waterfall.jpg]

Jurong has another connection to waterfalls. When Jurong Bird Park opened in 1971, its aviary carried a 30-metre man-made waterfall - then among the tallest anywhere. Though the Bird Park has now shifted to Mandai, planners have said they'll consider existing features like the waterfall and Jurong Hill Tower as they rethink the hill, and will seek public feedback to shape what comes next.

Singapore's obsession with artificial large waterfalls (literally) reached new heights in 2019, when Jewel Changi Airport – a nature-themed entertainment and retail complex – opened with a a 40-metre indoor waterfall, that is the world's largest.` },

        { id:"film-camera", name:"Film Camera", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.3280068,lng:103.728657}, img:"img/camera.png", blurb:"You're looking at a construction site that was once a theme park and film set", 
          richHistory: `You're looking at a construction site that was once a theme park and film set. Tang Dynasty City was a film-town theme park was built to jump-start a local screen industry, with backing from Economic Development Board and the Singapore Tourism Promotion Board. The park had many attractions – a 3m tall life-size replica of the Great Wall of China, arched bridges, pagodas, and, later, replica terracotta warriors.

[img:tangcity.jpg]

During construction, budgets swelled from the original S$50 million to S$70 million, with talk of a S$100 million war chest and a hotel next door. The park opened in 1992, but the part studio, part heritage set never quite worked as a theme park. Few rides, a steep S$15 ticket (then far pricier than Sentosa), and exhibits that felt static. What thrilled visitors were the live shows, acrobats vaulting through courtyards, sword fights erupting on the arch bridge and

[https://www.youtube.com/watch?v=B8HFN2H73EU&themeRefresh=1]

As a studio, it saw little camera time. One notable feature film, the 1993 Hong Kong New Year comedy All's Well, Ends Well Too, used the sets, most productions looked elsewhere. Attendance ebbed through the mid-90s and the Asian Financial Crisis dealt the final blow.

[img:abandoned.jpg]

Closing in 1999, the park remained abandoned till 2008, when it was levelled. Today the plot is being remade as Taman Jurong Skyline, a new HDB blocks with views over Jurong Lake Gardens.

[Hyperlink: Check out this blog post from the early internet (1994) from an American couple visiting the attraction: http://www.anniebees.com/Asia/Asia6.htm]` },

        { id:"grand-arch", name:"Grand Arch", kind:"landmark", points:0, radiusM:25, searchRadiusM:50, radiusColourM:"#808080", coords:{lat:1.3382537,lng:103.7281902}, img:"img/arch.png", blurb:"You're now standing before the Grand Arch of the Chinese Garden", 
          richHistory: `You're now standing before the Grand Arch of the Chinese Garden. The four characters above you, 乾坤清气 (qián kūn qīng qì), speak of "the pure energy of Heaven and Earth": 乾坤 for the cosmic pair (yang and yin), 清气 for pure vitality.

Look up at the roofline. Two open-mouthed dragons bite the main ridge to "hold" it fast against ill winds, while a procession of mythical roof beasts—set out at the corners in order of seniority—stand watch.

[img:turtle.jpg]

Just behind this arch once sat a beloved oddity: the Live Turtle & Tortoise Museum, started in 2001 by Connie and Danny Tan to share their pet collection. At its peak it held some 800 animals across 50-plus species such as the long-necked snake-headed turtles, the otherworldly mata-mata, even a regal golden softshell. These animals spread through ponds and tanks where visitors could buy greens to feed (and were warned to mind their fingers). In 2019, as the islands closed for renovation, the museum relocated to Yishun.

[img:foodfactory.jpg]

Today the space behind the Grand Arch hosts a few attractions -the Jurong Lake Gardens Gallery with stories of the lake and its making; the Plant Factory, an indoor showcase for sustainable horticulture; and Canopy, a pet- and family-friendly spot looking over the Edible Garden.`, nearbyItems: ["turtle-shell"] },

        { id:"turtle-shell", name:"Turtle Shell", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#FFBF00", coords:{lat:1.3382537,lng:103.7281902}, img:"img/shell.png", blurb:"You're now standing before the Grand Arch of the Chinese Garden", 
          richHistory: `You're now standing before the Grand Arch of the Chinese Garden. The four characters above you, 乾坤清气 (qián kūn qīng qì), speak of "the pure energy of Heaven and Earth": 乾坤 for the cosmic pair (yang and yin), 清气 for pure vitality.

Look up at the roofline. Two open-mouthed dragons bite the main ridge to "hold" it fast against ill winds, while a procession of mythical roof beasts—set out at the corners in order of seniority—stand watch.

[img:turtle.jpg]

Just behind this arch once sat a beloved oddity: the Live Turtle & Tortoise Museum, started in 2001 by Connie and Danny Tan to share their pet collection. At its peak it held some 800 animals across 50-plus species such as the long-necked snake-headed turtles, the otherworldly mata-mata, even a regal golden softshell. These animals spread through ponds and tanks where visitors could buy greens to feed (and were warned to mind their fingers). In 2019, as the islands closed for renovation, the museum relocated to Yishun.

[img:foodfactory.jpg]

Today the space behind the Grand Arch hosts a few attractions -the Jurong Lake Gardens Gallery with stories of the lake and its making; the Plant Factory, an indoor showcase for sustainable horticulture; and Canopy, a pet- and family-friendly spot looking over the Edible Garden.` },

        { id:"snake", name:"Snake", kind:"fixed", points:10, radiusM:25, searchRadiusM:50, radiusColourM:"#22c55e", coords:{lat:1.334165,lng:103.7332092}, img:"img/snake.png", blurb:"Where you are standing lies one of the original bends of the Sungei Jurong", 
          richHistory: `Where you are standing lies one of the original bends of the Sungei Jurong, the river that was later dammed and reshaped into Jurong Lake. Before its transformation, the river wound its way across the landscape, forming a distinctive "S" shape — curving east of today's Japanese Garden and then west of the Chinese Garden.

This serpentine course inspired the plans to convert the meandering river into a managed lake. At the inaugural meeting of the Jurong Town Corporation in June 1968, Finance Minister Goh Keng Swee described the vision: "A large park is being constructed on the west bank of the river. Eight man-made islands will be created in the river by dredging the necks of the promontories produced by the winding shape of the river; the river will then be converted into a lake."` },

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
// Icon Ticker Component
function IconTicker() {
  const iconImages = [
    'img/rod.png', 'img/tire.png', 'img/yinyang.png', 'img/cannon.png', 'img/lookout.jpg',
    'img/sandbags.jpg', 'img/chainsaw.png', 'img/ticket.png', 'img/bonsai.png', 'img/rasau.png',
    'img/tooth.jpg', 'img/twinp.png', 'img/crown.png', 'img/stoneboat.png', 'img/ring.png',
    'img/cloudp.png', 'img/hardhat.png', 'img/giftbox.png', 'img/grassland.png', 'img/feather.png',
    'img/megaphone.png', 'img/cobwebs.png', 'img/bamboo.png', 'img/camera.png', 'img/arch.png',
    'img/shell.png', 'img/snake.png'
  ];

  // Create 3 seamless random streams - each with 30 icons that repeat perfectly
  // Use useMemo to ensure icons are generated only once and persist across re-renders
  const row1Icons = useMemo(() => {
    const stream = [];
    // Create 30 random icons with no consecutive duplicates
    for (let i = 0; i < 30; i++) {
      let randomIcon;
      do {
        randomIcon = iconImages[Math.floor(Math.random() * iconImages.length)];
      } while (i > 0 && randomIcon === stream[i - 1]); // Ensure no consecutive duplicates
      stream.push(randomIcon);
    }
    return stream;
  }, []);

  const row2Icons = useMemo(() => {
    const stream = [];
    // Create 30 random icons with no consecutive duplicates
    for (let i = 0; i < 30; i++) {
      let randomIcon;
      do {
        randomIcon = iconImages[Math.floor(Math.random() * iconImages.length)];
      } while (i > 0 && randomIcon === stream[i - 1]); // Ensure no consecutive duplicates
      stream.push(randomIcon);
    }
    return stream;
  }, []);

  const row3Icons = useMemo(() => {
    const stream = [];
    // Create 30 random icons with no consecutive duplicates
    for (let i = 0; i < 30; i++) {
      let randomIcon;
      do {
        randomIcon = iconImages[Math.floor(Math.random() * iconImages.length)];
      } while (i > 0 && randomIcon === stream[i - 1]); // Ensure no consecutive duplicates
      stream.push(randomIcon);
    }
    return stream;
  }, []);

  // Create multiple rows with different speeds - TRULY SEAMLESS
  const createTickerRow = (icons, speed, delay) => (
    <div
      style={{
        display: 'flex',
        gap: '8px', // Slight gaps between icons
        padding: '0px',
        width: '600%', // Six times width for 6 sets of icons
        animation: `scroll ${speed}s linear infinite`,
        animationDelay: `${delay}s`
      }}
    >
      {/* First set of icons */}
      {icons.map((icon, index) => (
        <div
          key={`first-${icon}-${index}`}
          className="ticker-icon-container"
          style={{
            width: '96px', // Bigger containers for bigger icons
            height: '96px', // Bigger containers for bigger icons
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <img
            src={icon}
            alt=""
            className="ticker-icon"
            style={{
              width: '72px', // Even bigger icons
              height: '72px', // Even bigger icons
              objectFit: 'contain',
              filter: 'brightness(1.5) contrast(1.4) saturate(1.0)' // Much brighter and more vibrant icons
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      ))}
      {/* Second set of icons */}
      {icons.map((icon, index) => (
        <div
          key={`second-${icon}-${index}`}
          className="ticker-icon-container"
          style={{
            width: '96px', // Bigger containers for bigger icons
            height: '96px', // Bigger containers for bigger icons
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <img
            src={icon}
            alt=""
            className="ticker-icon"
            style={{
              width: '72px', // Even bigger icons
              height: '72px', // Even bigger icons
              objectFit: 'contain',
              filter: 'brightness(1.8) contrast(1.4) saturate(1.3)' // Much brighter and more vibrant icons
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      ))}
      {/* Third set of icons */}
      {icons.map((icon, index) => (
        <div
          key={`third-${icon}-${index}`}
          className="ticker-icon-container"
          style={{
            width: '96px', // Bigger containers for bigger icons
            height: '96px', // Bigger containers for bigger icons
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <img
            src={icon}
            alt=""
            className="ticker-icon"
            style={{
              width: '72px', // Even bigger icons
              height: '72px', // Even bigger icons
              objectFit: 'contain',
              filter: 'brightness(1.8) contrast(1.4) saturate(1.3)' // Much brighter and more vibrant icons
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      ))}
      {/* Fourth set of icons */}
      {icons.map((icon, index) => (
        <div
          key={`fourth-${icon}-${index}`}
          className="ticker-icon-container"
          style={{
            width: '96px', // Bigger containers for bigger icons
            height: '96px', // Bigger containers for bigger icons
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <img
            src={icon}
            alt=""
            className="ticker-icon"
            style={{
              width: '72px', // Even bigger icons
              height: '72px', // Even bigger icons
              objectFit: 'contain',
              filter: 'brightness(1.8) contrast(1.4) saturate(1.3)' // Much brighter and more vibrant icons
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      ))}
      {/* Fifth set of icons */}
      {icons.map((icon, index) => (
        <div
          key={`fifth-${icon}-${index}`}
          className="ticker-icon-container"
          style={{
            width: '96px', // Bigger containers for bigger icons
            height: '96px', // Bigger containers for bigger icons
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <img
            src={icon}
            alt=""
            className="ticker-icon"
            style={{
              width: '72px', // Even bigger icons
              height: '72px', // Even bigger icons
              objectFit: 'contain',
              filter: 'brightness(1.8) contrast(1.4) saturate(1.3)' // Much brighter and more vibrant icons
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      ))}
      {/* Sixth set for seamless loop */}
      {icons.map((icon, index) => (
        <div
          key={`sixth-${icon}-${index}`}
          className="ticker-icon-container"
          style={{
            width: '96px', // Bigger containers for bigger icons
            height: '96px', // Bigger containers for bigger icons
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          <img
            src={icon}
            alt=""
            className="ticker-icon"
            style={{
              width: '72px', // Even bigger icons
              height: '72px', // Even bigger icons
              objectFit: 'contain',
              filter: 'brightness(1.3) contrast(1.4) saturate(1.0)' // Much brighter and more vibrant icons
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: 'hidden',
        zIndex: -1, // Behind everything
        opacity: 0.5, // More visible
        pointerEvents: 'none'
      }}
    >
      {/* Gradient overlay to darken text area */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'linear-gradient(to right, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0))',
          zIndex: 1 // Above icons but below text
        }}
      />
      {/* Row 1 - Slow */}
      <div className="ticker-row-1" style={{ position: 'absolute', top: '0%', left: 0, right: 0 }}>
        {createTickerRow(row1Icons, 600, 0)}
      </div>
      
      {/* Row 2 - Medium - Centered to hero */}
      <div className="ticker-row-2" style={{ position: 'absolute', top: '40%', left: 0, right: 0 }}>
        {createTickerRow(row2Icons, 450, -15)}
      </div>
      
      {/* Row 3 - Fast - 4 minutes */}
      <div className="ticker-row-3" style={{ position: 'absolute', top: '80%', left: 0, right: 0 }}>
        {createTickerRow(row3Icons, 240, -30)}
      </div>

    </div>
  );
}

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
      <TopBar hidden={hidden} progress={progress} onAbout={()=>setView({page:'about', stackId:null})} />
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
      {view.page==='about' && (
        <About onBack={()=>setView({page:'home', stackId:null})} />
      )}
    </div>
  );
}

function TopBar({ hidden, progress, onAbout }){
  const score = Object.values(progress).reduce((a,v)=>a+(v.points||0),0);
  return (
    <div style={{ position:'sticky', top:0, zIndex:20, transform:`translateY(${hidden?-60:0}px)`, transition:'transform .25s ease', backdropFilter:'blur(6px)', background:'rgba(11,11,11,.7)', borderBottom:'1px solid #1f1f1f' }}>
      <div style={{ ...styles.container, padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <img 
            src="img/crate.jpg" 
            alt="Heartlands Logo"
            style={{ 
              width: '24px', 
              height: '24px', 
              objectFit: 'contain'
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        <div style={{ fontWeight:700, letterSpacing:'0.02em' }}>HEARTLANDS</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:16 }}>
          <button 
            onClick={onAbout}
            style={{ 
              background:'none', 
              border:'none', 
              color:'#fff', 
              cursor:'pointer',
              fontSize:14,
              textDecoration:'none'
            }}
          >
            About
          </button>
        <div style={{ fontSize:14 }}>Score: <span style={{ fontFamily:'ui-monospace, SFMono-Regular', fontWeight:700 }}>{score}</span></div>
        </div>
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
          <div style={{ padding:'28px 24px 22px 24px', position:'relative', zIndex:2 }}>
            <h1 style={{ fontSize:40, lineHeight:1.05, fontWeight:900, letterSpacing:'-0.01em', marginBottom:10 }}>Walk. Collect. Understand.</h1>
            <p style={{ ...styles.subtle, fontSize:16, maxWidth:860 }}>
              Heartlands is a self‑guided, walking game. Discover landmarks and collect items along the way.
              Hunt mystery circles for rarer artefacts. Share your stamp sheet when you're done.
            </p>
            <div style={{ marginTop:14 }}>
              <a href="#stacks" style={{ ...styles.button }}>Choose a stack ↓</a>
            </div>
            
            {/* Icon Ticker Background - only in header */}
            <IconTicker />
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ ...styles.container, paddingTop:18, paddingBottom:6 }}>
        <h2 style={{ ...styles.h2, marginBottom:16 }}>What is Heartlands?</h2>
        <div style={{ display:'grid', gap:12, gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <HowItWorksStep n={1} title="Pick a quest" text="Each area has fixed icons (known sites) and random circles (mystery spawns)." image="img/map.png" />
          <HowItWorksStep n={2} title="Walk & hunt" text="Use the map. Fixed icons are visible; randoms appear as search radii. Get close to collect." image="img/compass.png" />
          <HowItWorksStep n={3} title="Collect & share" text="Cards reveal context and debate prompts. Finish to export an Instagram story." image="img/crown.png" />
        </div>
      </section>

      {/* STACK CARDS */}
      <section id="stacks" style={{ ...styles.container, paddingTop:8, paddingBottom:24 }}>
        <h2 style={{ ...styles.h2, marginBottom:16 }}>Quests</h2>
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

function HowItWorksStep({ n, title, text, image }){
  return (
    <div style={{ ...styles.card }}>
      {image && (
        <div style={{ marginBottom:12, borderRadius:8, overflow:'hidden' }}>
          <img 
            src={image} 
            alt={title}
            style={{ 
              width: '100%', 
              height: '120px', 
              objectFit: 'cover',
              display: 'block'
            }}
            onError={(e) => {
              e.target.style.display = 'none';
            }}
          />
        </div>
      )}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
        <div style={{ width:26, height:26, borderRadius:8, background:'#fff', color:'#000', fontWeight:800, display:'grid', placeItems:'center' }}>{n}</div>
        <div style={{ fontWeight:700 }}>{title}</div>
      </div>
      <div style={{ ...styles.subtle, fontSize:14 }}>{text}</div>
    </div>
  );
}

// ============================
// ABOUT PAGE
// ============================
function About({ onBack }){
  return (
    <div style={{ ...styles.container, paddingTop:24, paddingBottom:24 }}>
      <div style={{ marginBottom:24 }}>
        <button 
          onClick={onBack}
          style={{ 
            background:'none', 
            border:'none', 
            color:'#fff', 
            cursor:'pointer',
            display:'flex',
            alignItems:'center',
            gap:8,
            fontSize:14,
            marginBottom:16
          }}
        >
          ← Back
        </button>
        <h1 style={{ ...styles.h1, marginBottom:16 }}>About Heartlands</h1>
      </div>
      
      <div style={{ ...styles.card, marginBottom:24 }}>
        <h2 style={{ ...styles.h2, marginBottom:12 }}>What is Heartlands?</h2>
        <p style={{ ...styles.subtle, marginBottom:16 }}>
          Heartlands is a self-guided walking game that transforms your exploration of Singapore's neighborhoods into an interactive adventure. 
          Discover hidden stories, collect digital artifacts, and learn about the rich history and culture of the places you visit.
        </p>
        <p style={{ ...styles.subtle, marginBottom:16 }}>
          Each quest takes you through carefully curated locations, where you'll encounter both known landmarks and mysterious discoveries. 
          Use your phone's GPS to navigate and collect items as you explore the real world.
        </p>
      </div>

      <div style={{ ...styles.card, marginBottom:24 }}>
        <h2 style={{ ...styles.h2, marginBottom:12 }}>How to Play</h2>
        <div style={{ display:'grid', gap:12 }}>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ width:24, height:24, borderRadius:12, background:'#22c55e', color:'#fff', fontWeight:700, display:'grid', placeItems:'center', fontSize:12, flexShrink:0 }}>1</div>
            <div>
              <div style={{ fontWeight:600, marginBottom:4 }}>Pick a Quest</div>
              <div style={{ ...styles.subtle, fontSize:14 }}>Choose from available quests like "The Worker's Garden: Jurong Lake"</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ width:24, height:24, borderRadius:12, background:'#22c55e', color:'#fff', fontWeight:700, display:'grid', placeItems:'center', fontSize:12, flexShrink:0 }}>2</div>
            <div>
              <div style={{ fontWeight:600, marginBottom:4 }}>Walk & Explore</div>
              <div style={{ ...styles.subtle, fontSize:14 }}>Use the map to navigate to locations and collect items when you get close</div>
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
            <div style={{ width:24, height:24, borderRadius:12, background:'#22c55e', color:'#fff', fontWeight:700, display:'grid', placeItems:'center', fontSize:12, flexShrink:0 }}>3</div>
            <div>
              <div style={{ fontWeight:600, marginBottom:4 }}>Learn & Share</div>
              <div style={{ ...styles.subtle, fontSize:14 }}>Read about each discovery and share your completed quest as an Instagram story</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ ...styles.card, marginBottom:24 }}>
        <h2 style={{ ...styles.h2, marginBottom:12 }}>Features</h2>
        <ul style={{ ...styles.subtle, paddingLeft:20 }}>
          <li style={{ marginBottom:8 }}>GPS-based navigation and collection</li>
          <li style={{ marginBottom:8 }}>Rich historical content and context</li>
          <li style={{ marginBottom:8 }}>Interactive map with real-time location tracking</li>
          <li style={{ marginBottom:8 }}>Mystery items that appear as you explore</li>
          <li style={{ marginBottom:8 }}>Shareable Instagram stories of your completed quests</li>
          <li style={{ marginBottom:8 }}>Offline-capable for uninterrupted exploration</li>
        </ul>
      </div>

      <div style={{ ...styles.card }}>
        <h2 style={{ ...styles.h2, marginBottom:12 }}>About the Project</h2>
        <p style={{ ...styles.subtle, marginBottom:16 }}>
          Heartlands is designed to help people connect with their local communities through interactive storytelling. 
          Each quest reveals the hidden histories and stories that make each neighborhood unique.
        </p>
        <p style={{ ...styles.subtle }}>
          Built with modern web technologies to work seamlessly on mobile devices, Heartlands brings the past to life 
          through your present-day explorations.
        </p>
      </div>
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
  
  // Safety mechanism: clear any stuck popup after 30 seconds
  useEffect(() => {
    if (itemPopup) {
      const timer = setTimeout(() => {
        console.log('Auto-closing stuck popup after 30 seconds');
        setItemPopup(null);
      }, 30000);
      return () => clearTimeout(timer);
    }
  }, [itemPopup]);
  
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
      // Directly collect the item and show modal
      actuallyCollect(a);
      setModalA(a);
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

  // increased height for larger map
  const mapHeight = typeof window !== 'undefined' && window.innerWidth < 640 ? '70vh' : '77vh';

  return (
    <section style={{ ...styles.container, paddingTop:4, paddingBottom:8 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
        <button onClick={onBack} style={{ ...styles.button, background:'#0b0b0b', color:'#e5e5e5', padding:'6px 10px', fontSize:13 }}>← Back</button>
          <div>
          <h2 style={{ fontWeight:800, fontSize:18 }}>
              {stack.id === 'jurong' ? 'Jurong Lake' : stack.name}
            </h2>
            </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:6, alignItems:'center' }}>
          <div style={{ ...styles.subtle, fontSize:11 }}>{totals.gotItems}/{totals.totalItems} items • {totals.gotPts}/{totals.totalPts} pts</div>
          <button onClick={() => setShowFinishWarning(true)} style={{ ...styles.button, padding:'6px 10px', fontSize:13 }}>Finish</button>
          </div>
        </div>

      {/* map wrapper: full width */}
      <div style={{ position:'relative', height:mapHeight, zIndex:10, borderRadius:16, overflow:'hidden', border:'1px solid #2a2a2a' }}>
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
        <div style={{ marginTop:0, display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ ...styles.subtle, fontSize:13 }}>
            {effective ? (
              <>You: <span style={{fontFamily:'ui-monospace,SFMono-Regular'}}>{effective.lat?.toFixed(5)}, {effective.lng?.toFixed(5)}</span>{typeof heading==='number'?` • ${Math.round(heading)}°`:''}{effective.speed?` • ${effective.speed.toFixed(1)} m/s`:''}</>
            ) : (error ? <span style={{ color:'#ef4444' }}>{error}</span> : 'Allow location (HTTPS on iOS) for blue dot & distances.')}
        </div>
      </div>

      {/* Tabs and Sim Button */}
      <div style={{ marginTop:8, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'inline-flex', background:'#111', border:'1px solid #2a2a2a', borderRadius:12, overflow:'hidden' }}>
          <button onClick={()=>setTab('landmarks')} style={{ padding:'8px 14px', fontWeight:600, color: tab==='landmarks'? '#000':'#e5e5e5', background: tab==='landmarks'? '#fff':'transparent', borderRight:'1px solid #2a2a2a' }}>Landmarks</button>
          <button onClick={()=>setTab('collected')} style={{ padding:'8px 14px', fontWeight:600, color: tab==='collected'? '#000':'#e5e5e5', background: tab==='collected'? '#fff':'transparent' }}>Items Collected ({collectedList.length}/{fixedItems.length})</button>
        </div>
        <button onClick={()=>setSimOn(v=>!v)} style={{ ...styles.button, background: simOn?'#7c3aed':'#111', color:'#fff', borderColor:'#5b21b6' }}>{simOn? 'Sim ON':'Sim OFF'}</button>
      </div>

      {/* Cards list */}
      <div style={{ marginTop:12 }}>
        <div style={{ display:'grid', gap:12 }}>
          {tab==='landmarks' && landmarkItems.map((a)=> (
            <LandmarkCard key={a.id} a={a} progress={progress} stackId={stack.id} onOpenModal={()=>setModalA(a)} />
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
        onClose={() => {
          console.log('Closing item popup');
          setItemPopup(null);
        }}
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
  
  console.log('ItemCollectionPopup rendering with popup:', popup);

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
                {/* Item image - clickable */}
                <img 
                  src={item.img || `img/${item.name.toLowerCase().replace(/\s+/g, '')}.jpg`}
                  alt={item.name}
                  onClick={handleCollect}
                  style={{
                    width: 120,
                    height: 120,
                    objectFit: 'cover',
                    borderRadius: 15,
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                    border: '3px solid #22c55e',
                    background: 'transparent',
                    cursor: 'pointer',
                    transition: 'transform 0.2s ease, box-shadow 0.2s ease'
                  }}
                  onMouseOver={(e) => {
                    e.target.style.transform = 'scale(1.05)';
                    e.target.style.boxShadow = '0 15px 40px rgba(34, 197, 94, 0.4)';
                  }}
                  onMouseOut={(e) => {
                    e.target.style.transform = 'scale(1)';
                    e.target.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
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
  const center = { lat: (stack.bbox[1] + stack.bbox[3]) / 2, lng: (stack.bbox[0] + stack.bbox[2]) / 2 };
  const mapRef = useRef(null);
  const [labelFor, setLabelFor] = useState(null); // which fixed id has a label open
  const [triggeredItems, setTriggeredItems] = useState(new Set()); // Track which items have already triggered popup
  const [currentZoom, setCurrentZoom] = useState(16); // Track current zoom level

  // Function to add small random offset to prevent icon clustering
  const addOffsetToCoords = (coords, id) => {
    // Use item ID as seed for consistent offset
    const seed = id.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    const random1 = (seed * 9301 + 49297) % 233280 / 233280; // Simple pseudo-random
    const random2 = ((seed * 9301 + 49297) * 9301 + 49297) % 233280 / 233280;
    
    // Small offset in degrees (about 10-20 meters)
    const offsetLat = (random1 - 0.5) * 0.0002; // ~20m max offset
    const offsetLng = (random2 - 0.5) * 0.0002;
    
    return {
      lat: coords.lat + offsetLat,
      lng: coords.lng + offsetLng
    };
  };

  // Function to create zoom-aware landmark icon
  const makeZoomAwareLandmarkIcon = (url, name, zoom) => {
    const showLabel = zoom >= 16.5; // Only show labels when zoomed in to level 18 or higher
    
    if (showLabel) {
      // Full icon with label
      const html = `
        <div style="text-align:center; width:100%;">
          <div style="width:42px; height:42px; overflow:hidden; margin:0 auto;">
            <img src='${asset(url)}' style='width:100%;height:100%;object-fit:cover;display:block' />
          </div>
          <div style="margin-top:4px; font-size:11px; font-weight:600; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.8); display:inline-block; max-width:80px; word-wrap:break-word; text-align:center; line-height:1.2;">
            ${name}
          </div>
        </div>`;
      return L.divIcon({ html, className:"", iconSize:[60,60], iconAnchor:[30,30] });
    } else {
      // Icon only, no label
      const html = `
        <div style="width:42px; height:42px; border-radius:10px; overflow:hidden; margin:0 auto;">
          <img src='${asset(url)}' style='width:100%;height:100%;object-fit:cover;display:block' />
        </div>`;
      return L.divIcon({ html, className:"", iconSize:[42,42], iconAnchor:[21,21] });
    }
  };



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
      <ZoomTracker onZoomChange={setCurrentZoom} />
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
              <Circle center={[f.coords.lat, f.coords.lng]} radius={f.searchRadiusM || 60} pathOptions={{ color:f.radiusColourM || '#22c55e', weight:3, opacity:1.0, fillOpacity:0.3 }} />
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
      {landmarkItems.map(l => {
        const offsetCoords = addOffsetToCoords(l.coords, l.id);
        return (
        <React.Fragment key={l.id}>
            <Marker position={[offsetCoords.lat, offsetCoords.lng]} icon={makeZoomAwareLandmarkIcon(l.img || thumb(l.name), l.name, currentZoom)} eventHandlers={{ click: ()=> onOpenModal && onOpenModal(l) }} />
        </React.Fragment>
        );
      })}

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

function ZoomTracker({ onZoomChange }){ 
  const map = useMap(); 
  useEffect(()=>{ 
    const handleZoom = () => onZoomChange(map.getZoom());
    map.on('zoom', handleZoom);
    // Set initial zoom
    onZoomChange(map.getZoom());
    return () => map.off('zoom', handleZoom);
  },[map, onZoomChange]); 
  return null; 
}

// ============================
// Landmark Card (non-collectible landmarks)
// ============================
function LandmarkCard({ a, progress, stackId, onOpenModal }){
  // Check if landmark is seen (all nearby items are collected)
  const isSeen = a.nearbyItems && a.nearbyItems.length > 0 && 
    a.nearbyItems.every(itemId => progress[`${stackId}:${itemId}`]);
  
  return (
    <div style={{ ...styles.card, position:'relative', overflow:'hidden' }}>
      {/* Seen Badge */}
      {isSeen && (
        <div style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: '#22c55e',
          color: '#fff',
          fontSize: 9,
          fontWeight: 'bold',
          padding: '4px 8px',
          borderRadius: 8,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          zIndex: 10
        }}>
          ✓ Seen
        </div>
      )}
      
      {/* Landmark Icon */}
      <div style={{ display:'flex', alignItems:'center', gap:16, marginBottom:16, padding:'16px 0' }}>
        <div style={{ 
          width:80, height:80, 
          borderRadius:12, 
          overflow:'hidden',
          border: isSeen ? '2px solid #22c55e' : '1px solid #2a2a2a',
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
