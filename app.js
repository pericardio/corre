// ===== Utilidades =====
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 3500) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, ms); }
const fmtTime = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
const fmtPace = spk => (!spk || !isFinite(spk) || spk > 1800) ? '--:--' : fmtTime(spk);
const parsePace = str => { const m = String(str || '').trim().match(/^(\d{1,2})(?:[:.,'](\d{1,2}))?$/); if (!m) return null; return +m[1] * 60 + (m[2] ? +(m[2].length === 1 ? m[2] + '0' : m[2]) : 0); };
function haversine(a, b) { const R = 6371000, r = Math.PI / 180; const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

// ===== Almacenamiento =====
const DB = (() => {
  let dbp;
  const open = () => dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open('corre', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('audios', { keyPath: 'id' }); r.result.createObjectStore('runs', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => res(req && req.result); t.onerror = () => rej(t.error); }); };
  return {
    all: s => tx(s, 'readonly', st => st.getAll()),
    get: (s, id) => tx(s, 'readonly', st => st.get(id)),
    put: (s, v) => tx(s, 'readwrite', st => st.put(v)),
    del: (s, id) => tx(s, 'readwrite', st => st.delete(id)),
  };
})();
const Plans = {
  all: () => { try { return JSON.parse(localStorage.getItem('plans')) || []; } catch { return []; } },
  save(p) { const all = Plans.all(); const i = all.findIndex(x => x.id === p.id); i >= 0 ? all[i] = p : all.push(p); localStorage.setItem('plans', JSON.stringify(all)); Sync.schedulePlans(Plans.all); },
  del(id) { localStorage.setItem('plans', JSON.stringify(Plans.all().filter(p => p.id !== id))); Sync.schedulePlans(Plans.all); },
  replace(list) { localStorage.setItem('plans', JSON.stringify(list)); },
};
const Settings = {
  get: (k, d) => localStorage.getItem('set_' + k) ?? d,
  set: (k, v) => localStorage.setItem('set_' + k, v),
};

// ===== Navegación =====
const TITLES = { run: 'Correr', plans: 'Planes', 'plan-edit': 'Editar plan', audios: 'Mis audios', settings: 'Ajustes' };
function show(view) {
  document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + view);
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#title').textContent = TITLES[view];
  if (view === 'plans') renderPlans();
  if (view === 'audios') renderAudios();
  if (view === 'run') renderRunView();
  if (view === 'settings') renderSettings();
  window.scrollTo(0, 0);
}
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { if (Run.active && b.dataset.view !== 'run') { if (!confirm('Hay una carrera en marcha. ¿Salir de la pantalla de carrera? (sigue grabando)')) return; } show(b.dataset.view); });

// ===== Audios =====
async function addAudio(blob, name) {
  const a = { id: uid(), name: name || 'Audio', blob, type: blob.type, createdAt: Date.now() };
  await DB.put('audios', a);
  if (Sync.enabled()) { try { await Sync.pushAudio(a); a.synced = true; await DB.put('audios', a); } catch (e) { toast('Guardado en este dispositivo, pero no se pudo subir: ' + e.message, 6000); } }
  return a;
}
const urlCache = new Map();
const audioURL = a => { if (!urlCache.has(a.id)) urlCache.set(a.id, URL.createObjectURL(a.blob)); return urlCache.get(a.id); };

async function renderAudios() {
  const list = (await DB.all('audios')).sort((a, b) => b.createdAt - a.createdAt);
  $('#audio-list').innerHTML = list.length ? list.map(a => `
    <div class="card" data-id="${a.id}">
      <div class="top"><input class="aname" value="${esc(a.name)}" style="margin:0"></div>
      <div class="row" style="margin-top:8px">
        <button class="btn small" data-act="play">▶︎ Escuchar</button>
        <button class="btn small danger" data-act="del">Borrar</button>
      </div>
    </div>`).join('') : '<p class="hint">Aún no hay audios.</p>';
  $('#audio-list').querySelectorAll('.card').forEach(card => {
    const a = list.find(x => x.id === card.dataset.id);
    card.querySelector('.aname').onchange = e => { a.name = e.target.value; DB.put('audios', a); Sync.renameAudio(a).catch(e => toast(e.message)); };
    card.querySelector('[data-act=play]').onclick = () => Player.preview(a);
    card.querySelector('[data-act=del]').onclick = async () => { if (confirm('¿Borrar "' + a.name + '"?')) { await DB.del('audios', a.id); renderAudios(); Sync.deleteAudio(a).catch(e => toast(e.message)); } };
  });
}
$('#audio-file').onchange = async e => {
  for (const f of e.target.files) await addAudio(f, f.name.replace(/\.[^.]+$/, ''));
  e.target.value = ''; toast('Audio guardado'); renderAudios();
};
let rec = null;
$('#btn-record').onclick = async () => {
  if (rec) { rec.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    rec = new MediaRecorder(stream);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/mp4' });
      rec = null; $('#btn-record').textContent = '● Grabar';
      const name = prompt('Nombre del audio', 'Grabación ' + new Date().toLocaleString('es-ES'));
      await addAudio(blob, name || 'Grabación'); renderAudios();
    };
    rec.start(); $('#btn-record').textContent = '■ Parar';
  } catch (err) { toast('No se pudo usar el micrófono: ' + err.message); rec = null; }
};

// ===== Reproductor de audios (con "ducking" de Spotify) =====
const Player = (() => {
  const el = new Audio(); el.preload = 'auto'; el.playsInline = true;
  // WAV de 0,2 s en silencio, generado aquí para "desbloquear" el audio en iOS.
  const SILENCE = (() => { const n = 1600, b = new ArrayBuffer(44 + n), v = new DataView(b); const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, n, true); for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([b], { type: 'audio/wav' })); })();
  const queue = []; let busy = false;
  // iOS: el audio solo puede sonar si se "desbloquea" con un toque del usuario.
  function unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'transient'; } catch {}
    el.src = SILENCE; el.play().catch(() => {});
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); }
  }
  const playEl = src => new Promise(res => { el.src = src; el.onended = el.onerror = () => res(); el.play().catch(() => res()); });
  const speakNow = text => new Promise(res => {
    if (!('speechSynthesis' in window) || Settings.get('voice', '1') !== '1') return res();
    const u = new SpeechSynthesisUtterance(text); u.lang = 'es-ES'; u.rate = 1.0;
    const v = speechSynthesis.getVoices().find(v => v.lang.startsWith('es')); if (v) u.voice = v;
    u.onend = u.onerror = () => res(); speechSynthesis.speak(u);
    setTimeout(res, 15000);
  });
  async function pump() {
    if (busy) return; busy = true;
    while (queue.length) {
      const item = queue.shift();
      const restore = await Spotify.duck(Settings.get('duck', 'volume'));
      if (item.audio) await playEl(audioURL(item.audio));
      if (item.text) await speakNow(item.text);
      await restore();
    }
    busy = false;
  }
  return {
    unlock,
    enqueue(item) { queue.push(item); pump(); },
    preview(a) { el.src = audioURL(a); el.play(); },
    speak: text => { queue.push({ text }); pump(); },
  };
})();

// ===== Planes =====
function planEstimate(p) {
  if (!p.distanceKm || !p.paceSec) return '';
  return `Tiempo estimado: ${fmtTime(p.distanceKm * p.paceSec)} a ${fmtPace(p.paceSec)}/km`;
}
function renderPlans() {
  const plans = Plans.all();
  $('#plan-list').innerHTML = plans.length ? plans.map(p => `
    <div class="card" data-id="${p.id}">
      <div class="top"><strong>${esc(p.name)}</strong><button class="btn small" data-act="edit">Editar</button></div>
      <div class="meta">${p.distanceKm || '?'} km · ${fmtPace(p.paceSec)}/km · ${p.triggers.length} audio(s)${p.playlist ? ' · 🎵 ' + esc(p.playlist.name) : ''}</div>
      <div class="meta">${planEstimate(p)}</div>
    </div>`).join('') : '<p class="hint">Crea tu primer plan: distancia, ritmo, música y los audios que quieres oír por el camino.</p>';
  $('#plan-list').querySelectorAll('[data-act=edit]').forEach(b => b.onclick = () => editPlan(b.closest('.card').dataset.id));
}
let editing = null;
$('#btn-new-plan').onclick = () => editPlan(null);
async function editPlan(id) {
  editing = id ? structuredClone(Plans.all().find(p => p.id === id)) : { id: uid(), name: '', distanceKm: 10, paceSec: 390, kmVoice: true, triggers: [], playlist: null };
  $('#pe-name').value = editing.name; $('#pe-dist').value = editing.distanceKm || ''; $('#pe-pace').value = editing.paceSec ? fmtPace(editing.paceSec) : '';
  $('#pe-km').checked = !!editing.kmVoice;
  $('#btn-del-plan').hidden = !id;
  show('plan-edit'); updateEstimate(); renderTriggers(); renderPlanSpotify();
}
function readPlanForm() {
  editing.name = $('#pe-name').value.trim() || 'Plan sin nombre';
  editing.distanceKm = parseFloat($('#pe-dist').value) || 0;
  editing.paceSec = parsePace($('#pe-pace').value);
  editing.kmVoice = $('#pe-km').checked;
}
function updateEstimate() { readPlanForm(); $('#pe-estimate').textContent = planEstimate(editing); renderTriggerHints(); }
['#pe-dist', '#pe-pace'].forEach(s => $(s).oninput = updateEstimate);

async function renderTriggers() {
  const audios = await DB.all('audios');
  const opts = sel => '<option value="">— elige audio —</option>' + audios.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  $('#pe-triggers').innerHTML = editing.triggers.map((t, i) => `
    <div class="trigger" data-i="${i}">
      <label class="full">Audio<select data-k="audioId">${opts(t.audioId)}</select></label>
      <label>Saltar por<select data-k="type"><option value="distance" ${t.type === 'distance' ? 'selected' : ''}>Distancia (km)</option><option value="time" ${t.type === 'time' ? 'selected' : ''}>Tiempo (min)</option></select></label>
      <label>${t.type === 'time' ? 'Minuto' : 'Km'}<input data-k="value" type="number" step="0.1" min="0" inputmode="decimal" value="${t.value}"></label>
      <div class="full row" style="align-items:center"><span class="hint th"></span><button class="btn small danger" data-act="del" style="flex:0">Quitar</button></div>
    </div>`).join('') || (audios.length ? '' : '<p class="hint">Primero sube o graba algún audio en la pestaña Audios.</p>');
  $('#pe-triggers').querySelectorAll('.trigger').forEach(div => {
    const t = editing.triggers[div.dataset.i];
    div.querySelectorAll('[data-k]').forEach(inp => inp.onchange = () => { t[inp.dataset.k] = inp.dataset.k === 'value' ? parseFloat(inp.value) || 0 : inp.value; if (inp.dataset.k === 'type') renderTriggers(); else renderTriggerHints(); });
    div.querySelector('[data-act=del]').onclick = () => { editing.triggers.splice(div.dataset.i, 1); renderTriggers(); };
  });
  renderTriggerHints();
}
function renderTriggerHints() {
  document.querySelectorAll('#pe-triggers .trigger').forEach(div => {
    const t = editing.triggers[div.dataset.i]; const h = div.querySelector('.th'); if (!h || !editing.paceSec) return;
    h.textContent = t.type === 'distance' ? `≈ en el minuto ${fmtTime(t.value * editing.paceSec)} a tu ritmo` : `≈ en el km ${(t.value * 60 / editing.paceSec).toFixed(2)} a tu ritmo`;
  });
}
$('#btn-add-trigger').onclick = () => {
  const last = editing.triggers[editing.triggers.length - 1];
  editing.triggers.push({ id: uid(), type: 'distance', value: last ? (last.value || 0) + 1 : 3, audioId: '' });
  renderTriggers();
};
async function renderPlanSpotify() {
  const box = $('#pe-spotify');
  if (!Spotify.connected()) { box.innerHTML = '<p class="hint">Conecta Spotify en Ajustes para elegir una lista. Si no, pon tú la música en Spotify antes de empezar.</p>'; return; }
  box.innerHTML = `<p class="hint">${editing.playlist ? 'Lista elegida: <strong>' + esc(editing.playlist.name) + '</strong>' : 'Sin lista: seguirá lo que esté sonando.'}</p><div class="pl-scroll">Cargando listas…</div>`;
  try {
    const pls = await Spotify.playlists();
    const sc = box.querySelector('.pl-scroll');
    sc.innerHTML = `<div class="pl-item ${!editing.playlist ? 'sel' : ''}" data-uri="">— Ninguna (lo que esté sonando) —</div>` + pls.map(p => `<div class="pl-item ${editing.playlist && editing.playlist.uri === p.uri ? 'sel' : ''}" data-uri="${p.uri}" data-name="${esc(p.name)}">${p.images && p.images[0] ? `<img src="${p.images[p.images.length - 1].url}" alt="">` : ''}<span>${esc(p.name)}</span></div>`).join('');
    sc.querySelectorAll('.pl-item').forEach(it => it.onclick = () => { editing.playlist = it.dataset.uri ? { uri: it.dataset.uri, name: it.dataset.name } : null; renderPlanSpotify(); });
  } catch (e) { box.querySelector('.pl-scroll').textContent = 'Error: ' + e.message; }
}
$('#btn-save-plan').onclick = () => {
  readPlanForm();
  if (!editing.paceSec) return toast('Pon el ritmo como 6:30');
  editing.triggers = editing.triggers.filter(t => t.audioId);
  Plans.save(editing); toast('Plan guardado'); show('plans');
};
$('#btn-cancel-plan').onclick = () => show('plans');
$('#btn-del-plan').onclick = () => { if (confirm('¿Borrar este plan?')) { Plans.del(editing.id); show('plans'); } };

// ===== Carrera =====
const Run = {
  active: false, paused: false, plan: null, sim: false,
  distance: 0, elapsed: 0, lastTick: 0, points: [], last: null, fired: new Set(), lastKm: 0,
  watchId: null, timer: null, wakeLock: null, recent: [],
};
function renderRunView() {
  const plans = Plans.all(); const sel = $('#run-plan'); const cur = sel.value;
  sel.innerHTML = '<option value="">Carrera libre (sin plan)</option>' + plans.map(p => `<option value="${p.id}">${esc(p.name)} · ${p.distanceKm} km a ${fmtPace(p.paceSec)}</option>`).join('');
  sel.value = cur || Settings.get('lastPlan', '');
  sel.disabled = Run.active; $('#run-sim').disabled = Run.active;
  renderHistory(); if (!Run.active) refreshSpotifyStatus();
}
// Arranca la música en el iPhone. Si Spotify no está "despierto" en el móvil, abre la app
// de Spotify y lo reintenta cuando el usuario vuelva (iOS no permite otra cosa).
async function startSpotify() {
  if (!Run.active || !Run.spotifyPending || Run.spotifyBusy) return;
  Run.spotifyBusy = true; const el = $('#r-spotify');
  try {
    const d = await Spotify.play(Run.plan && Run.plan.playlist ? Run.plan.playlist.uri : undefined);
    Run.spotifyPending = false; el.textContent = 'Spotify: sonando en ' + d.name; el.style.color = '';
  } catch (e) {
    if (e.noDevice) {
      Run.spotifyTries++;
      el.textContent = 'Spotify: abriendo Spotify en el móvil… dale al play si no suena y vuelve aquí.'; el.style.color = 'var(--bad)';
      if (!Run.spotifyOpened) { Run.spotifyOpened = true; setTimeout(() => Spotify.openApp(Run.plan && Run.plan.playlist ? Run.plan.playlist.uri : null), 300); }
      if (Run.spotifyTries > 40) { Run.spotifyPending = false; el.textContent = 'Spotify: no he podido arrancarlo. Pon tú la música en Spotify.'; }
    } else { Run.spotifyPending = false; toast(e.message, 8000); el.textContent = e.message; el.style.color = 'var(--bad)'; }
  } finally { Run.spotifyBusy = false; }
}
async function refreshSpotifyStatus() {
  const el = $('#r-spotify');
  if (!Spotify.connected()) { el.textContent = 'Spotify: sin conectar (pon tú la música antes de salir)'; return; }
  el.textContent = 'Spotify: comprobando…';
  try { const d = await Spotify.describe(); el.textContent = d.text; el.style.color = d.ok ? '' : 'var(--bad)'; }
  catch (e) { el.textContent = 'Spotify: ' + e.message; el.style.color = 'var(--bad)'; }
}
async function acquireWakeLock() { try { Run.wakeLock = await navigator.wakeLock?.request('screen'); } catch {} }
document.addEventListener('visibilitychange', () => { if (Run.active && document.visibilityState === 'visible') { acquireWakeLock(); startSpotify(); } });

$('#btn-start').onclick = async () => {
  Player.unlock();
  const planId = $('#run-plan').value; Settings.set('lastPlan', planId);
  Object.assign(Run, { active: true, paused: false, plan: Plans.all().find(p => p.id === planId) || null, sim: $('#run-sim').checked,
    distance: 0, elapsed: 0, lastTick: Date.now(), points: [], last: null, fired: new Set(), lastKm: 0, recent: [], startedAt: Date.now() });
  $('#btn-start').hidden = true; $('#btn-pause').hidden = false; $('#btn-stop').hidden = false; $('#btn-pause').textContent = 'Pausa';
  renderRunView(); acquireWakeLock();
  if (!Run.sim) {
    if (!navigator.geolocation) { toast('Este navegador no tiene GPS'); }
    else Run.watchId = navigator.geolocation.watchPosition(onPos, err => { $('#r-gps').textContent = 'GPS: ' + err.message; }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  } else $('#r-gps').textContent = 'Simulación: 10x más rápido, al ritmo del plan';
  Run.timer = setInterval(tick, 1000);
  if (Spotify.connected()) { Run.spotifyPending = true; Run.spotifyOpened = false; Run.spotifyTries = 0; Run.spotifyTick = 0; startSpotify(); }
  Player.speak(Run.plan ? `Empezamos ${Run.plan.name}. Objetivo, ${paceWords(Run.plan.paceSec)} el kilómetro.` : 'Empezamos.');
};
$('#btn-pause').onclick = () => {
  Run.paused = !Run.paused; Run.last = null; Run.lastTick = Date.now();
  $('#btn-pause').textContent = Run.paused ? 'Seguir' : 'Pausa';
  if (Spotify.connected()) (Run.paused ? Spotify.pause() : Spotify.resume()).catch(() => {});
};
$('#btn-stop').onclick = async () => {
  if (!confirm('¿Terminar la carrera?')) return;
  if (Run.watchId != null) navigator.geolocation.clearWatch(Run.watchId);
  clearInterval(Run.timer); Run.active = false; try { Run.wakeLock?.release(); } catch {}
  $('#btn-start').hidden = false; $('#btn-pause').hidden = true; $('#btn-stop').hidden = true;
  const run = { id: uid(), date: Run.startedAt, planName: Run.plan ? Run.plan.name : 'Carrera libre', distance: Run.distance, elapsed: Run.elapsed, points: Run.points, sim: Run.sim };
  if (run.distance > 50) { await DB.put('runs', run); toast('Carrera guardada'); }
  Player.speak(`Fin. ${(Run.distance / 1000).toFixed(2).replace('.', ',')} kilómetros en ${timeWords(Run.elapsed)}.`);
  renderRunView();
};

function onPos(pos) {
  const { latitude: lat, longitude: lon, accuracy } = pos.coords;
  $('#r-gps').textContent = `GPS: ±${Math.round(accuracy)} m`;
  if (!Run.active || Run.paused || accuracy > 35) return; // descartamos lecturas malas
  const p = { lat, lon, t: pos.timestamp, acc: accuracy };
  if (Run.last) {
    const d = haversine(Run.last, p), dt = (p.t - Run.last.t) / 1000;
    if (d < Math.max(3, accuracy / 3)) return;          // ruido estando quieto
    if (dt > 0 && d / dt > 9) return;                    // salto imposible (> 32 km/h)
    Run.distance += d;
    Run.recent.push({ d, dt });
  }
  Run.last = p; Run.points.push(p);
}
function tick() {
  const now = Date.now(); const dt = (now - Run.lastTick) / 1000; Run.lastTick = now;
  if (Run.paused) return;
  Run.elapsed += dt;
  if (Run.spotifyPending && (++Run.spotifyTick % 4) === 0) startSpotify();
  if (Run.sim) { const pace = (Run.plan && Run.plan.paceSec) || 360; const d = 10 * dt * 1000 / pace; Run.distance += d; Run.recent.push({ d, dt }); Run.elapsed += dt * 9; }
  // Ritmo actual: últimos ~30 s
  let sd = 0, st = 0; for (let i = Run.recent.length - 1; i >= 0 && st < (Run.sim ? 3 : 30); i--) { sd += Run.recent[i].d; st += Run.recent[i].dt; }
  if (Run.recent.length > 200) Run.recent.splice(0, 100);
  const cur = sd > 5 ? (st / sd) * 1000 * (Run.sim ? 10 : 1) : null;
  const avg = Run.distance > 20 ? Run.elapsed / (Run.distance / 1000) : null;
  $('#r-dist').textContent = (Run.distance / 1000).toFixed(2);
  $('#r-time').textContent = fmtTime(Run.elapsed);
  $('#r-pace').textContent = fmtPace(cur); $('#r-avg').textContent = fmtPace(avg);
  const plan = Run.plan;
  if (plan && plan.paceSec && Run.distance > 50) {
    const diff = Run.elapsed - (Run.distance / 1000) * plan.paceSec; // >0 = vas tarde
    const el = $('#r-delta'); el.className = 'delta ' + (diff <= 0 ? 'ok' : 'bad');
    el.textContent = Math.abs(diff) < 3 ? 'Justo en tu ritmo objetivo' : (diff <= 0 ? 'Vas ' + fmtTime(-diff) + ' por delante' : 'Vas ' + fmtTime(diff) + ' por detrás') + ' del objetivo';
  } else $('#r-delta').textContent = '';
  checkTriggers(cur, avg);
}
function checkTriggers(cur, avg) {
  const km = Run.distance / 1000, min = Run.elapsed / 60, plan = Run.plan;
  if (plan) {
    for (const t of plan.triggers) {
      if (Run.fired.has(t.id)) continue;
      if ((t.type === 'distance' && km >= t.value) || (t.type === 'time' && min >= t.value)) {
        Run.fired.add(t.id);
        DB.get('audios', t.audioId).then(a => a && Player.enqueue({ audio: a }));
      }
    }
    const pending = plan.triggers.filter(t => !Run.fired.has(t.id)).map(t => ({ t, left: t.type === 'distance' ? t.value - km : (t.value - min) * 60 / (plan.paceSec || 360) })).sort((a, b) => a.left - b.left)[0];
    $('#r-next').textContent = pending ? `Próximo audio en ${pending.left.toFixed(2)} km aprox.` : (plan.triggers.length ? 'Ya han sonado todos los audios' : '');
  }
  const wholeKm = Math.floor(km);
  if (wholeKm > Run.lastKm) {
    Run.lastKm = wholeKm;
    if (!plan || plan.kmVoice) {
      let txt = `Kilómetro ${wholeKm}. Tiempo, ${timeWords(Run.elapsed)}. Ritmo medio, ${paceWords(avg)}.`;
      if (plan && plan.paceSec) { const diff = Run.elapsed - km * plan.paceSec; txt += Math.abs(diff) < 10 ? ' Justo en tu ritmo.' : diff < 0 ? ` Vas ${Math.round(-diff)} segundos por delante.` : ` Vas ${Math.round(diff)} segundos por detrás. ¡Aprieta!`; }
      Player.speak(txt);
    }
  }
}
const paceWords = s => { if (!s || !isFinite(s)) return 'sin datos'; s = Math.round(s); const m = Math.floor(s / 60), x = s % 60; return `${m} minutos${x ? ' ' + x : ''}`; };
const timeWords = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return [h && h + (h === 1 ? ' hora' : ' horas'), m && m + ' minutos', x && x + ' segundos'].filter(Boolean).join(' ') || '0 segundos'; };

// ===== Historial y exportación GPX (para subir a Strava) =====
async function renderHistory() {
  const runs = (await DB.all('runs')).sort((a, b) => b.date - a.date).slice(0, 20);
  $('#history').innerHTML = runs.length ? runs.map(r => `
    <div class="card" data-id="${r.id}">
      <div class="top"><strong>${esc(r.planName)}${r.sim ? ' (simulación)' : ''}</strong><span class="meta">${new Date(r.date).toLocaleDateString('es-ES')}</span></div>
      <div class="meta">${(r.distance / 1000).toFixed(2)} km · ${fmtTime(r.elapsed)} · ${fmtPace(r.elapsed / (r.distance / 1000))}/km</div>
      <div class="row" style="margin-top:6px">${r.points.length > 1 ? '<button class="btn small" data-act="gpx">Descargar GPX (Strava)</button>' : ''}<button class="btn small danger" data-act="del">Borrar</button></div>
    </div>`).join('') : '<p class="hint">Aquí aparecerán tus carreras.</p>';
  $('#history').querySelectorAll('.card').forEach(c => {
    const r = runs.find(x => x.id === c.dataset.id);
    c.querySelector('[data-act=gpx]')?.addEventListener('click', () => downloadGPX(r));
    c.querySelector('[data-act=del]').onclick = async () => { if (confirm('¿Borrar esta carrera?')) { await DB.del('runs', r.id); renderHistory(); } };
  });
}
function downloadGPX(r) {
  const pts = r.points.map(p => `<trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.t).toISOString()}</time></trkpt>`).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Corre" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(r.planName)}</name><type>running</type><trkseg>\n${pts}\n</trkseg></trk></gpx>`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([gpx], { type: 'application/gpx+xml' }));
  a.download = `carrera-${new Date(r.date).toISOString().slice(0, 10)}.gpx`; a.click();
}

// ===== Ajustes =====
function renderSettings() {
  $('#gh-token').value = Sync.token(); renderSyncStatus();
  $('#redirect-uri').textContent = Spotify.redirectUri();
  $('#sp-client').value = Spotify.clientId();
  $('#duck-mode').value = Settings.get('duck', 'volume');
  $('#voice-on').checked = Settings.get('voice', '1') === '1';
  const s = $('#sp-status');
  if (Spotify.connected()) { s.textContent = 'Conectado. Comprobando…'; Spotify.me().then(m => s.textContent = '✅ Conectado como ' + m.display_name + (!m.product ? '' : m.product !== 'premium' ? ' (ojo: Spotify dice que el plan es "' + m.product + '" y para controlar la música hace falta Premium)' : ' (Premium ✓)')).catch(e => s.textContent = '⚠️ ' + e.message); }
  else s.textContent = 'No conectado.';
}
$('#sp-client').onchange = e => Spotify.setClientId(e.target.value);
$('#btn-sp-connect').onclick = () => { Spotify.setClientId($('#sp-client').value); Spotify.login().catch(e => toast(e.message)); };
$('#btn-sp-disconnect').onclick = () => { Spotify.disconnect(); renderSettings(); };
$('#duck-mode').onchange = e => Settings.set('duck', e.target.value);
$('#voice-on').onchange = e => Settings.set('voice', e.target.checked ? '1' : '0');
$('#btn-test-voice').onclick = () => { Player.unlock(); Player.speak('Kilómetro 3. Vas fenomenal. ¡Aprieta!'); };
function renderSyncStatus() {
  const s = $('#gh-status');
  if (!Sync.enabled()) { s.textContent = 'Sin sincronizar: los planes y audios se quedan solo en este dispositivo.'; return; }
  s.textContent = 'Comprobando…';
  Sync.check().then(n => s.textContent = '✅ Sincronizando con ' + n + (Sync.lastSync() ? ' · última vez ' + new Date(Sync.lastSync()).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '')).catch(e => s.textContent = '⚠️ ' + e.message);
}
$('#gh-token').onchange = e => { Sync.setToken(e.target.value); renderSyncStatus(); if (Sync.enabled()) syncNow(); };
$('#btn-sync').onclick = () => syncNow();
async function syncNow(silent) {
  if (!Sync.enabled()) return;
  try {
    const local = await DB.all('audios');
    const r = await Sync.pull(local);
    if (!r) return;
    const localPlans = Plans.all();
    if (r.plans) Plans.replace(r.plans);
    else if (localPlans.length) await Sync.pushPlans(localPlans); // primer dispositivo: sube lo que tenga
    for (const a of r.audios) { if (a.blob) await DB.put('audios', { id: a.id, name: a.name, type: a.type, ext: a.ext, createdAt: a.createdAt, blob: a.blob, synced: true }); }
    for (const id of r.removedAudioIds) await DB.del('audios', id);
    // Audios locales que nunca se subieron (por ejemplo, creados antes de poner la clave)
    const remoteIds = new Set(r.audios.map(a => a.id));
    for (const a of local) if (!remoteIds.has(a.id) && !a.synced) { await Sync.pushAudio(a); a.synced = true; await DB.put('audios', a); }
    const v = document.querySelector('.view:not([hidden])'); const id = v && v.id.replace('view-', '');
    if (id === 'plans') renderPlans(); if (id === 'audios') renderAudios(); if (id === 'run') renderRunView(); if (id === 'settings') renderSyncStatus();
    if (!silent) toast('Sincronizado');
  } catch (e) { toast('Sincronización: ' + e.message, 6000); }
}
Sync.onChange(w => { if (w.startsWith('error:')) toast('No se pudo subir a GitHub: ' + w.slice(6), 6000); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !Run.active) syncNow(true); });
$('#btn-export').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(Plans.all(), null, 2)], { type: 'application/json' })); a.download = 'planes.json'; a.click(); };

// ===== Arranque =====
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage?.persist) navigator.storage.persist();
Spotify.handleRedirect().then(ok => { if (ok) { toast('Spotify conectado'); show('settings'); } else show('run'); syncNow(true); }).catch(e => { toast(e.message); show('settings'); });
