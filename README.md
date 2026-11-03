# Corre con música (PWA)

App web instalable en iPhone (Safari > Compartir > Añadir a pantalla de inicio).

- **Planes**: distancia, ritmo objetivo, lista de Spotify y audios que saltan por km o por minuto.
- **Audios**: sube notas de voz o grábalas en la app (se guardan en el propio móvil).
- **Correr**: GPS, ritmo actual/medio, diferencia con el objetivo, aviso por voz en cada km, modo simulación.
- **Spotify**: OAuth PKCE (sin servidor). Controla la app de Spotify del móvil y baja el volumen o pausa mientras suena un audio.
- **Strava** (de momento): exporta GPX desde el historial y súbelo a Strava. Subida automática en fase 2.

Es todo estático: se puede alojar en GitHub Pages, Netlify o similar. Requiere https.

## App nativa de iPhone (Capacitor)

La misma app web empaquetada como app de iOS, con GPS y audios en segundo plano.

En un Mac con Xcode instalado:

```bash
git clone https://github.com/pericardio/corre && cd corre
npm install
npm run ios        # construye www/, sincroniza y abre Xcode
```

En Xcode: selecciona el iPhone conectado por cable, en *Signing & Capabilities* elige tu equipo (Apple ID) y pulsa ▶︎ Run.
En el iPhone, la primera vez: Ajustes > General > VPN y gestión de dispositivos > confiar en el desarrollador.

Spotify: en el panel de desarrollador de Spotify hay que añadir también la Redirect URI `corre://spotify`.
