// Copia los ficheros de la app web a www/ (lo que Capacitor empaqueta en la app nativa).
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
for (const f of ['index.html', 'styles.css', 'app.js', 'spotify.js', 'sync.js', 'native.js', 'manifest.webmanifest']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });
// Sin service worker dentro de la app nativa.
console.log('www/ listo');
