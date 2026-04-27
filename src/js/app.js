import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getFirestore, collection, query, where, orderBy, limit,
  getDocs, addDoc, updateDoc, doc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL }
  from "https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js";

// ── REPLACE WITH YOUR FIREBASE CONFIG ──────────────
const firebaseConfig = {
  apiKey: "AIzaSyCMFjanKid7Bw7-w084beGMRwvjn0WMfT4",
  authDomain: "myplotmitra-d692c.firebaseapp.com",
  projectId: "myplotmitra-d692c",
  storageBucket: "myplotmitra-d692c.firebasestorage.app",
  messagingSenderId: "686781189764",
  appId: "1:686781189764:web:c4fc3e669e8fb0b3b6bcd1"
};
// ───────────────────────────────────────────────────

const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const storage  = getStorage(app);
const provider = new GoogleAuthProvider();

// ── STATE ──────────────────────────────────────────
let currentUser = null;
let vMode       = 'grid';
let typeF       = '';
let searchQ     = '';
let allProps    = [];

// ── HELPERS ────────────────────────────────────────
function fp(p) {
  if (p >= 10000000) return `₹${(p / 10000000).toFixed(1)}Cr`;
  if (p >= 100000)   return `₹${(p / 100000).toFixed(1)}L`;
  return `₹${Number(p).toLocaleString('en-IN')}`;
}

function ago(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 86400)   return 'Today';
  if (s < 172800)  return 'Yesterday';
  if (s < 604800)  return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / 604800)}w ago`;
}

function isNew(ts) {
  if (!ts) return false;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return Date.now() - d.getTime() < 7 * 86400000;
}

const TC = { plot: '#E85D04', house: '#185FA5', land: '#BA7517', flat: '#7C3AED' };
const TB = { plot: '#FFF0E6', house: '#EFF6FF', land: '#FFFBEB', flat: '#F5F3FF' };
const TI = { plot: '⬜', house: '🏠', land: '🌿', flat: '🏢' };

// ── AUTH ───────────────────────────────────────────
onAuthStateChanged(auth, async (u) => {
  currentUser = u;
  const ab  = document.getElementById('authBtns');
  const pb  = document.getElementById('postBtn');
  const adm = document.getElementById('adminBtn');
  if (!ab) return;

  if (u) {
    ab.innerHTML = `<img src="${u.photoURL || ''}" class="user-avatar" title="Sign out" onclick="window.doSignOut()"/>`;
    if (pb) pb.style.display = 'flex';
    // check admin role
    const q2 = query(collection(db, 'users'), where('id', '==', u.uid));
    const sn = await getDocs(q2);
    if (sn.empty) {
      await addDoc(collection(db, 'users'), {
        id: u.uid, fullName: u.displayName || 'User',
        email: u.email, photoURL: u.photoURL || '',
        phone: '', role: 'user', createdAt: serverTimestamp()
      });
    } else {
      const role = sn.docs[0].data().role;
      if (adm && (role === 'admin' || role === 'superadmin')) {
        adm.style.display = 'flex';
      }
    }
  } else {
    ab.innerHTML = `<button class="btn-signin" onclick="window.doSignIn()">Sign in</button>`;
    if (pb)  pb.style.display  = 'none';
    if (adm) adm.style.display = 'none';
  }
});

window.doSignIn  = async () => { try { await signInWithPopup(auth, provider); } catch (e) { console.error(e); } };
window.doSignOut = async () => { if (confirm('Sign out?')) await signOut(auth); };

// ── LOAD PROPERTIES ────────────────────────────────
async function loadProps() {
  showSkeleton();
  try {
    const q2 = query(
      collection(db, 'properties'),
      where('status', '==', 'approved'),
      orderBy('createdAt', 'desc'),
      limit(40)
    );
    const sn = await getDocs(q2);
    allProps = sn.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  } catch (e) {
    console.warn('Firebase not configured — loading demo data');
    loadDemo();
  }
}

function loadDemo() {
  allProps = [
    { id: '1',  type: 'plot',  title: 'Corner Plot near Outer Ring Road',          city: 'Kondapur, Hyderabad',    price: 4500000,  lengthFt: 40,  widthFt: 60,  areaSqft: 2400,  isNegotiable: true,  createdAt: { toDate: () => new Date() },                        px: 310, py: 155 },
    { id: '2',  type: 'house', title: '3BHK Independent House with Parking',       city: 'Madhapur, Hyderabad',    price: 12000000, lengthFt: 30,  widthFt: 40,  areaSqft: 1200,  isNegotiable: false, createdAt: { toDate: () => new Date(Date.now()-86400000) },      px: 420, py: 180 },
    { id: '3',  type: 'land',  title: 'Agricultural Land near National Highway',   city: 'Shadnagar, Hyderabad',   price: 8000000,  lengthFt: 200, widthFt: 218, areaSqft: 43560, isNegotiable: true,  createdAt: { toDate: () => new Date(Date.now()-172800000) },     px: 170, py: 270 },
    { id: '4',  type: 'plot',  title: 'HMDA Approved Residential Plot',            city: 'Bachupally, Hyderabad',  price: 2800000,  lengthFt: 25,  widthFt: 45,  areaSqft: 1125,  isNegotiable: true,  createdAt: { toDate: () => new Date(Date.now()-259200000) },     px: 460, py: 125 },
    { id: '5',  type: 'flat',  title: '2BHK Ready-to-Move Flat Near Metro',        city: 'KPHB Colony, Hyderabad', price: 6500000,  lengthFt: 0,   widthFt: 0,   areaSqft: 1050,  isNegotiable: false, createdAt: { toDate: () => new Date(Date.now()-432000000) },     px: 365, py: 108 },
    { id: '6',  type: 'land',  title: 'Commercial Land on Highway',                city: 'Patancheru, Hyderabad',  price: 25000000, lengthFt: 100, widthFt: 200, areaSqft: 20000, isNegotiable: true,  createdAt: { toDate: () => new Date(Date.now()-518400000) },     px: 125, py: 218 },
    { id: '7',  type: 'plot',  title: 'East Facing Plot Near Metro Station',       city: 'Miyapur, Hyderabad',     price: 5500000,  lengthFt: 33,  widthFt: 55,  areaSqft: 1815,  isNegotiable: true,  createdAt: { toDate: () => new Date(Date.now()-604800000) },     px: 228, py: 148 },
    { id: '8',  type: 'flat',  title: '3BHK Premium Apartment with Gym & Pool',   city: 'Gachibowli, Hyderabad',  price: 11000000, lengthFt: 0,   widthFt: 0,   areaSqft: 1650,  isNegotiable: false, createdAt: { toDate: () => new Date(Date.now()-691200000) },     px: 488, py: 252 },
    { id: '9',  type: 'house', title: 'Villa with Terrace Garden & Swimming Pool', city: 'Jubilee Hills, Hyderabad',price: 32000000, lengthFt: 50,  widthFt: 60,  areaSqft: 3000,  isNegotiable: true,  createdAt: { toDate: () => new Date(Date.now()-777600000) },     px: 324, py: 215 },
    { id: '10', type: 'plot',  title: 'Corner Plot Near IT Corridor',              city: 'Nanakramguda, Hyderabad',price: 7200000,  lengthFt: 35,  widthFt: 65,  areaSqft: 2275,  isNegotiable: true,  createdAt: { toDate: () => new Date(Date.now()-864000000) },     px: 502, py: 198 },
  ];
  render();
}

function showSkeleton() {
  document.getElementById('propGrid').innerHTML =
    Array.from({ length: 8 }).map(() => `
      <div class="sk-card">
        <div class="sk-img"></div>
        <div class="sk-body">
          <div class="sk-line" style="height:18px;width:55%"></div>
          <div class="sk-line" style="height:13px;width:85%"></div>
          <div class="sk-line" style="height:13px;width:60%"></div>
          <div class="sk-line" style="height:13px;width:70%"></div>
        </div>
      </div>`).join('');
}

function getFiltered() {
  return allProps.filter(p => {
    const mt = !typeF   || p.type === typeF;
    const ms = !searchQ || p.title.toLowerCase().includes(searchQ.toLowerCase())
                        || p.city.toLowerCase().includes(searchQ.toLowerCase());
    return mt && ms;
  });
}

function render() {
  const data = getFiltered();
  document.getElementById('pcnt').textContent = `${data.length} propert${data.length === 1 ? 'y' : 'ies'}`;
  if (vMode === 'grid') renderGrid(data);
  else renderMap(data);
}

// ── GRID VIEW ──────────────────────────────────────
function renderGrid(data) {
  const g = document.getElementById('propGrid');
  if (!data.length) {
    g.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏚️</div>
        <div class="empty-title">No properties found</div>
        <div class="empty-sub">Try a different search or filter</div>
      </div>`;
    return;
  }
  g.innerHTML = data.map((p, i) => {
    const c = TC[p.type] || '#E85D04';
    const bg = TB[p.type] || '#FFF0E6';
    const hasDim = p.lengthFt > 0 && p.widthFt > 0;
    return `
    <div class="card" style="animation-delay:${i * 0.04}s" onclick="window.openDetail('${p.id}')">
      <div class="card-img" style="background:${bg}">
        ${p.coverPhoto
          ? `<img src="${p.coverPhoto}" alt="${p.title}" loading="lazy"/>`
          : `<span class="type-icon">${TI[p.type] || '🏠'}</span>`}
        ${isNew(p.createdAt) ? '<span class="badge-new">NEW</span>' : ''}
        <span class="badge-type" style="color:${c};border-color:${c}44;background:${c}18">
          ${(p.type || 'plot').toUpperCase()}
        </span>
      </div>
      <div class="card-body">
        <div class="card-price">${fp(p.price)}</div>
        <div class="card-title">${p.title}</div>
        <div class="card-loc">📍 ${p.city}</div>
        <div class="card-dims">
          ${hasDim ? `<span class="dim-pill">${p.lengthFt}×${p.widthFt} ft</span>` : ''}
          ${p.areaSqft ? `<span class="dim-pill">${Number(p.areaSqft).toLocaleString()} sqft</span>` : ''}
        </div>
        <div class="card-foot">
          <span class="card-time">${ago(p.createdAt)}</span>
          ${p.isNegotiable ? '<span class="neg-tag">Negotiable</span>' : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── MAP VIEW ───────────────────────────────────────
let googleMap = null;
let googleMarkers = [];
let mapData = [];

function renderMap(data) {
  mapData = data;
  const g = document.getElementById('propGrid');
  g.innerHTML = `
  <div class="map-wrap" style="grid-column:1/-1">
    <div id="googleMapDiv" style="width:100%;height:100%;border-radius:var(--r-md)"></div>
    <div class="map-legend">
      ${Object.entries(TC).map(([t, c]) => `
        <div class="mleg-row">
          <div class="mleg-dot" style="background:${c}"></div>
          <span style="text-transform:capitalize">${t}</span>
        </div>`).join('')}
    </div>
    <div class="map-popup" id="mapPopup"></div>
  </div>`;

  // If Google Maps loaded use it, otherwise fallback to SVG
  if (window.google && window.google.maps) {
    initGoogleMapView(data);
  } else {
    renderSVGMap(data);
  }
}

// Called by Google Maps script callback
window.initGoogleMap = function() {
  if (vMode === 'map') initGoogleMapView(mapData);
};

function initGoogleMapView(data) {
  const mapDiv = document.getElementById('googleMapDiv');
  if (!mapDiv) return;

  // Clear old markers
  googleMarkers.forEach(m => m.setMap(null));
  googleMarkers = [];

  // Init map centered on Hyderabad
  if (!googleMap) {
    googleMap = new google.maps.Map(mapDiv, {
      center: { lat: 17.385, lng: 78.4867 },
      zoom: 11,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      styles: [
        { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
        { featureType: 'transit', stylers: [{ visibility: 'off' }] }
      ]
    });
  }

  const bounds = new google.maps.LatLngBounds();
  let hasPoints = false;

  data.forEach(p => {
    const lat = p.lat || p.py ? (17.3 + ((p.py || 240) - 240) * -0.002) : null;
    const lng = p.lng || p.px ? (78.3 + ((p.px || 300) - 300) * 0.002) : null;
    if (!lat || !lng) return;

    hasPoints = true;
    const pos = { lat, lng };
    bounds.extend(pos);

    const color = TC[p.type] || '#E85D04';
    const label = fp(p.price);

    // Custom price label marker
    const pinSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${label.length * 8 + 20}" height="32">
      <rect x="1" y="1" width="${label.length * 8 + 18}" height="24" rx="6" fill="${color}"/>
      <polygon points="${(label.length*8+20)/2-6},25 ${(label.length*8+20)/2+6},25 ${(label.length*8+20)/2},31" fill="${color}"/>
      <text x="${(label.length*8+20)/2}" y="16" text-anchor="middle" font-family="DM Sans,sans-serif"
        font-size="11" font-weight="500" fill="white">${label}</text>
    </svg>`;

    const marker = new google.maps.Marker({
      position: pos,
      map: googleMap,
      icon: {
        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(pinSvg),
        anchor: new google.maps.Point((label.length * 8 + 20) / 2, 31)
      }
    });

    marker.addListener('click', () => showGooglePopup(p, marker));
    googleMarkers.push(marker);
  });

  if (hasPoints && googleMarkers.length > 1) {
    googleMap.fitBounds(bounds, 60);
  }
}

let infoWindow = null;
function showGooglePopup(p, marker) {
  if (infoWindow) infoWindow.close();
  const hasDim = p.lengthFt > 0 && p.widthFt > 0;
  const content = `
    <div style="font-family:'DM Sans',sans-serif;min-width:180px;padding:4px">
      <div style="font-size:16px;font-weight:600;color:#E85D04;margin-bottom:3px">${fp(p.price)}</div>
      <div style="font-size:12px;font-weight:500;color:#111;margin-bottom:3px;line-height:1.3">${p.title}</div>
      <div style="font-size:11px;color:#666;margin-bottom:8px">📍 ${p.city}</div>
      ${hasDim ? `<div style="background:#FFF0E6;border-radius:8px;padding:8px;margin-bottom:8px">
        <div style="font-size:9px;color:#E85D04;font-weight:600;letter-spacing:.5px;margin-bottom:5px">DIMENSIONS</div>
        <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#C44D00">
          <span>${p.lengthFt}ft</span><span style="color:#ccc">×</span>
          <span>${p.widthFt}ft</span>
          ${p.areaSqft ? `<span style="color:#ccc">=</span><span>${Number(p.areaSqft).toLocaleString()} sqft</span>` : ''}
        </div>
      </div>` : ''}
      <button onclick="window.openDetail('${p.id}')"
        style="width:100%;background:#E85D04;color:#fff;border:none;border-radius:7px;
               padding:7px;font-size:12px;cursor:pointer;font-family:'DM Sans',sans-serif;font-weight:500">
        View Details →
      </button>
    </div>`;
  infoWindow = new google.maps.InfoWindow({ content });
  infoWindow.open(googleMap, marker);
}

// SVG fallback when Google Maps not loaded
function renderSVGMap(data) {
  const mapDiv = document.getElementById('googleMapDiv');
  if (!mapDiv) return;
  mapDiv.innerHTML = `
  <svg style="width:100%;height:100%" viewBox="0 0 620 480" id="msvg" onclick="closePopup(event)">
    <rect width="620" height="480" fill="#F5F0E8"/>
    <ellipse cx="310" cy="240" rx="280" ry="190" fill="#EDE5D8" stroke="#D8CEBF" stroke-width="1"/>
    <ellipse cx="310" cy="240" rx="200" ry="130" fill="#E5DDD0"/>
    <rect x="40" y="236" width="540" height="7" fill="#D4C9B8" rx="3" opacity=".6"/>
    <rect x="306" y="40" width="7" height="400" fill="#D4C9B8" rx="3" opacity=".6"/>
    <text x="310" y="22" text-anchor="middle" font-size="12" fill="#B8A898" font-family="sans-serif">Hyderabad — Add Maps API key for real map</text>
    ${data.map(p => {
      const c = TC[p.type] || '#E85D04';
      const lbl = fp(p.price);
      const px = p.px || 300, py = p.py || 240;
      const w = lbl.length * 7 + 18;
      return `<g style="cursor:pointer" onclick="window.pinClick(event,'${p.id}')" transform="translate(${px},${py})">
        <rect x="${-w/2}" y="-13" width="${w}" height="24" rx="6" fill="${c}"/>
        <polygon points="-5,11 5,11 0,18" fill="${c}"/>
        <text x="0" y="4" text-anchor="middle" font-size="10" fill="white"
          font-weight="500" font-family="sans-serif">${lbl}</text>
      </g>`;
    }).join('')}
  </svg>`;
}

window.pinClick = function(e, id) {
  e.stopPropagation();
  const p = allProps.find(x => x.id === id);
  if (!p) return;
  const popup = document.getElementById('mapPopup');
  if (!popup) return;
  const hasDim = p.lengthFt > 0 && p.widthFt > 0;
  popup.innerHTML = `
    <div class="pp-price">${fp(p.price)}</div>
    <div class="pp-title">${p.title}</div>
    <div class="pp-loc">📍 ${p.city}</div>
    ${hasDim ? `<div class="pp-dims">
      <div class="pp-dims-lbl">DIMENSIONS</div>
      <div class="pp-dims-row">
        <div class="pp-dim"><span class="pp-dv">${p.lengthFt}ft</span><span class="pp-dl">Length</span></div>
        <span class="pp-x">×</span>
        <div class="pp-dim"><span class="pp-dv">${p.widthFt}ft</span><span class="pp-dl">Width</span></div>
        ${p.areaSqft ? `<span class="pp-x">=</span>
        <div class="pp-dim"><span class="pp-dv">${Number(p.areaSqft).toLocaleString()}</span><span class="pp-dl">sqft</span></div>` : ''}
      </div>
    </div>` : ''}
    <button class="pp-btn" onclick="window.openDetail('${p.id}')">View Details →</button>`;
  const msvg = document.getElementById('msvg');
  if (!msvg) return;
  const bbox = msvg.getBoundingClientRect();
  const scX = bbox.width / 620, scY = bbox.height / 480;
  let left = (p.px||300)*scX + 10, top = (p.py||240)*scY - 150;
  if (left + 210 > bbox.width) left = (p.px||300)*scX - 220;
  if (top < 10) top = (p.py||240)*scY + 25;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  popup.classList.add('show');
};

function closePopup(e) {
  const pp = document.getElementById('mapPopup');
  if (pp && !pp.contains(e.target)) pp.classList.remove('show');
}

// ── DETAIL SHEET ───────────────────────────────────
window.openDetail = function (id) {
  const p = allProps.find(x => x.id === id);
  if (!p) return;
  const hasDim = p.lengthFt > 0 && p.widthFt > 0;
  const bg = TB[p.type] || '#FFF0E6';
  document.getElementById('detailBody').innerHTML = `
    <div class="detail-img" style="background:${bg}">
      ${p.coverPhoto
        ? `<img src="${p.coverPhoto}" alt="${p.title}"/>`
        : `<span style="font-size:64px">${TI[p.type] || '🏠'}</span>`}
    </div>
    <div class="detail-content">
      <div class="detail-price">${fp(p.price)}</div>
      <div class="detail-title">${p.title}</div>
      <div class="detail-loc">📍 ${p.city}</div>
      ${hasDim ? `
      <div class="dims-box">
        <div class="dims-lbl">DIMENSIONS</div>
        <div class="dims-row">
          <div class="dim-item"><span class="dim-val">${p.lengthFt} ft</span><span class="dim-lbl">Length</span></div>
          <span class="dim-x">×</span>
          <div class="dim-item"><span class="dim-val">${p.widthFt} ft</span><span class="dim-lbl">Width</span></div>
          ${p.areaSqft ? `<span class="dim-x">=</span>
          <div class="dim-item"><span class="dim-val">${Number(p.areaSqft).toLocaleString()}</span><span class="dim-lbl">sq ft</span></div>` : ''}
        </div>
      </div>` : ''}
      <div class="detail-meta">
        <div class="meta-item"><span class="meta-lbl">Type</span><span class="meta-val">${p.type}</span></div>
        <div class="meta-item"><span class="meta-lbl">Area</span><span class="meta-val">${p.areaSqft ? Number(p.areaSqft).toLocaleString() + ' sqft' : '—'}</span></div>
        <div class="meta-item"><span class="meta-lbl">Negotiable</span><span class="meta-val">${p.isNegotiable ? 'Yes' : 'No'}</span></div>
        <div class="meta-item"><span class="meta-lbl">Posted</span><span class="meta-val">${ago(p.createdAt)}</span></div>
      </div>
      ${p.description ? `<div class="detail-desc">${p.description}</div>` : ''}
      <div class="contact-btns">
        <button class="btn-call" onclick="alert('Contact seller coming soon!')">📞 Call Seller</button>
        <button class="btn-inquiry" onclick="alert('Inquiry coming soon!')">💬 Inquiry</button>
      </div>
    </div>`;
  document.getElementById('sheetOverlay').classList.add('open');
  document.getElementById('detailSheet').classList.add('open');
};

window.closeDetail = function () {
  document.getElementById('sheetOverlay').classList.remove('open');
  document.getElementById('detailSheet').classList.remove('open');
};

// ── FILTERS ────────────────────────────────────────
window.setSearch = v => { searchQ = v; render(); };
window.setType   = el => {
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  typeF = el.dataset.t;
  render();
};
window.setView = v => {
  vMode = v;
  document.getElementById('vbGrid').classList.toggle('on', v === 'grid');
  document.getElementById('vbMap').classList.toggle('on',  v === 'map');
  render();
};

// ── POST PROPERTY ──────────────────────────────────
window.openPost  = () => { if (!currentUser) { window.doSignIn(); return; } document.getElementById('postModal').classList.add('open'); };
window.closePost = () => document.getElementById('postModal').classList.remove('open');

window.updDims = () => {
  const l = Number(document.getElementById('fLft')?.value) || 0;
  const w = Number(document.getElementById('fWft')?.value) || 0;
  const pr = document.getElementById('dimsPreview');
  if (pr) pr.textContent = l && w ? `${l} ft × ${w} ft = ${(l * w).toLocaleString()} sqft` : '';
};

window.submitProperty = async (e) => {
  e.preventDefault();
  if (!currentUser) return;
  const form = e.target;
  const btn  = form.querySelector('.submit-btn');
  btn.textContent = 'Submitting...';
  btn.disabled = true;
  try {
    const data = {
      ownerId:     currentUser.uid,
      title:       form.title_.value.trim(),
      description: form.description.value.trim(),
      type:        form.type_.value,
      address:     form.address.value.trim(),
      city:        form.city.value.trim() || 'Hyderabad',
      lengthFt:    Number(form.lengthFt.value) || 0,
      widthFt:     Number(form.widthFt.value) || 0,
      areaSqft:    Number(form.areaSqft.value) || 0,
      price:       Number(form.price.value),
      isNegotiable: form.negotiable.checked,
      status:      'pending',
      viewsCount:  0,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    };
    const pi = form.querySelector('#photoInput');
    if (pi.files.length > 0) {
      const f  = pi.files[0];
      const sr = ref(storage, `properties/${Date.now()}/${f.name}`);
      const sn = await uploadBytes(sr, f);
      data.coverPhoto = await getDownloadURL(sn.ref);
    }
    await addDoc(collection(db, 'properties'), data);
    window.closePost();
    form.reset();
    showToast('Submitted! Admin will review your listing.', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    btn.textContent = 'Submit for Approval';
    btn.disabled    = false;
  }
};

// ── ADMIN ──────────────────────────────────────────
window.openAdmin = async () => {
  if (!currentUser) return;
  document.getElementById('adminModal').classList.add('open');
  const list = document.getElementById('pendingList');
  list.innerHTML = '<div style="text-align:center;padding:40px;color:#AAA">Loading...</div>';
  try {
    const q2   = query(collection(db, 'properties'), where('status', '==', 'pending'), orderBy('createdAt', 'asc'));
    const sn   = await getDocs(q2);
    const items = sn.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!items.length) {
      list.innerHTML = '<div class="empty-adm">🎉 No pending listings — all caught up!</div>';
      return;
    }
    list.innerHTML = items.map(p => `
      <div class="adm-card" id="adc-${p.id}">
        <div class="adm-top">
          <div class="adm-thumb" style="background:${TB[p.type] || '#FFF0E6'}">${TI[p.type] || '🏠'}</div>
          <div class="adm-info">
            <div class="adm-title">${p.title}</div>
            <div class="adm-city">📍 ${p.city}</div>
            <div class="adm-pills">
              <span class="adm-pill">${fp(p.price)}</span>
              ${p.areaSqft ? `<span class="adm-pill">${Number(p.areaSqft).toLocaleString()} sqft</span>` : ''}
              ${p.lengthFt > 0 ? `<span class="adm-pill">${p.lengthFt}×${p.widthFt} ft</span>` : ''}
            </div>
          </div>
          <div class="adm-acts">
            <button class="btn-approve" onclick="window.doApprove('${p.id}')">✓ Approve</button>
            <button class="btn-rej-open" onclick="window.showRej('${p.id}')">✕ Reject</button>
          </div>
        </div>
        <div class="rej-form" id="rf-${p.id}" style="display:none">
          <div class="rej-presets">
            ${['Documents missing', 'Duplicate listing', 'Incorrect dimensions', 'Unclear photos', 'Price mismatch', 'Fraudulent'].map(r =>
              `<span class="preset-chip" onclick="document.getElementById('rr-${p.id}').value='${r}'">${r}</span>`
            ).join('')}
          </div>
          <input class="rej-input" id="rr-${p.id}" placeholder="Rejection reason..."/>
          <div class="rej-btns">
            <button class="btn-approve" onclick="window.doApprove('${p.id}')">✓ Approve & Notify</button>
            <button class="btn-rej-confirm" onclick="window.doReject('${p.id}')">✕ Reject & Notify</button>
          </div>
        </div>
      </div>`).join('');
  } catch (e) {
    list.innerHTML = '<div style="color:#DC2626;padding:20px">Error loading. Check Firebase rules.</div>';
  }
};

window.closeAdmin = () => document.getElementById('adminModal').classList.remove('open');

window.showRej = id => {
  const r = document.getElementById(`rf-${id}`);
  if (r) r.style.display = r.style.display === 'none' ? 'block' : 'none';
};

window.doApprove = async (id) => {
  try {
    await updateDoc(doc(db, 'properties', id), {
      status: 'approved', reviewedBy: currentUser.uid, reviewedAt: serverTimestamp()
    });
    await addDoc(collection(db, 'notifications'), {
      type: 'approval', title: 'Your listing is Live!',
      body: 'Your property has been approved and is now visible to buyers.',
      isRead: false, createdAt: serverTimestamp()
    });
    document.getElementById(`adc-${id}`)?.remove();
    showToast('Approved! Seller notified.', 'success');
    loadProps();
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

window.doReject = async (id) => {
  const r = document.getElementById(`rr-${id}`)?.value?.trim();
  if (!r) { showToast('Enter rejection reason first', 'error'); return; }
  try {
    await updateDoc(doc(db, 'properties', id), {
      status: 'rejected', rejectionReason: r,
      reviewedBy: currentUser.uid, reviewedAt: serverTimestamp()
    });
    document.getElementById(`adc-${id}`)?.remove();
    showToast('Rejected. Seller notified.', '');
  } catch (e) { showToast('Error: ' + e.message, 'error'); }
};

// ── TOAST ──────────────────────────────────────────
function showToast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast${type ? ' ' + type : ''}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}
window.showToast = showToast;

// ── PWA INSTALL ────────────────────────────────────
let dPr = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  dPr = e;
  document.getElementById('installBar')?.classList.add('show');
  document.getElementById('installBtn').onclick = async () => {
    dPr.prompt();
    await dPr.userChoice;
    document.getElementById('installBar')?.classList.remove('show');
    dPr = null;
  };
});

// ── SERVICE WORKER ─────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => console.log('SW:', e));
  });
}

// ── INIT ───────────────────────────────────────────
loadProps();
