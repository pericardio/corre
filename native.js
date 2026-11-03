// Puente con la app nativa (Capacitor). En la web normal todo esto queda inactivo.
const Native = (() => {
  const cap = window.Capacitor;
  const isNative = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
  if (!isNative) return { isNative: false };

  const plugin = name => (cap.Plugins && cap.Plugins[name]) || (cap.registerPlugin ? cap.registerPlugin(name) : null);
  const BG = plugin('BackgroundGeolocation');
  const App = plugin('App');
  const Browser = plugin('Browser');

  // GPS en segundo plano: mismo contrato que navigator.geolocation.watchPosition.
  async function watchPosition(onPos, onErr) {
    try {
      return await BG.addWatcher({
        backgroundMessage: 'Midiendo tu carrera…',
        backgroundTitle: 'Corre',
        requestPermissions: true,
        stale: false,
        distanceFilter: 2,
      }, (loc, err) => {
        if (err) { onErr && onErr({ message: err.code === 'NOT_AUTHORIZED' ? 'sin permiso de ubicación (Ajustes > Corre > Ubicación: Siempre)' : (err.message || String(err)) }); return; }
        if (!loc) return;
        onPos({ coords: { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy == null ? 10 : loc.accuracy }, timestamp: loc.time || Date.now() });
      });
    } catch (e) { onErr && onErr({ message: e.message || String(e) }); return null; }
  }
  const clearWatch = id => { if (id) BG.removeWatcher({ id }).catch(() => {}); };
  const openSettings = () => BG.openSettings().catch(() => {});

  // OAuth de Spotify: navegador del sistema + vuelta por corre://spotify
  const SPOTIFY_REDIRECT = 'corre://spotify';
  const urlListeners = [];
  App.addListener('appUrlOpen', ev => { urlListeners.forEach(fn => fn(ev.url)); });
  const onUrl = fn => urlListeners.push(fn);
  const openExternal = url => Browser.open({ url });
  const closeBrowser = () => Browser.close().catch(() => {});
  const openUrl = url => { try { window.open(url, '_system'); } catch { location.href = url; } };

  return { isNative: true, watchPosition, clearWatch, openSettings, SPOTIFY_REDIRECT, onUrl, openExternal, closeBrowser, openUrl, App };
})();
