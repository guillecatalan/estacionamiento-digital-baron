// Núcleo del AR por QR: matemática sin DOM (probable en Node) + seguidores de orientación.
//
// Convención de rumbo (la misma que usan las flechas de ruta): a = atan2(dx, dz).
// Girar la cámara hacia la IZQUIERDA aumenta a (en este sistema +X queda a la izquierda al mirar hacia +Z).
import * as THREE from '../engine/three/three.module.js';
import { longitudRuta } from './signage.js';

const DEG = Math.PI / 180;
const EJE_Y = new THREE.Vector3(0, 1, 0);
const EJE_Z = new THREE.Vector3(0, 0, 1);
const Q_ATRAS = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5)); // la cámara mira por la parte trasera

/* ---------- Rutas (plano XZ) ---------- */

// Punto de la polilínea más cercano a `pos`: { s: metros desde el inicio, dist, idx, punto }.
export function proyectarEnRuta(puntos, pos) {
  if (!Array.isArray(puntos) || puntos.length < 2) return null;
  let mejor = null, acum = 0;
  for (let i = 0; i < puntos.length - 1; i++) {
    const [ax, ay, az] = puntos[i], [bx, by, bz] = puntos[i + 1];
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, l = Math.sqrt(l2);
    let t = l2 > 1e-12 ? ((pos[0] - ax) * dx + (pos[2] - az) * dz) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, pz = az + dz * t, dist = Math.hypot(pos[0] - px, pos[2] - pz);
    if (!mejor || dist < mejor.dist - 1e-9) mejor = { s: acum + l * t, dist, idx: i, punto: [px, ay + (by - ay) * t, pz] };
    acum += l;
  }
  return mejor;
}

// Tramo de la ruta que queda por delante de `pos`.
export function rutaRestante(puntos, pos) {
  const pr = proyectarEnRuta(puntos, pos);
  if (!pr) return null;
  const resto = [pr.punto, ...puntos.slice(pr.idx + 1)];
  if (resto.length > 1 && Math.hypot(resto[0][0] - resto[1][0], resto[0][2] - resto[1][2]) < 1e-6) resto.shift();
  if (resto.length < 2) resto.push(resto[0].slice());
  return { puntos: resto, restante: longitudRuta(resto), desvio: pr.dist, s: pr.s };
}

// Primeros `max` metros de una polilínea.
export function recortarLongitud(puntos, max) {
  const salida = [puntos[0]];
  let acum = 0;
  for (let i = 0; i < puntos.length - 1; i++) {
    const a = puntos[i], b = puntos[i + 1], l = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (l > 1e-9 && acum + l >= max) {
      const t = (max - acum) / l;
      salida.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      return salida;
    }
    salida.push(b); acum += l;
  }
  return salida;
}

// De varias rutas al mismo destino, la que pasa más cerca de `pos`.
export function mejorRuta(rutas, pos) {
  let mejor = null, d = Infinity;
  for (const r of rutas) {
    const pr = proyectarEnRuta(r.puntos, pos);
    if (pr && pr.dist < d) { d = pr.dist; mejor = r; }
  }
  return mejor;
}

// Próximo QR sobre la ruta, más adelante que `s0` (metros recorridos), distinto del actual.
export function siguienteAncla(config, ruta, s0, actualId, maxDesvio = 6) {
  let mejor = null;
  for (const a of config.anclajes || []) {
    if (a.id === actualId) continue;
    const pr = proyectarEnRuta(ruta.puntos, a.pie);
    if (!pr || pr.dist > maxDesvio) continue;
    const metros = pr.s - s0;
    if (metros > 2 && (!mejor || metros < mejor.metros)) mejor = { ancla: a, metros };
  }
  return mejor;
}

// Punto situado a `m` metros del inicio de la polilínea.
export function puntoA(puntos, m) {
  const r = recortarLongitud(puntos, m);
  return r[r.length - 1];
}

export const rumboEntre = (desde, hacia) => Math.atan2(hacia[0] - desde[0], hacia[2] - desde[2]);
export function anguloRelativo(objetivo, actual) {
  let d = objetivo - actual;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/* ---------- Orientación del dispositivo ---------- */

// Misma fórmula que DeviceOrientationControls de three.js (ángulos en grados).
export function cuaternionDispositivo(alpha, beta, gamma, orient = 0, salida = new THREE.Quaternion()) {
  salida.setFromEuler(new THREE.Euler(beta * DEG, alpha * DEG, -gamma * DEG, 'YXZ'));
  salida.multiply(Q_ATRAS);
  salida.multiply(new THREE.Quaternion().setFromAxisAngle(EJE_Z, -orient * DEG));
  return salida;
}

// Rumbo horizontal hacia donde mira la cámara. Si mira casi vertical usa la parte superior de la imagen.
export function rumboDeCamara(q) {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  if (Math.hypot(f.x, f.z) > 0.25) return Math.atan2(f.x, f.z);
  const u = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  return f.y < 0 ? Math.atan2(u.x, u.z) : Math.atan2(-u.x, -u.z);
}

/* ---------- Alineación orientación → modelo ---------- */
// Al escanear el QR la persona está en `pie` mirando hacia `qr`: con eso se fija dónde está
// y hacia dónde mira la cámara en el modelo. Desde ahí solo se sigue la ROTACIÓN del dispositivo.
export class Alineacion {
  constructor() { this.listo = false; this.delta = 0; this.ajuste = 0; this.pie = [0, 0, 0]; this.altura = 1.3; this.rumboQr = 0; }
  calibrar(qDispositivo, pie, qr, altura = this.altura) {
    this.rumboQr = rumboEntre(pie, qr);
    this.delta = this.rumboQr - rumboDeCamara(qDispositivo);
    this.pie = pie.slice(); this.altura = altura; this.ajuste = 0; this.listo = true;
  }
  camara(qDispositivo, salida = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() }) {
    salida.quat.setFromAxisAngle(EJE_Y, this.delta + this.ajuste).multiply(qDispositivo);
    salida.pos.set(this.pie[0], this.pie[1] + this.altura, this.pie[2]);
    return salida;
  }
}

/* ---------- Seguidores (misma interfaz: cuaternion()) ---------- */
// Para cambiar a seguimiento SLAM (WebXR en Android, ARKit en una app, etc.) basta otra clase con
// cuaternion() y, si entrega posición, ampliar Alineacion.camara(). El resto de la aplicación no cambia.

export function orientacionPantalla() {
  if (typeof screen !== 'undefined' && screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return (typeof window !== 'undefined' && typeof window.orientation === 'number') ? window.orientation : 0;
}

export class SeguidorGiroscopio {
  constructor() { this.nombre = 'giroscopio'; this.q = new THREE.Quaternion(); this.listo = false; this.eventos = 0; this._h = null; this._espera = []; }
  iniciar() {
    this._h = (e) => {
      if (e.alpha == null || e.beta == null || e.gamma == null) return;
      cuaternionDispositivo(e.alpha, e.beta, e.gamma, orientacionPantalla(), this.q);
      this.eventos++;
      if (!this.listo) { this.listo = true; this._espera.splice(0).forEach((f) => f(true)); }
    };
    window.addEventListener('deviceorientation', this._h, true);
  }
  esperarPrimero(ms) {
    if (this.listo) return Promise.resolve(true);
    return new Promise((res) => { this._espera.push(res); setTimeout(() => res(this.listo), ms); });
  }
  cuaternion() { return this.q; }
  detener() { if (this._h) window.removeEventListener('deviceorientation', this._h, true); this._h = null; }
}

// Respaldo cuando no hay sensores (equipos de escritorio o permiso denegado): se arrastra para mirar.
export class SeguidorManual {
  constructor(elemento) {
    this.nombre = 'manual'; this.yaw = 0; this.pitch = 0; this.q = new THREE.Quaternion(); this.listo = true;
    let activo = null;
    elemento.addEventListener('pointerdown', (e) => { activo = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointerup', () => { activo = null; });
    window.addEventListener('pointermove', (e) => {
      if (!activo) return;
      this.yaw += (e.clientX - activo.x) * 0.005;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + (e.clientY - activo.y) * 0.005));
      activo = { x: e.clientX, y: e.clientY };
    });
  }
  cuaternion() {
    const qy = new THREE.Quaternion().setFromAxisAngle(EJE_Y, this.yaw);
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -this.pitch);
    return this.q.copy(qy).multiply(qx);
  }
}
