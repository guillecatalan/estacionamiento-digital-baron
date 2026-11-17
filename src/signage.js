// Objetos 3D de señalización: flechas de ruta, marcadores de destino y carteles.
import * as THREE from '../engine/three/three.module.js';
import { TIPOS } from './config.js';

export const ALTURA_OJOS = 1.6;
const ALTURA_ETIQUETA = 1.7;
const ORDEN = 1000; // se dibujan después del modelo

/* ---------- Lógica pura (sin DOM) ---------- */

export function longitudRuta(pts) {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][2] - pts[i][2]);
  return total;
}

// Posiciones y giro de las flechas a lo largo de la ruta, con separación constante también en las esquinas.
export function colocacionesFlechas(pts, separacion = 1.6) {
  const salida = [];
  if (!Array.isArray(pts) || pts.length < 2) return salida;
  let acumulado = 0;
  let proxima = separacion / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, largo = Math.hypot(dx, dz);
    if (largo < 1e-6) continue;
    const ang = Math.atan2(dx, dz);
    while (proxima <= acumulado + largo + 1e-9) {
      const t = (proxima - acumulado) / largo;
      salida.push({ x: ax + dx * t, y: ay + (by - ay) * t, z: az + dz * t, ang, s: proxima });
      proxima += separacion;
    }
    acumulado += largo;
  }
  if (!salida.length && acumulado > 0.3) {
    const [ax, ay, az] = pts[0], [bx, by, bz] = pts[pts.length - 1];
    salida.push({ x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2, ang: Math.atan2(bx - ax, bz - az), s: acumulado / 2 });
  }
  return salida;
}

export function prepararTrayecto(puntos, altura = ALTURA_OJOS) {
  const pts = puntos.map((p) => new THREE.Vector3(p[0], p[1] + altura, p[2]));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  return { pts, cum, total: cum[cum.length - 1] };
}

export function posicionEn(tr, s, salida = new THREE.Vector3()) {
  const { pts, cum, total } = tr;
  if (s <= 0) return salida.copy(pts[0]);
  if (s >= total) return salida.copy(pts[pts.length - 1]);
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / Math.max(1e-9, cum[i] - cum[i - 1]);
  return salida.lerpVectors(pts[i - 1], pts[i], t);
}

export function destinoCercano(config, punto, radio = 8) {
  let mejor = null, d2 = radio * radio;
  for (const p of config.puntos) {
    const d = (p.pos[0] - punto[0]) ** 2 + (p.pos[2] - punto[2]) ** 2;
    if (d <= d2) { d2 = d; mejor = p; }
  }
  return mejor;
}

/* ---------- Geometrías compartidas ---------- */

let _flecha = null, _anillo = null, _vertice = null;
function geoFlecha() {
  if (_flecha) return _flecha;
  const s = new THREE.Shape();
  // Chevron que apunta a +Z una vez tumbado sobre el piso.
  s.moveTo(0, -0.6); s.lineTo(0.5, 0); s.lineTo(0.5, 0.28); s.lineTo(0, -0.22); s.lineTo(-0.5, 0.28); s.lineTo(-0.5, 0); s.closePath();
  _flecha = new THREE.ShapeGeometry(s);
  _flecha.rotateX(-Math.PI / 2);
  _flecha.userData.compartida = true;
  return _flecha;
}
function geoAnillo() {
  if (_anillo) return _anillo;
  _anillo = new THREE.RingGeometry(0.22, 0.4, 40).rotateX(-Math.PI / 2);
  _anillo.userData.compartida = true;
  return _anillo;
}
function geoVertice() {
  if (_vertice) return _vertice;
  _vertice = new THREE.RingGeometry(0.12, 0.2, 24).rotateX(-Math.PI / 2);
  _vertice.userData.compartida = true;
  return _vertice;
}
const matPlano = (color, opacidad = 0.95) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacidad, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

/* ---------- Etiquetas (sprites con tamaño constante en pantalla) ---------- */

function dibujarEtiqueta({ texto, icono = '', color, claro = false }) {
  const W = 640, H = 190;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const caja = (x, y, w, h, r) => {
    g.beginPath(); g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  };
  const relleno = claro ? '#ffffff' : color;
  caja(8, 8, W - 16, 132, 38);
  g.fillStyle = relleno; g.fill();
  g.lineWidth = 6; g.strokeStyle = claro ? color : '#ffffff'; g.stroke();
  g.beginPath(); g.moveTo(W / 2 - 26, 136); g.lineTo(W / 2, 182); g.lineTo(W / 2 + 26, 136); g.closePath();
  g.fillStyle = relleno; g.fill();
  g.textBaseline = 'middle'; g.textAlign = 'left';
  let x0 = 40;
  if (icono) {
    g.font = '64px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    g.fillStyle = '#ffffff'; g.fillText(icono, 34, 78);
    x0 = 122;
  }
  const maxAncho = W - x0 - 36;
  let tam = 58;
  const fuente = () => { g.font = `700 ${tam}px "Segoe UI", system-ui, sans-serif`; };
  fuente();
  while (g.measureText(texto).width > maxAncho && tam > 26) { tam -= 2; fuente(); }
  let t = texto;
  if (g.measureText(t).width > maxAncho) {
    while (t.length > 1 && g.measureText(`${t}…`).width > maxAncho) t = t.slice(0, -1);
    t += '…';
  }
  g.fillStyle = claro ? '#0b1626' : '#ffffff';
  g.fillText(t, x0, 78);
  return c;
}

function crearSprite(canvas, alto) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false });
  const sp = new THREE.Sprite(mat);
  sp.center.set(0.5, 0.06); // la punta del puntero queda en la posición
  sp.scale.set(alto * (canvas.width / canvas.height), alto, 1);
  sp.renderOrder = ORDEN + 2;
  return sp;
}

/* ---------- Objetos de la escena ---------- */

export function crearMarcador(p, { resaltado = false } = {}) {
  const tipo = TIPOS[p.tipo] || TIPOS.otro;
  const g = new THREE.Group();
  g.position.set(p.pos[0], p.pos[1], p.pos[2]);
  g.userData = { tipo: 'punto', id: p.id };
  const anillo = new THREE.Mesh(geoAnillo(), matPlano(tipo.color, 0.9));
  anillo.position.y = 0.03; anillo.renderOrder = ORDEN;
  g.add(anillo);
  const linea = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(0, ALTURA_ETIQUETA, 0)]),
    new THREE.LineBasicMaterial({ color: tipo.color, transparent: true, opacity: 0.85, depthTest: false })
  );
  linea.raycast = () => {}; linea.renderOrder = ORDEN;
  g.add(linea);
  const sprite = crearSprite(dibujarEtiqueta({ texto: p.nombre, icono: tipo.icono, color: tipo.color }), resaltado ? 0.105 : 0.075);
  sprite.position.y = ALTURA_ETIQUETA;
  g.add(sprite);
  return g;
}

export function crearCartel(c) {
  const g = new THREE.Group();
  g.position.set(c.pos[0], c.pos[1], c.pos[2]);
  g.userData = { tipo: 'cartel', id: c.id };
  g.add(crearSprite(dibujarEtiqueta({ texto: c.texto, color: '#168bff', claro: true }), 0.06 * (c.escala || 1)));
  return g;
}

export function crearFlechas(ruta, { pulso = true, seleccionada = false } = {}) {
  const g = new THREE.Group();
  g.userData = { tipo: 'ruta', id: ruta.id, pulso, flechas: [] };
  for (const f of colocacionesFlechas(ruta.puntos, 1.6)) {
    const m = new THREE.Mesh(geoFlecha(), matPlano(ruta.color));
    m.position.set(f.x, f.y + 0.03, f.z);
    m.rotation.y = f.ang;
    m.scale.setScalar(seleccionada ? 0.95 : 0.8);
    m.renderOrder = ORDEN + 1;
    g.add(m);
    g.userData.flechas.push({ m, s: f.s });
  }
  return g;
}

// Anclaje QR (solo editor): cartel con el QR en `qr`, círculo en `pie` (donde se para quien escanea) y flecha hacia el QR.
function texturaQr() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#111111';
  const buscador = (x, y) => { g.fillRect(x, y, 40, 40); g.fillStyle = '#ffffff'; g.fillRect(x + 6, y + 6, 28, 28); g.fillStyle = '#111111'; g.fillRect(x + 13, y + 13, 14, 14); };
  buscador(8, 8); buscador(80, 8); buscador(8, 80);
  for (let i = 0; i < 26; i++) g.fillRect(56 + ((i * 37) % 6) * 10, 56 + ((i * 53) % 6) * 10, 8, 8);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function crearAncla(a, { seleccionada = false } = {}) {
  const COLOR = '#ffb020';
  const g = new THREE.Group();
  g.userData = { tipo: 'ancla', id: a.id };
  const ang = Math.atan2(a.qr[0] - a.pie[0], a.qr[2] - a.pie[2]);
  const cartel = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ map: texturaQr(), side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
  cartel.position.set(a.qr[0], a.qr[1] + 1.3, a.qr[2]);
  cartel.rotation.y = ang + Math.PI; // la cara con el QR mira hacia quien escanea
  cartel.renderOrder = ORDEN + 1;
  g.add(cartel);
  const poste = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a.qr[0], a.qr[1], a.qr[2]), new THREE.Vector3(a.qr[0], a.qr[1] + 1.1, a.qr[2])]),
    new THREE.LineBasicMaterial({ color: COLOR, transparent: true, opacity: 0.85, depthTest: false }));
  poste.raycast = () => {}; poste.renderOrder = ORDEN;
  g.add(poste);
  const anillo = new THREE.Mesh(geoAnillo(), matPlano(COLOR, 0.9));
  anillo.position.set(a.pie[0], a.pie[1] + 0.03, a.pie[2]); anillo.renderOrder = ORDEN;
  g.add(anillo);
  const flecha = new THREE.Mesh(geoFlecha(), matPlano(COLOR, 0.95));
  flecha.position.set(a.pie[0] + Math.sin(ang) * 0.9, a.pie[1] + 0.035, a.pie[2] + Math.cos(ang) * 0.9);
  flecha.rotation.y = ang; flecha.scale.setScalar(seleccionada ? 0.7 : 0.5); flecha.renderOrder = ORDEN + 1;
  g.add(flecha);
  const sprite = crearSprite(dibujarEtiqueta({ texto: a.nombre, icono: '▣', color: COLOR }), seleccionada ? 0.095 : 0.065);
  sprite.position.set(a.pie[0], a.pie[1] + ALTURA_ETIQUETA, a.pie[2]);
  g.add(sprite);
  return g;
}

export function crearVertice(pos, color = '#ffffff') {
  const m = new THREE.Mesh(geoVertice(), matPlano(color, 1));
  m.position.set(pos[0], pos[1] + 0.04, pos[2]);
  m.renderOrder = ORDEN + 1;
  m.userData = { tipo: 'aux' };
  return m;
}

// Onda de opacidad que viaja en el sentido de la ruta.
export function pulsarFlechas(grupo, t) {
  if (!grupo.userData.pulso) return;
  for (const { m, s } of grupo.userData.flechas) m.material.opacity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 3.2 - s * 1.2));
}

export function liberar(obj) {
  obj.traverse((o) => {
    if (o.geometry && !o.geometry.userData?.compartida) o.geometry.dispose();
    if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
  });
}
