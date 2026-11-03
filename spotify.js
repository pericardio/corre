// Spotify: OAuth con PKCE (sin servidor) + control del reproductor vía Web API.
// En iPhone el SDK de reproducción web no funciona, así que controlamos la app
// oficial de Spotify (Spotify Connect): play, pausa, volumen.
const Spotify = (() => {
  const SCOPES = 'user-read-private user-read-playback-state user-modify-playback-state playlist-read-private playlist-read-collaborative';
  const LS = { client: 'sp_client_id', tok: 'sp_token', ver: 'sp_verifier' };
  const redirectUri = () => location.origin + location.pathname;

  const DEFAULT_CLIENT_ID = '0b4e26b7d13148e7bc9b595558dbab37'; // app "Corre" de David (el Client ID no es secreto)
  const clientId = () => localStorage.getItem(LS.client) || DEFAULT_CLIENT_ID;
  const setClientId = id => localStorage.setItem(LS.client, id.trim());
  const token = () => { try { return JSON.parse(localStorage.getItem(LS.tok)); } catch { return null; } };
  const saveToken = t => {
    const prev = token() || {};
    localStorage.setItem(LS.tok, JSON.stringify({
      access_token: t.access_token,
      refresh_token: t.refresh_token || prev.refresh_token,
      expires_at: Date.now() + (t.expires_in - 60) * 1000,
    }));
  };
  const connected = () => !!(token() && token().refresh_token);
  const disconnect = () => localStorage.removeItem(LS.tok);

  const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = n => b64url(crypto.getRandomValues(new Uint8Array(n)));

  async function login() {
    if (!clientId()) throw new Error('Falta el Client ID de Spotify');
    const verifier = randomString(64);
    localStorage.setItem(LS.ver, verifier);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const p = new URLSearchParams({
      client_id: clientId(), response_type: 'code', redirect_uri: redirectUri(),
      code_challenge_method: 'S256', code_challenge: challenge, scope: SCOPES,
    });
    location.href = 'https://accounts.spotify.com/authorize?' + p;
  }

  // Llamar al cargar la página: si venimos de Spotify con ?code=, canjearlo.
  async function handleRedirect() {
    const q = new URLSearchParams(location.search);
    if (!q.get('code') && !q.get('error')) return false;
    history.replaceState(null, '', redirectUri());
    if (q.get('error')) throw new Error('Spotify: ' + q.get('error'));
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId(), grant_type: 'authorization_code', code: q.get('code'),
        redirect_uri: redirectUri(), code_verifier: localStorage.getItem(LS.ver) || '',
      }),
    });
    if (!r.ok) throw new Error('No se pudo conectar con Spotify (' + r.status + ')');
    saveToken(await r.json());
    return true;
  }

  async function accessToken() {
    const t = token();
    if (!t) throw new Error('Spotify no conectado');
    if (Date.now() < t.expires_at) return t.access_token;
    const r = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId(), grant_type: 'refresh_token', refresh_token: t.refresh_token }),
    });
    if (!r.ok) { disconnect(); throw new Error('Sesión de Spotify caducada: vuelve a conectar'); }
    let nt; try { nt = await r.json(); } catch { throw new Error('Spotify no devolvió un token válido; vuelve a conectar'); }
    saveToken(nt);
    return token().access_token;
  }

  async function api(path, opts = {}) {
    const r = await fetch('https://api.spotify.com/v1' + path, {
      ...opts, headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
    if (r.status === 204 || r.status === 202) return null;
    const body = await r.text();
    let data = null;
    try { data = body ? JSON.parse(body) : null; } catch { if (r.ok) return null; }
    if (!r.ok) {
      const err = new Error('Spotify: ' + ((data && data.error && data.error.message) || ('error ' + r.status + ' ' + body.slice(0, 60))));
      err.status = r.status; err.reason = data && data.error && data.error.reason;
      throw err;
    }
    return data;
  }

  const me = () => api('/me');
  async function playlists() {
    let out = [], url = '/me/playlists?limit=50';
    while (url && out.length < 200) {
      const d = await api(url);
      out = out.concat(d.items.filter(Boolean));
      url = d.next ? d.next.replace('https://api.spotify.com/v1', '') : null;
    }
    return out;
  }
  const state = () => api('/me/player');
  const devices = async () => (await api('/me/player/devices')).devices;

  const NO_DEVICE = 'Spotify no ve este móvil. Abre la app de Spotify, dale al play a cualquier canción, vuelve aquí y pulsa Empezar.';
  // Elige dónde sonar: el móvil (Smartphone) antes que altavoces o el ordenador.
  async function pickDevice() {
    const ds = await devices();
    if (!ds.length) return null;
    const phone = ds.find(d => d.type === 'Smartphone' && !d.is_restricted);
    const active = ds.find(d => d.is_active);
    return phone || active || ds.find(d => !d.is_restricted) || ds[0];
  }
  async function play(contextUri) {
    const body = contextUri ? JSON.stringify({ context_uri: contextUri }) : undefined;
    const d = await pickDevice();
    if (!d) throw new Error(NO_DEVICE);
    try { await api('/me/player/play?device_id=' + d.id, { method: 'PUT', body }); }
    catch (e) {
      if (e.status === 404) throw new Error(NO_DEVICE);
      throw e;
    }
    return d;
  }
  // Texto de estado para la pantalla de carrera.
  async function describe() {
    const ds = await devices();
    if (!ds.length) return { ok: false, text: 'Spotify: no veo ningún dispositivo. Abre Spotify en el móvil y dale al play.' };
    const active = ds.find(d => d.is_active);
    const phone = ds.find(d => d.type === 'Smartphone');
    let st = null; try { st = await state(); } catch {}
    if (active && active.type === 'Smartphone') return { ok: true, text: 'Spotify: ' + (st && st.is_playing ? 'sonando' : 'listo') + ' en ' + active.name };
    if (phone) return { ok: true, text: 'Spotify: activo en "' + (active ? active.name : '?') + '"; al empezar pasará a ' + phone.name };
    return { ok: false, text: 'Spotify: solo veo "' + ds.map(d => d.name).join('", "') + '". Abre Spotify en el móvil y dale al play.' };
  }
  const pause = () => api('/me/player/pause', { method: 'PUT' });
  const resume = () => api('/me/player/play', { method: 'PUT' });
  const setVolume = v => api('/me/player/volume?volume_percent=' + Math.round(v), { method: 'PUT' });

  // Baja o pausa la música mientras suena un audio. Devuelve una función para restaurar.
  async function duck(mode) {
    if (!connected()) return async () => {};
    let st;
    try { st = await state(); } catch { return async () => {}; }
    if (!st || !st.is_playing) return async () => {};
    const vol = st.device && st.device.volume_percent;
    const canVol = st.device && st.device.supports_volume !== false && vol != null;
    if (mode === 'volume' && canVol) {
      try {
        await setVolume(Math.max(5, vol * 0.25));
        return async () => { try { await setVolume(vol); } catch {} };
      } catch { /* el dispositivo no deja cambiar el volumen: pausamos */ }
    }
    try { await pause(); } catch { return async () => {}; }
    return async () => { try { await resume(); } catch {} };
  }

  return { redirectUri, clientId, setClientId, connected, disconnect, login, handleRedirect, me, playlists, play, pause, resume, duck, describe };
})();
