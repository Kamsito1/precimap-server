/* PreciMap — Frontend App */
'use strict';

const state = {
  token: localStorage.getItem('pm_token'),
  user: JSON.parse(localStorage.getItem('pm_user') || 'null'),
  currentTab: 'mapa', activeFilter: 'all', activeDealFilter: 'all',
  map: null, userMarker: null, placeMarkers: {}, gasMarkers: {},
  clusterGroup: null, gasCluster: null, currentPlace: null, isGasStation: false,
  selectedPlaceId: null, mapCenter: { lat: 37.9494, lng: -4.5303 }, radius: 5,
  authMode: 'login',
  votedPrices: JSON.parse(localStorage.getItem('pm_voted_prices') || '{}'),
  votedDeals: JSON.parse(localStorage.getItem('pm_voted_deals') || '{}'),
};

const API = {
  base: '',
  headers() { const h = { 'Content-Type': 'application/json' }; if (state.token) h['Authorization'] = `Bearer ${state.token}`; return h; },
  async get(url) { const r = await fetch(this.base + url, { headers: this.headers() }); return r.json(); },
  async post(url, body) { const r = await fetch(this.base + url, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) }); return r.json(); },
  async postForm(url, fd) { const h = {}; if (state.token) h['Authorization'] = `Bearer ${state.token}`; const r = await fetch(this.base + url, { method: 'POST', headers: h, body: fd }); return r.json(); }
};

const CAT = {
  gasolinera: { emoji: '⛽', color: '#F59E0B', bg: '#FEF3C7', label: 'Gasolinera' },
  supermercado: { emoji: '🛒', color: '#10B981', bg: '#D1FAE5', label: 'Supermercado' },
  bar: { emoji: '🍺', color: '#7C3AED', bg: '#EDE9FE', label: 'Bar' },
  farmacia: { emoji: '💊', color: '#DC2626', bg: '#FEE2E2', label: 'Farmacia' },
  cafe: { emoji: '☕', color: '#D97706', bg: '#FEF9C3', label: 'Cafetería' },
  restaurante: { emoji: '🍕', color: '#F97316', bg: '#FFEDD5', label: 'Restaurante' },
  parking: { emoji: '🅿️', color: '#2563EB', bg: '#DBEAFE', label: 'Parking' },
  ev: { emoji: '🔌', color: '#06B6D4', bg: '#CFFAFE', label: 'Cargador EV' },
};
const DEAL_CAT = { tecnologia: '💻', ropa: '👗', hogar: '🏠', alimentacion: '🍎', otros: '📦' };
function catInfo(cat) { return CAT[cat] || { emoji: '📍', color: '#6B7280', bg: '#F3F4F6', label: cat }; }

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
    state.currentTab = tab;
    if (tab === 'chollos') loadDeals();
    if (tab === 'ranking') loadRanking();
    if (tab === 'perfil') renderProfile();
    document.getElementById('cat-filters').style.display = tab === 'mapa' ? 'flex' : 'none';
    document.getElementById('search-bar').style.display = tab === 'mapa' ? 'block' : 'none';
  });
});

function initMap() {
  state.map = L.map('map', { center: [state.mapCenter.lat, state.mapCenter.lng], zoom: 14 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(state.map);
  state.clusterGroup = L.markerClusterGroup({ maxClusterRadius: 60, showCoverageOnHover: false });
  state.gasCluster = L.markerClusterGroup({ maxClusterRadius: 40, showCoverageOnHover: false });
  state.map.addLayer(state.clusterGroup);
  state.map.addLayer(state.gasCluster);
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      state.mapCenter = { lat, lng };
      state.map.setView([lat, lng], 14);
      if (state.userMarker) state.map.removeLayer(state.userMarker);
      state.userMarker = L.circleMarker([lat, lng], { radius: 8, fillColor: '#2563EB', color: 'white', weight: 2, fillOpacity: 1 }).addTo(state.map).bindPopup('📍 Estás aquí');
    }, null, { enableHighAccuracy: true });
  }
  state.map.on('moveend', () => { const c = state.map.getCenter(); state.mapCenter = { lat: c.lat, lng: c.lng }; });
  loadPlaces();
  loadGasolineras();
}

function makeMarker(cat, lat, lng) {
  const info = catInfo(cat);
  return L.marker([lat, lng], {
    icon: L.divIcon({ html: `<div class="map-marker ${cat}" style="background:${info.bg};border-color:${info.color}">${info.emoji}</div>`, className: '', iconSize: [38, 38], iconAnchor: [19, 19], popupAnchor: [0, -22] })
  });
}

let allPlacesData = [];

async function loadPlaces(cat) {
  cat = cat || state.activeFilter;
  try {
    const url = cat && cat !== 'all' ? `/api/places?cat=${cat}` : '/api/places';
    const places = await API.get(url);
    allPlacesData = places;
    state.clusterGroup.clearLayers();
    state.placeMarkers = {};
    for (const place of places) {
      if (!place.lat || !place.lng) continue;
      const marker = makeMarker(place.category, place.lat, place.lng);
      const info = catInfo(place.category);
      const topPrice = place.prices?.[0];
      marker.bindPopup(`
        <div class="map-popup-name">${info.emoji} ${place.name}</div>
        <div class="map-popup-cat">${info.label}${place.address ? ' · ' + place.address : ''}</div>
        ${topPrice ? `<div class="map-popup-price">Desde ${topPrice.price.toFixed(2)}€</div>` : ''}
        <button onclick="openPlace(${place.id})" style="margin-top:8px;padding:6px 14px;background:#2563EB;color:white;border:none;border-radius:99px;font-size:13px;font-weight:600;cursor:pointer;width:100%">Ver precios</button>
      `);
      marker.on('click', () => openPlace(place.id));
      state.clusterGroup.addLayer(marker);
      state.placeMarkers[place.id] = { marker, data: place };
    }
    if (currentView === 'list') renderListView();
  } catch (e) { console.error('loadPlaces:', e); }
}

async function loadGasolineras() {
  if (state.activeFilter !== 'all' && state.activeFilter !== 'gasolinera') return;
  try {
    const stations = await API.get('/api/gasolineras');
    const bounds = state.map.getBounds().pad(0.5);
    let count = 0;
    for (const s of stations) {
      if (!bounds.contains([s.lat, s.lng]) || count > 150) continue;
      count++;
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({ html: `<div class="gas-marker">⛽</div>`, className: '', iconSize: [34, 34], iconAnchor: [17, 17] })
      });
      const priceHtml = Object.entries(s.prices).filter(([,v]) => v)
        .map(([k,v]) => `<span style="background:#FEF3C7;padding:2px 8px;border-radius:99px;margin:2px;display:inline-block;font-size:12px"><b>${{g95:'G95',g98:'G98',diesel:'Diesel',glp:'GLP'}[k]||k}</b> ${v.toFixed(3)}€</span>`).join('');
      marker.bindPopup(`<div class="map-popup-name">⛽ ${s.name}</div><div class="map-popup-cat" style="margin-bottom:6px">${s.address||''}</div>${priceHtml}<div style="font-size:10px;color:#94A3B8;margin-top:6px">Datos: Ministerio de Energía</div>`);
      state.gasCluster.addLayer(marker);
    }
    if (count > 0) toast(`⛽ ${count} gasolineras cargadas`, 'success');
  } catch (e) { console.error('Gas API:', e); }
}

document.querySelectorAll('.cat-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.activeFilter = btn.dataset.cat;
    const showGas = btn.dataset.cat === 'all' || btn.dataset.cat === 'gasolinera';
    if (showGas) state.gasCluster.addTo(state.map); else state.map.removeLayer(state.gasCluster);
    loadPlaces(btn.dataset.cat === 'gasolinera' ? null : btn.dataset.cat);
    if (currentView === 'list') renderListView();
  });
});

document.getElementById('radius-slider').addEventListener('input', function() {
  state.radius = parseInt(this.value);
  document.getElementById('radius-val').textContent = this.value;
});

document.getElementById('search-input').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  if (!q) { loadPlaces(); return; }
  const filtered = Object.values(state.placeMarkers).filter(({ data }) => data.name.toLowerCase().includes(q) || (data.address||'').toLowerCase().includes(q));
  state.clusterGroup.clearLayers();
  filtered.forEach(({ marker }) => state.clusterGroup.addLayer(marker));
  if (filtered.length === 1) { const { data } = filtered[0]; state.map.setView([data.lat, data.lng], 16); }
});

// === NAVIGATION — native maps picker ===
function navigateTo(lat, lng, name) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const options = [];
  if (isIOS) options.push({ name: 'Apple Maps', sub: 'App nativa de iOS', icon: '🗺️', url: `maps://maps.apple.com/?daddr=${lat},${lng}&q=${encodeURIComponent(name)}` });
  options.push({ name: 'Google Maps', sub: 'Abrir en Google Maps', icon: '📍', url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` });
  options.push({ name: 'Waze', sub: 'Navegación con tráfico', icon: '🚗', url: `waze://?ll=${lat},${lng}&navigate=yes` });
  if (!isIOS && !isAndroid) options.push({ name: 'Maps (web)', sub: 'Abrir en el navegador', icon: '💻', url: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` });
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay visible'; overlay.style.zIndex = '4000';
  const sheet = document.createElement('div');
  sheet.className = 'modal visible'; sheet.style.zIndex = '4001';
  sheet.innerHTML = `
    <div class="modal-header">
      <h3>🧭 Ir hasta allí</h3>
      <button class="modal-close" onclick="this.closest('.modal').previousSibling.remove();this.closest('.modal').remove()">✕</button>
    </div>
    <div class="modal-body">
      <div style="text-align:center;font-size:13px;color:var(--text2);margin-bottom:12px">Navegar a <strong>${name}</strong></div>
      ${options.map(o => `<a href="${o.url}" class="nav-option" target="${o.url.startsWith('http')?'_blank':'_self'}" rel="noopener">
        <span class="nav-option-icon">${o.icon}</span>
        <div><div class="nav-option-name">${o.name}</div><div class="nav-option-sub">${o.sub}</div></div>
        <span style="margin-left:auto;color:var(--text3)">→</span>
      </a>`).join('')}
    </div>`;
  overlay.onclick = () => { overlay.remove(); sheet.remove(); };
  document.body.appendChild(overlay); document.body.appendChild(sheet);
}

// === VIEW SWITCHER ===
let currentView = 'map';
function switchView(mode) {
  currentView = mode;
  const isMap = mode === 'map';
  document.getElementById('map-view-container').style.display = isMap ? 'block' : 'none';
  document.getElementById('list-view-container').style.display = isMap ? 'none' : 'block';
  document.getElementById('sort-controls').style.display = isMap ? 'none' : 'flex';
  document.getElementById('radius-inline').style.display = isMap ? 'flex' : 'none';
  document.getElementById('btn-map-view').classList.toggle('active', isMap);
  document.getElementById('btn-list-view').classList.toggle('active', !isMap);
  if (!isMap) renderListView();
}

function getDistanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function renderListView() {
  const container = document.getElementById('places-list');
  const sort = document.getElementById('list-sort').value;
  let places = allPlacesData.filter(p => state.activeFilter === 'all' || p.category === state.activeFilter);
  places = places.map(p => ({
    ...p,
    distance: getDistanceKm(state.mapCenter.lat, state.mapCenter.lng, p.lat, p.lng),
    lowestPrice: p.prices?.length ? Math.min(...p.prices.map(pr => pr.price)) : null,
    verifiedCount: p.prices?.filter(pr => pr.status === 'verified').length || 0,
  }));
  if (sort === 'proximity') places.sort((a,b) => a.distance - b.distance);
  else if (sort === 'price_asc') places.sort((a,b) => (a.lowestPrice??9999)-(b.lowestPrice??9999));
  else if (sort === 'price_desc') places.sort((a,b) => (b.lowestPrice??-1)-(a.lowestPrice??-1));
  else if (sort === 'verified') places.sort((a,b) => b.verifiedCount-a.verifiedCount);
  if (!places.length) { container.innerHTML = '<div class="loading-state">No hay lugares en esta categoría</div>'; return; }
  container.innerHTML = places.map(p => {
    const info = catInfo(p.category);
    const dist = p.distance < 1 ? `${Math.round(p.distance*1000)}m` : `${p.distance.toFixed(1)}km`;
    const topPrices = (p.prices||[]).slice(0,3);
    const pricesHtml = topPrices.map(pr => `
      <div class="list-price-row">
        <span class="list-price-product">${pr.product}</span>
        <span class="list-price-amount">${pr.price.toFixed(2)}€<span class="list-price-unit">/${pr.unit}</span></span>
        <span class="price-status ${pr.status}" style="font-size:10px;padding:1px 6px">${pr.status==='verified'?'✅':'⏳'}</span>
      </div>`).join('');
    const nameEsc = p.name.replace(/'/g,"\\'");
    return `<div class="list-place-card" onclick="openPlace(${p.id})">
      <div class="list-place-header">
        <div class="list-place-icon" style="background:${info.bg}">${info.emoji}</div>
        <div class="list-place-info">
          <div class="list-place-name">${p.name}</div>
          <div class="list-place-meta">${info.label}${p.address?' · '+p.address:''}</div>
        </div>
        <div class="list-place-right">
          <div class="list-distance">📍 ${dist}</div>
          ${p.lowestPrice?`<div class="list-min-price">desde<br><strong>${p.lowestPrice.toFixed(2)}€</strong></div>`:'<div class="list-min-price no-price">Sin precios</div>'}
        </div>
      </div>
      ${topPrices.length?`<div class="list-prices">${pricesHtml}</div>`:''}
      <div class="list-place-footer">
        <button class="list-btn-nav" onclick="event.stopPropagation();navigateTo(${p.lat},${p.lng},'${nameEsc}')">🧭 Ir hasta allí</button>
        <button class="list-btn-report" onclick="event.stopPropagation();state.selectedPlaceId=${p.id};state.currentPlace=allPlacesData.find(x=>x.id===${p.id});openPriceModal()">+ Precio</button>
      </div>
    </div>`;
  }).join('');
}

// === OPEN PLACE PANEL ===
async function openPlace(placeId) {
  state.selectedPlaceId = placeId;
  const panel = document.getElementById('place-panel');
  const overlay = document.getElementById('place-overlay');
  document.getElementById('place-panel-content').innerHTML = '<div class="loading-state">Cargando...</div>';
  overlay.classList.add('visible'); panel.classList.add('visible'); document.body.style.overflow = 'hidden';
  try { const place = await API.get(`/api/places/${placeId}`); state.currentPlace = place; renderPlacePanel(place); }
  catch { toast('Error al cargar el lugar', 'error'); }
}

function renderPlacePanel(place) {
  const info = catInfo(place.category);
  const prices = place.prices || [];
  const pricesHtml = prices.length ? prices.map(p => `
    <div class="price-card">
      <div class="price-info">
        <div class="price-product">${p.product}</div>
        <div class="price-meta">Por ${p.reporter_name||'Usuario'} · ${timeAgo(p.reported_at)}</div>
        <div class="price-votes">
          <button class="vote-btn up ${state.votedPrices[p.id]===1?'voted-up':''}" onclick="votePrice(${p.id},1)">✓ Correcto (${p.votes_up||0})</button>
          <button class="vote-btn down ${state.votedPrices[p.id]===-1?'voted-down':''}" onclick="votePrice(${p.id},-1)">✗ Incorrecto (${p.votes_down||0})</button>
        </div>
      </div>
      <div style="text-align:right">
        <div class="price-amount">${p.price.toFixed(2)}€</div>
        <div class="price-unit">/${p.unit}</div>
        <div style="margin-top:4px"><span class="price-status ${p.status}">${statusLabel(p.status)}</span></div>
      </div>
    </div>`).join('') : `<div class="empty-prices"><span class="empty-icon">💰</span>Sin precios aún.<br>¡Sé el primero!</div>`;
  const nameEsc = place.name.replace(/'/g,"\\'");
  document.getElementById('place-panel-content').innerHTML = `
    <div class="panel-place-header">
      <div class="panel-place-icon" style="background:${info.bg}">${info.emoji}</div>
      <div class="panel-place-info">
        <h2>${place.name}</h2>
        <p>${info.label}${place.address?' · '+place.address:''}</p>
        ${place.hours?`<p>🕐 ${place.hours}`:''}
      </div>
    </div>
    <div class="panel-actions">
      <button class="btn-report" onclick="openPriceModal()">+ Reportar precio</button>
      <button class="btn-fav ${place.isFav?'active':''}" id="fav-btn" onclick="toggleFav(${place.id})">${place.isFav?'❤️ Guardado':'🤍 Guardar'}</button>
      <button class="btn-navigate" onclick="navigateTo(${place.lat},${place.lng},'${nameEsc}')">🧭 Ir hasta allí</button>
    </div>
    <div class="prices-section">
      <h3>Precios de la comunidad</h3>
      ${pricesHtml}
    </div>`;
}

function statusLabel(s) { return {verified:'✅ Verificado',pending:'⏳ Pendiente',disputed:'⚠️ Cuestionado'}[s]||s; }
function timeAgo(dt) {
  const diff = (Date.now() - new Date(dt).getTime())/1000;
  if (diff < 3600) return `hace ${Math.round(diff/60)}m`;
  if (diff < 86400) return `hace ${Math.round(diff/3600)}h`;
  return `hace ${Math.round(diff/86400)}d`;
}

function closePanel() {
  document.getElementById('place-panel').classList.remove('visible');
  document.getElementById('place-overlay').classList.remove('visible');
  document.body.style.overflow = ''; state.currentPlace = null; state.selectedPlaceId = null;
}

async function votePrice(priceId, vote) {
  if (!state.token) { openAuth(); return; }
  try {
    const res = await API.post(`/api/prices/${priceId}/vote`, { vote });
    if (res.error) { toast(res.error, 'error'); return; }
    state.votedPrices[priceId] = vote;
    localStorage.setItem('pm_voted_prices', JSON.stringify(state.votedPrices));
    toast(vote === 1 ? '✅ Precio confirmado' : '⚠️ Precio marcado como incorrecto');
    if (state.selectedPlaceId) openPlace(state.selectedPlaceId);
  } catch { toast('Error al votar', 'error'); }
}

async function toggleFav(placeId) {
  if (!state.token) { openAuth(); return; }
  const res = await API.post(`/api/favorites/${placeId}`, {});
  const btn = document.getElementById('fav-btn');
  if (res.action === 'added') { btn.classList.add('active'); btn.textContent = '❤️ Guardado'; toast('❤️ Guardado en favoritos', 'success'); }
  else { btn.classList.remove('active'); btn.textContent = '🤍 Guardar'; toast('💔 Eliminado de favoritos'); }
}

// === PRICE MODAL ===
let currentPhotoFile = null;
function openPriceModal() {
  if (!state.token) { openAuth(); return; }
  if (!state.selectedPlaceId) { toast('Selecciona un lugar primero', 'warning'); return; }
  const suggestions = {gasolinera:['Gasolina 95','Gasolina 98','Gasoil A','GLP'],supermercado:['Pan Bimbo 600g','Leche 1L','Aceite oliva 1L','Huevos 12u','Agua 6x1.5L'],bar:['Caña cerveza','Café solo','Café con leche','Cubata','Copa vino','Vermut'],cafe:['Café solo','Café con leche','Cortado','Zumo naranja','Tostada'],farmacia:['Ibuprofeno 400mg','Paracetamol 650mg'],restaurante:['Menú del día','Hamburguesa','Pizza']};
  const cat = state.currentPlace?.category;
  const dl = document.getElementById('product-suggestions');
  dl.innerHTML = (suggestions[cat]||['Precio']).map(s => `<option value="${s}">`).join('');
  document.getElementById('price-modal-title').textContent = `Reportar precio — ${state.currentPlace?.name||''}`;
  showModal('price-modal');
}
function closePriceModal() { hideModal('price-modal'); currentPhotoFile = null; document.getElementById('photo-preview').style.display = 'none'; document.getElementById('photo-upload-zone').style.display = 'flex'; }
function clearPhoto() { currentPhotoFile = null; document.getElementById('photo-preview').style.display = 'none'; document.getElementById('photo-upload-zone').style.display = 'flex'; document.getElementById('pm-photo').value = ''; }
document.getElementById('pm-photo').addEventListener('change', function() {
  const file = this.files[0]; if (!file) return;
  currentPhotoFile = file;
  document.getElementById('photo-preview-img').src = URL.createObjectURL(file);
  document.getElementById('photo-preview').style.display = 'flex';
  document.getElementById('photo-upload-zone').style.display = 'none';
});

async function submitPrice() {
  const product = document.getElementById('pm-product').value.trim();
  const price = document.getElementById('pm-price').value;
  const unit = document.getElementById('pm-unit').value;
  if (!product || !price) { toast('Completa producto y precio', 'warning'); return; }
  const btn = document.getElementById('btn-submit-price');
  btn.disabled = true; btn.textContent = 'Publicando...';
  try {
    const fd = new FormData();
    fd.append('place_id', state.selectedPlaceId); fd.append('product', product); fd.append('price', price); fd.append('unit', unit);
    if (currentPhotoFile) fd.append('photo', currentPhotoFile);
    const res = await API.postForm('/api/prices', fd);
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`✅ Precio publicado! +10 pts`, 'success');
    if (res.newBadges?.length) setTimeout(() => toast(`🎖️ Logro: ${res.newBadges[0].emoji} ${res.newBadges[0].name}!`, 'success'), 1000);
    if (state.user) { state.user.points = res.points; state.user.streak = res.streak; localStorage.setItem('pm_user', JSON.stringify(state.user)); }
    closePriceModal();
    if (state.selectedPlaceId) openPlace(state.selectedPlaceId);
    document.getElementById('pm-product').value = ''; document.getElementById('pm-price').value = '';
  } catch { toast('Error al publicar', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Publicar precio'; }
}

// === ADD PLACE ===
document.getElementById('btn-add-place').addEventListener('click', () => { if (!state.token) { openAuth(); return; } showModal('place-modal'); });
function closePlaceModal() { hideModal('place-modal'); }
async function submitPlace() {
  const name = document.getElementById('ap-name').value.trim();
  const cat = document.querySelector('input[name="ap-cat"]:checked')?.value;
  const address = document.getElementById('ap-address').value.trim();
  const hours = document.getElementById('ap-hours').value.trim();
  if (!name || !cat) { toast('Nombre y categoría son obligatorios', 'warning'); return; }
  const center = state.map.getCenter();
  try {
    const res = await API.post('/api/places', { name, category: cat, lat: center.lat, lng: center.lng, address, hours });
    if (res.error) { toast(res.error, 'error'); return; }
    toast(`✅ Lugar añadido: ${name}`, 'success'); closePlaceModal();
    document.getElementById('ap-name').value = '';
    document.querySelectorAll('input[name="ap-cat"]').forEach(r => r.checked = false);
    loadPlaces();
  } catch { toast('Error al añadir', 'error'); }
}

// === DEALS ===
async function loadDeals() {
  const cat = state.activeDealFilter;
  const sort = document.getElementById('deals-sort').value;
  try {
    const deals = await API.get(`/api/deals?cat=${cat}&sort=${sort}`);
    renderDeals(deals);
  } catch { document.getElementById('deals-grid').innerHTML = '<div class="loading-state" style="grid-column:1/-1">Error al cargar</div>'; }
}

function renderDeals(deals) {
  const grid = document.getElementById('deals-grid');
  if (!deals.length) { grid.innerHTML = '<div class="loading-state" style="grid-column:1/-1">No hay chollos aún. ¡Sé el primero! 🔥</div>'; return; }
  grid.innerHTML = deals.map(d => {
    const ai = tryParseJSON(d.ai_analysis);
    const emojiCat = DEAL_CAT[d.category]||'📦';
    const discBadge = d.discount_percent ? `<div class="deal-discount-badge">-${Math.round(d.discount_percent)}%</div>` : '';
    const verdict = ai?.verdict ? `<div style="font-size:11px;color:#7C3AED;margin-top:4px">🤖 ${ai.verdict}</div>` : '';
    const stars = d.ai_score ? '⭐'.repeat(Math.min(Math.round(d.ai_score/2),5)) : '';
    // SIEMPRE usar affiliate_url que ya lleva tag juanantonioex-21
    const link = d.affiliate_url || d.url;
    const linkBtn = link ? `<a href="${link}" target="_blank" rel="noopener" class="btn-deal-link">Ver oferta ↗</a>` : '';
    const myVote = state.votedDeals[d.id];
    return `<div class="deal-card">
      ${discBadge}
      <div class="deal-store-badge">${d.store||'Oferta'}</div>
      <div class="deal-emoji">${emojiCat}</div>
      <div class="deal-body">
        <div class="deal-title">${d.title}</div>
        <div class="deal-prices">
          <span class="deal-current">${parseFloat(d.deal_price).toFixed(2)}€</span>
          ${d.original_price?`<span class="deal-original">${parseFloat(d.original_price).toFixed(2)}€</span>`:''}
        </div>
        ${stars?`<div class="deal-ai-score">${stars} ${d.ai_score}/10</div>`:''}
        ${verdict}
      </div>
      <div class="deal-footer">
        <div class="deal-votes">
          <button class="deal-vote-btn ${myVote===1?'voted-up':''}" onclick="voteDeal(${d.id},1)">🔥 ${d.votes_up||0}</button>
          <button class="deal-vote-btn ${myVote===-1?'voted-down':''}" onclick="voteDeal(${d.id},-1)">👎 ${d.votes_down||0}</button>
        </div>
        ${linkBtn}
      </div>
    </div>`;
  }).join('');
}

function tryParseJSON(s) { try { return JSON.parse(s); } catch { return null; } }

document.querySelectorAll('.deal-filter').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.deal-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); state.activeDealFilter = btn.dataset.cat; loadDeals();
  });
});
document.getElementById('deals-sort').addEventListener('change', loadDeals);

async function voteDeal(dealId, vote) {
  if (!state.token) { openAuth(); return; }
  const res = await API.post(`/api/deals/${dealId}/vote`, { vote });
  if (res.error) { toast(res.error, 'error'); return; }
  state.votedDeals[dealId] = vote;
  localStorage.setItem('pm_voted_deals', JSON.stringify(state.votedDeals));
  toast(vote === 1 ? '🔥 ¡Chollo apuntado!' : '👎 Gracias por tu opinión');
  loadDeals();
}

document.getElementById('btn-submit-deal').addEventListener('click', () => { if (!state.token) { openAuth(); return; } showModal('deal-modal'); });
function closeDealModal() { hideModal('deal-modal'); document.getElementById('ai-analysis-preview').style.display = 'none'; }

async function submitDeal() {
  const title = document.getElementById('dm-title').value.trim();
  const url = document.getElementById('dm-url').value.trim();
  const price = document.getElementById('dm-price').value;
  const original = document.getElementById('dm-original').value;
  const store = document.getElementById('dm-store').value.trim();
  const cat = document.getElementById('dm-cat').value;
  if (!title || !price) { toast('Título y precio son obligatorios', 'warning'); return; }
  const btn = document.getElementById('btn-publish-deal');
  btn.disabled = true; btn.textContent = '🤖 Analizando...';
  document.getElementById('ai-analysis-preview').style.display = 'block';
  document.getElementById('ai-preview-text').textContent = 'Analizando con IA...';
  try {
    const res = await API.post('/api/deals', { title, url, deal_price: price, original_price: original||null, store, category: cat });
    if (res.error) { toast(res.error, 'error'); return; }
    const ai = tryParseJSON(res.ai_analysis);
    if (ai?.verdict) { document.getElementById('ai-preview-text').textContent = `Score: ${res.ai_score}/10 · ${ai.verdict}`; await new Promise(r => setTimeout(r, 1500)); }
    toast(`🔥 ¡Chollo publicado! +5 pts`, 'success');
    closeDealModal();
    loadDeals();
    document.getElementById('dm-title').value = ''; document.getElementById('dm-url').value = '';
    document.getElementById('dm-price').value = ''; document.getElementById('dm-original').value = '';
  } catch { toast('Error al publicar', 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Publicar chollo'; }
}

// === RANKING ===
async function loadRanking(period) {
  period = period || 'month';
  try {
    const data = await API.get(`/api/leaderboard?period=${period}`);
    const rankEmoji = ['🥇','🥈','🥉'];
    const html = data.map((u,i) => {
      const cls = i < 3 ? `top${i+1}` : '';
      const initials = u.name.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
      return `<div class="leader-item ${cls}">
        <div class="leader-rank">${rankEmoji[i]||(i+1)}</div>
        <div class="leader-avatar">${initials}</div>
        <div class="leader-info">
          <div class="leader-name">${u.name}</div>
          <div class="leader-stats">${u.reports||0} reportes · ${u.verified||0} verificados · 🔥 ${u.streak||0} días</div>
        </div>
        <div><div class="leader-points">${u.points||0}<br><span class="pts-label">puntos</span></div></div>
      </div>`;
    }).join('');
    document.getElementById('leaderboard').innerHTML = html || '<div class="loading-state">Nadie ha reportado aún. ¡Sé el primero!</div>';
  } catch { document.getElementById('leaderboard').innerHTML = '<div class="loading-state">Error al cargar</div>'; }
}

document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); loadRanking(btn.dataset.period);
  });
});

// === PROFILE ===
const ALL_BADGE_KEYS = ['primer_reporte','diez_reportes','cincuenta_reportes','guru_gasolina','rey_bar','verificador','racha_7','racha_30','ahorrador'];
const BADGE_META = {
  primer_reporte:{e:'🌟',n:'Primer Reporte',d:'Reporta tu primer precio'},
  diez_reportes:{e:'📊',n:'10 Reportes',d:'10 precios reportados'},
  cincuenta_reportes:{e:'🏅',n:'Experto',d:'50 precios reportados'},
  guru_gasolina:{e:'⛽',n:'Guru Gasolina',d:'10 precios de gasolineras'},
  rey_bar:{e:'🍺',n:'Rey del Bar',d:'10 precios de bares'},
  verificador:{e:'✅',n:'Verificador',d:'20 precios verificados'},
  racha_7:{e:'🔥',n:'Racha Semanal',d:'7 días consecutivos'},
  racha_30:{e:'💎',n:'Constante',d:'30 días consecutivos'},
  ahorrador:{e:'💰',n:'Gran Ahorrador',d:'500 puntos acumulados'},
};

async function renderProfile() {
  const container = document.getElementById('perfil-content');
  if (!state.token) {
    container.innerHTML = `<div class="profile-placeholder"><div class="placeholder-icon">👤</div><p>Inicia sesión para ver tu perfil, puntos y logros</p><button class="btn-primary" onclick="openAuth()">Entrar / Registrarse</button></div>`;
    return;
  }
  container.innerHTML = '<div class="loading-state">Cargando perfil...</div>';
  try {
    const user = await API.get('/api/users/me');
    const earnedKeys = user.badges.map(b => b.key);
    const allBadgesHtml = ALL_BADGE_KEYS.map(key => {
      const badge = user.badges.find(b => b.key === key);
      const m = BADGE_META[key];
      return `<div class="badge-item ${badge?'':'badge-locked'}">
        <span class="badge-emoji">${m.e}</span>
        <div class="badge-name">${m.n}</div>
        <div class="badge-desc">${badge?timeAgo(badge.earned_at):m.d}</div>
      </div>`;
    }).join('');
    const initials = user.name.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2);
    const notifHtml = user.notifications?.length ? user.notifications.map(n => `<div style="padding:10px;background:var(--primary-light);border-radius:8px;margin-bottom:8px;font-size:13px">${n.message}</div>`).join('') : '';
    container.innerHTML = `
      <div class="profile-card">
        <div class="profile-avatar">${initials}</div>
        <div class="profile-name">${user.name}</div>
        <div class="profile-email">${user.email}</div>
        <div class="profile-stats-row">
          <div class="stat-pill"><span class="stat-num">${user.points}</span><span class="stat-lbl">Puntos</span></div>
          <div class="stat-pill"><span class="stat-num">${user.stats?.reports||0}</span><span class="stat-lbl">Reportes</span></div>
          <div class="stat-pill"><span class="stat-num">${user.stats?.verified||0}</span><span class="stat-lbl">Verificados</span></div>
          <div class="stat-pill"><span class="stat-num">${user.badges?.length||0}</span><span class="stat-lbl">Logros</span></div>
        </div>
        <div class="streak-bar"><div class="streak-fire">🔥</div><div class="streak-text">Racha actual: <span class="streak-num">${user.streak||0} días</span></div></div>
      </div>
      ${notifHtml?`<div style="padding:16px">${notifHtml}</div>`:''}
      <div class="badges-section"><h3>Logros</h3><div class="badges-grid">${allBadgesHtml}</div></div>
      <div style="padding:16px"><button class="btn-logout" onclick="logout()">Cerrar sesión</button></div>`;
    if (user.notifications?.length) API.post('/api/notifications/read', {});
  } catch { container.innerHTML = '<div class="loading-state">Error al cargar perfil</div>'; }
}

// === AUTH ===
function openAuth() {
  state.authMode = 'login';
  document.getElementById('auth-title').textContent = 'Iniciar sesión';
  document.getElementById('auth-name-group').style.display = 'none';
  document.getElementById('auth-error').style.display = 'none';
  showModal('auth-modal');
}
function closeAuth() { hideModal('auth-modal'); }
function toggleAuthMode() {
  if (state.authMode === 'login') {
    state.authMode = 'register';
    document.getElementById('auth-title').textContent = 'Crear cuenta';
    document.getElementById('auth-name-group').style.display = 'block';
    document.getElementById('auth-toggle-btn').textContent = '¿Ya tienes cuenta? Inicia sesión';
  } else {
    state.authMode = 'login';
    document.getElementById('auth-title').textContent = 'Iniciar sesión';
    document.getElementById('auth-name-group').style.display = 'none';
    document.getElementById('auth-toggle-btn').textContent = '¿No tienes cuenta? Regístrate';
  }
}
async function submitAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const pass = document.getElementById('auth-pass').value;
  const name = document.getElementById('auth-name').value.trim();
  const errEl = document.getElementById('auth-error');
  errEl.style.display = 'none';
  if (!email || !pass) { errEl.textContent = 'Email y contraseña requeridos'; errEl.style.display = 'block'; return; }
  const btn = document.getElementById('auth-submit-btn') || document.querySelector('#auth-modal .btn-primary');
  if (btn) btn.disabled = true;
  try {
    const url = state.authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const body = state.authMode === 'login' ? { email, password: pass } : { name, email, password: pass };
    const res = await API.post(url, body);
    if (res.error) { errEl.textContent = res.error; errEl.style.display = 'block'; return; }
    state.token = res.token; state.user = res.user;
    localStorage.setItem('pm_token', res.token); localStorage.setItem('pm_user', JSON.stringify(res.user));
    closeAuth(); updateUserUI();
    toast(`🎉 ¡Bienvenido, ${res.user.name}!`, 'success');
  } catch { errEl.textContent = 'Error de conexión'; errEl.style.display = 'block'; }
  finally { if (btn) { btn.disabled = false; } }
}
function logout() {
  state.token = null; state.user = null;
  localStorage.removeItem('pm_token'); localStorage.removeItem('pm_user');
  updateUserUI(); renderProfile(); toast('👋 Sesión cerrada');
}
function updateUserUI() {
  const avatarEl = document.getElementById('user-avatar');
  if (state.user) {
    const initials = state.user.name?.split(' ').map(w=>w[0]).join('').toUpperCase().substring(0,2)||'👤';
    avatarEl.textContent = initials;
    document.getElementById('btn-user').style.background = '#EFF6FF';
    document.getElementById('btn-user').style.color = '#2563EB';
  } else { avatarEl.textContent = '👤'; document.getElementById('btn-user').style.background = ''; }
}
document.getElementById('btn-user').addEventListener('click', () => { if (state.token) document.querySelector('[data-tab="perfil"]').click(); else openAuth(); });
document.getElementById('btn-notif').addEventListener('click', () => { if (state.token) document.querySelector('[data-tab="perfil"]').click(); else openAuth(); });

async function checkNotifications() {
  if (!state.token) return;
  try {
    const user = await API.get('/api/users/me');
    const unread = user.notifications?.filter(n=>!n.is_read).length||0;
    const badge = document.getElementById('notif-badge');
    if (unread > 0) { badge.textContent = unread; badge.style.display = 'flex'; } else badge.style.display = 'none';
  } catch {}
}

// === MODAL HELPERS ===
function showModal(id) { document.getElementById(`${id}-overlay`).classList.add('visible'); document.getElementById(id).classList.add('visible'); document.body.style.overflow = 'hidden'; }
function hideModal(id) { document.getElementById(`${id}-overlay`).classList.remove('visible'); document.getElementById(id).classList.remove('visible'); document.body.style.overflow = ''; }

// === INIT ===
function init() {
  initMap(); updateUserUI(); checkNotifications();
  setInterval(checkNotifications, 60000);
  document.getElementById('cat-filters').style.display = 'flex';
}
window.addEventListener('load', init);

// Globals for inline handlers
window.openPlace = openPlace; window.openPriceModal = openPriceModal;
window.closePriceModal = closePriceModal; window.closePlaceModal = closePlaceModal;
window.closeDealModal = closeDealModal; window.closePanel = closePanel;
window.votePrice = votePrice; window.voteDeal = voteDeal; window.toggleFav = toggleFav;
window.submitPrice = submitPrice; window.submitPlace = submitPlace; window.submitDeal = submitDeal;
window.openAuth = openAuth; window.closeAuth = closeAuth; window.toggleAuthMode = toggleAuthMode;
window.submitAuth = submitAuth; window.logout = logout; window.clearPhoto = clearPhoto;
window.navigateTo = navigateTo; window.switchView = switchView; window.renderListView = renderListView;
