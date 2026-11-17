// Datos de señalización: formato, validación y borrador local.
export const CONFIG_URL = './config/senaletica.json';
const CLAVE_BORRADOR = 'chilquinta-estacionamiento-borrador-v1';

export const TIPOS = {
  atencion:        { nombre: 'Atención a clientes', color: '#168bff', icono: '🙋' },
  caja:            { nombre: 'Pagos / Caja',        color: '#12a37a', icono: '💳' },
  estacionamiento: { nombre: 'Estacionamiento',     color: '#6d5bd0', icono: '🅿️' },
  bano:            { nombre: 'Baños',               color: '#c2790a', icono: '🚻' },
  ascensor:        { nombre: 'Ascensor / Escalera', color: '#0f8fa8', icono: '↕' },
  salida:          { nombre: 'Salida',              color: '#d64550', icono: '🚪' },
  otro:            { nombre: 'Otro',                color: '#566a85', icono: '📍' }
};

export function nuevoId(prefijo = 'x') {
  return `${prefijo}_${Math.random().toString(36).slice(2, 8)}`;
}

export function configVacia() {
  return {
    version: 1,
    sitio: { nombre: 'Edificio Barón', subtitulo: 'Atención a clientes', urlAr: '' },
    modelo: './assets/baron/Baron%20Test.lcc2',
    pisoY: null,
    vistaInicial: null,
    puntos: [],
    rutas: [],
    carteles: [],
    anclajes: []
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const txt = (v, def) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : def);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const vec3 = (v) => (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? [v[0], v[1], v[2]] : null);
const color = (v, def) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : def);

// Acepta cualquier objeto y devuelve una configuración válida + avisos legibles.
export function normalizar(raw) {
  const avisos = [];
  const c = configVacia();
  if (!raw || typeof raw !== 'object') {
    avisos.push('El archivo no tiene el formato esperado; se usa una configuración vacía.');
    return { config: c, avisos };
  }
  if (raw.sitio && typeof raw.sitio === 'object') {
    c.sitio.nombre = txt(raw.sitio.nombre, c.sitio.nombre);
    c.sitio.subtitulo = txt(raw.sitio.subtitulo, c.sitio.subtitulo);
    c.sitio.urlAr = txt(raw.sitio.urlAr, '');
  }
  if (typeof raw.modelo === 'string' && raw.modelo.trim()) c.modelo = raw.modelo.trim();
  c.pisoY = num(raw.pisoY);
  if (raw.vistaInicial) {
    const pos = vec3(raw.vistaInicial.pos), mira = vec3(raw.vistaInicial.mira);
    if (pos && mira) c.vistaInicial = { pos, mira };
  }
  const usados = new Set();
  const id = (v, pref) => {
    let x = typeof v === 'string' && v ? v : nuevoId(pref);
    while (usados.has(x)) x = nuevoId(pref);
    usados.add(x);
    return x;
  };
  for (const p of arr(raw.puntos)) {
    const pos = vec3(p?.pos);
    if (!pos) { avisos.push('Se omitió un destino sin posición válida.'); continue; }
    c.puntos.push({ id: id(p.id, 'p'), nombre: txt(p.nombre, 'Destino'), tipo: TIPOS[p.tipo] ? p.tipo : 'otro', pos, descripcion: txt(p.descripcion, '') });
  }
  for (const r of arr(raw.rutas)) {
    const puntos = arr(r?.puntos).map(vec3).filter(Boolean);
    if (puntos.length < 2) { avisos.push('Se omitió una ruta con menos de 2 puntos.'); continue; }
    let destino = typeof r.destino === 'string' ? r.destino : null;
    if (destino && !c.puntos.some((p) => p.id === destino)) { avisos.push('Una ruta apuntaba a un destino que no existe; quedó sin destino.'); destino = null; }
    c.rutas.push({ id: id(r.id, 'r'), nombre: txt(r.nombre, 'Ruta'), desde: txt(r.desde, 'Entrada'), destino, color: color(r.color, '#168bff'), puntos });
  }
  for (const k of arr(raw.carteles)) {
    const pos = vec3(k?.pos);
    if (!pos) { avisos.push('Se omitió un cartel sin posición válida.'); continue; }
    const escala = typeof k.escala === 'number' && k.escala >= 0.3 && k.escala <= 3 ? k.escala : 1;
    c.carteles.push({ id: id(k.id, 'c'), texto: txt(k.texto, 'Cartel'), pos, escala });
  }
  for (const a of arr(raw.anclajes)) {
    const qr = vec3(a?.qr), pie = vec3(a?.pie);
    if (!qr || !pie) { avisos.push('Se omitió un anclaje QR sin posiciones válidas.'); continue; }
    if (Math.hypot(qr[0] - pie[0], qr[2] - pie[2]) < 0.3) { avisos.push('Se omitió un anclaje QR cuyo punto de escaneo coincide con el QR.'); continue; }
    c.anclajes.push({ id: id(a.id, 'a'), nombre: txt(a.nombre, 'QR'), qr, pie });
  }
  return { config: c, avisos };
}

export async function cargarConfig(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (r.status === 404) return { config: configVacia(), avisos: ['No existe config/senaletica.json; se parte con una configuración vacía.'], existe: false };
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return { ...normalizar(await r.json()), existe: true };
  } catch (e) {
    return { config: configVacia(), avisos: [`No se pudo leer ${url}: ${e.message}`], existe: false };
  }
}

export function serializar(config) {
  return JSON.stringify(config, (k, v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v), 2);
}

export function leerBorrador() {
  try { const t = localStorage.getItem(CLAVE_BORRADOR); return t ? JSON.parse(t) : null; } catch { return null; }
}
export function guardarBorrador(config) {
  try { localStorage.setItem(CLAVE_BORRADOR, serializar(config)); return true; } catch { return false; }
}
export function borrarBorrador() {
  try { localStorage.removeItem(CLAVE_BORRADOR); } catch { /* sin almacenamiento */ }
}
