// Sincronización de planes y audios entre dispositivos usando un repositorio
// privado de GitHub como almacén (plans.json + audios/*). Solo hace falta una
// clave de acceso con permiso "Contents" sobre ese repositorio.
const Sync = (() => {
  const LS = { token: 'gh_token', repo: 'gh_repo', last: 'gh_last_sync' };
  const DEFAULT_REPO = 'pericardio/corre-datos';
  const API = 'https://api.github.com';
  const shas = {}; // ruta -> sha conocido, para actualizar ficheros
  let pulling = null, plansTimer = null, queue = Promise.resolve();
  const serial = fn => { const p = queue.then(fn, fn); queue = p.catch(() => {}); return p; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const listeners = [];

  const token = () => localStorage.getItem(LS.token) || '';
  const setToken = t => { t = t.trim(); t ? localStorage.setItem(LS.token, t) : localStorage.removeItem(LS.token); };
  const repo = () => localStorage.getItem(LS.repo) || DEFAULT_REPO;
  const setRepo = r => localStorage.setItem(LS.repo, (r || '').trim() || DEFAULT_REPO);
  const enabled = () => !!token();
  const lastSync = () => +localStorage.getItem(LS.last) || 0;
  const onChange = fn => listeners.push(fn);
  const notify = what => listeners.forEach(fn => { try { fn(what); } catch {} });

  async function req(path, opts = {}, raw = false) {
    const r = await fetch(API + '/repos/' + repo() + '/contents/' + path, {
      ...opts,
      headers: {
        Authorization: 'Bearer ' + token(),
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
    if (r.status === 404) return null;
    if (r.status === 409 && (opts.method || 'GET') === 'GET') return null; // repositorio vacío (sin commits)
    if (r.status === 401) throw new Error('La clave de GitHub no es válida o ha caducado');
    if (r.status === 403) throw new Error('La clave de GitHub no tiene permiso "Contents: Read and write" sobre ' + repo());
    if (!r.ok) { let msg = ''; try { msg = (await r.json()).message || ''; } catch {} const e = new Error('GitHub ' + r.status + (msg ? ': ' + msg : '')); e.status = r.status; throw e; }
    return raw ? r : r.json();
  }

  // Lee un fichero: devuelve {sha, blob} o null si no existe.
  async function getFile(path) {
    const r = await req(path, { cache: 'no-store' }, true);
    if (!r) return null;
    // La respuesta "raw" no trae sha; lo pedimos aparte solo cuando vayamos a escribir.
    return r.blob();
  }
  async function getSha(path) {
    const meta = await req(path + '?t=' + Date.now());
    shas[path] = meta ? meta.sha : undefined;
    return shas[path];
  }
  const toB64 = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(',')[1]); fr.onerror = rej; fr.readAsDataURL(blob); });

  async function putFile(path, blob, message) {
    const content = await toB64(blob);
    const attempt = async () => {
      if (!(path in shas)) await getSha(path);
      const body = { message, content };
      if (shas[path]) body.sha = shas[path];
      const res = await req(path, { method: 'PUT', body: JSON.stringify(body) });
      shas[path] = res.content.sha;
    };
    return serial(async () => {
      for (let i = 0; ; i++) {
        try { return await attempt(); }
        catch (e) { if ((e.status === 409 || e.status === 422) && i < 3) { delete shas[path]; await wait(1000 * (i + 1)); } else throw e; }
      }
    });
  }
  async function deleteFile(path, message) {
    return serial(async () => {
      for (let i = 0; ; i++) {
        const sha = await getSha(path);
        if (!sha) return;
        try { await req(path, { method: 'DELETE', body: JSON.stringify({ message, sha }) }); delete shas[path]; return; }
        catch (e) { if (e.status === 409 && i < 3) await wait(1000 * (i + 1)); else throw e; }
      }
    });
  }

  const extOf = a => a.ext || ({ 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm' }[(a.type || '').split(';')[0]] || 'bin');
  const audioPath = a => 'audios/' + a.id + '.' + extOf(a);

  // ---- Planes ----
  async function pushPlans(plans) {
    if (!enabled()) return;
    await putFile('plans.json', new Blob([JSON.stringify(plans, null, 2)], { type: 'application/json' }), 'Actualizar planes');
    localStorage.setItem(LS.last, Date.now());
  }
  function schedulePlans(getPlans) {
    if (!enabled()) return;
    clearTimeout(plansTimer);
    plansTimer = setTimeout(() => pushPlans(getPlans()).then(() => notify('plans-pushed')).catch(e => notify('error:' + e.message)), 800);
  }

  // ---- Audios ----
  async function readIndex() {
    const b = await getFile('audios/index.json');
    if (!b) return [];
    try { return JSON.parse(await b.text()); } catch { return []; }
  }
  const writeIndex = idx => putFile('audios/index.json', new Blob([JSON.stringify(idx, null, 2)], { type: 'application/json' }), 'Actualizar índice de audios');

  async function pushAudio(a) {
    if (!enabled()) return;
    a.ext = extOf(a);
    await putFile(audioPath(a), a.blob, 'Añadir audio ' + a.name);
    const idx = (await readIndex()).filter(x => x.id !== a.id);
    idx.push({ id: a.id, name: a.name, type: a.type, ext: a.ext, createdAt: a.createdAt });
    await writeIndex(idx);
    localStorage.setItem(LS.last, Date.now());
  }
  async function renameAudio(a) {
    if (!enabled()) return;
    const idx = await readIndex();
    const it = idx.find(x => x.id === a.id); if (!it) return;
    it.name = a.name; await writeIndex(idx);
  }
  async function deleteAudio(a) {
    if (!enabled()) return;
    const idx = await readIndex();
    const it = idx.find(x => x.id === a.id) || a;
    await deleteFile(audioPath(it), 'Borrar audio ' + (it.name || a.id));
    await writeIndex(idx.filter(x => x.id !== a.id));
  }

  // ---- Bajar todo: devuelve {plans, audios:[{id,name,type,ext,createdAt,blob?}], removedAudioIds}
  // `localAudios` son los que ya hay en el dispositivo (para no volver a bajarlos).
  async function pull(localAudios) {
    if (!enabled()) return null;
    if (pulling) return pulling;
    pulling = (async () => {
      const out = { plans: null, audios: [], removedAudioIds: [] };
      const pb = await getFile('plans.json');
      if (pb) { try { out.plans = JSON.parse(await pb.text()); } catch {} }
      const idx = await readIndex();
      const localIds = new Set(localAudios.map(a => a.id));
      for (const it of idx) {
        if (localIds.has(it.id)) { out.audios.push(it); continue; }
        const blob = await getFile(audioPath(it));
        if (blob) out.audios.push({ ...it, blob: new Blob([blob], { type: it.type || blob.type }) });
      }
      const remoteIds = new Set(idx.map(x => x.id));
      out.removedAudioIds = localAudios.filter(a => !remoteIds.has(a.id) && a.synced).map(a => a.id);
      localStorage.setItem(LS.last, Date.now());
      return out;
    })();
    try { return await pulling; } finally { pulling = null; }
  }

  async function check() {
    const r = await fetch(API + '/repos/' + repo(), { headers: { Authorization: 'Bearer ' + token(), Accept: 'application/vnd.github+json' } });
    if (r.status === 401) throw new Error('Clave no válida');
    if (r.status === 404) throw new Error('No encuentro el repositorio ' + repo() + ' con esa clave. ¿Existe y la clave tiene acceso a él?');
    if (!r.ok) throw new Error('GitHub ' + r.status);
    const d = await r.json();
    if (!d.permissions || !d.permissions.push) throw new Error('La clave solo puede leer: necesita "Contents: Read and write"');
    return d.full_name + (d.private ? ' (privado)' : ' (¡PÚBLICO! los audios se verían)');
  }

  return { token, setToken, repo, setRepo, enabled, lastSync, onChange, pushPlans, schedulePlans, pushAudio, renameAudio, deleteAudio, pull, check };
})();
