// Guía AR por QR: cámara + flechas del sitio sobre la realidad, alineadas en cada anclaje QR.
import * as THREE from '../engine/three/three.module.js';
import { normalizar, CONFIG_URL, TIPOS, leerBorrador } from './config.js';
import { crearFlechas, crearMarcador, pulsarFlechas, liberar } from './signage.js';
import {
  SeguidorGiroscopio, SeguidorManual, Alineacion,
  rutaRestante, recortarLongitud, mejorRuta, siguienteAncla, puntoA, rumboEntre, rumboDeCamara, anguloRelativo
} from './ar-core.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LOOKAHEAD = 40;        // metros de ruta que se dibujan por delante
const METROS_POR_MIN = 72;   // caminata tranquila
const K_AJUSTES = 'gemelo-ar-ajustes-v1', K_DESTINO = 'gemelo-ar-destino-v1';
const leer = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } };

const aj = Object.assign({ altura: 1.3, fov: 62 }, leer(K_AJUSTES) || {});
const estado = { config: null, ancla: null, destino: null, modo: 'inicio', guia: null, camara: false, sensor: 'ninguno' };

const video = $('video'), lienzo = $('lienzo');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas: lienzo, alpha: true, antialias: true }); renderer.setClearColor(0x000000, 0); }
catch (e) { console.error(e); $('msgInicio').textContent = 'Este navegador no permite gráficos 3D (WebGL).'; }
const escena = new THREE.Scene();
const camara = new THREE.PerspectiveCamera(50, 1, 0.05, 300);
const al = new Alineacion();
let seguidor = null, grupoGuia = null, rejilla = null, tiempo = 0, ultimoTexto = '';

/* ---------- Vista ---------- */
// aj.fov = ángulo de visión del lado largo del cuadro de la cámara; se adapta a la proporción y al recorte «cover».
function ajustarVista() {
  const w = Math.max(1, innerWidth), h = Math.max(1, innerHeight);
  if (renderer) { renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setSize(w, h, false); }
  const vw = video.videoWidth || 4, vh = video.videoHeight || 3;
  const largo = aj.fov * Math.PI / 180;
  const fovVideoV = vh >= vw ? largo : 2 * Math.atan(Math.tan(largo / 2) * vh / vw);
  const av = vw / vh, ac = w / h;
  const fovV = ac >= av ? 2 * Math.atan(Math.tan(fovVideoV / 2) * av / ac) : fovVideoV;
  camara.aspect = ac; camara.fov = fovV * 180 / Math.PI; camara.updateProjectionMatrix();
}
addEventListener('resize', ajustarVista);
addEventListener('orientationchange', () => setTimeout(ajustarVista, 250));
video.addEventListener('loadedmetadata', ajustarVista);

function pasarA(modo) { estado.modo = modo; document.body.dataset.modo = modo; }

/* ---------- Datos ---------- */
async function cargar() {
  try {
    let crudo = params.has('borrador') ? leerBorrador() : null; // prueba desde el editor, sin publicar
    if (!crudo) {
      const r = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      crudo = await r.json();
    }
    estado.config = normalizar(crudo).config;
  } catch (e) {
    $('msgInicio').textContent = `No se pudo cargar la configuración del sitio (${e.message}).`;
    return;
  }
  const c = estado.config;
  $('inSitio').textContent = c.sitio.nombre; $('inSub').textContent = params.has('borrador') ? 'Vista de prueba con el borrador del editor' : c.sitio.subtitulo;
  $('hSitio').textContent = c.sitio.nombre;
  const pedido = params.get('a');
  estado.ancla = c.anclajes.find((a) => a.id === pedido) || null;
  const caja = $('inAncla');
  if (estado.ancla) {
    caja.className = 'ok'; caja.textContent = `📍 Estás en: ${estado.ancla.nombre}`;
  } else if (c.anclajes.length) {
    caja.className = 'mal';
    caja.innerHTML = `${pedido ? 'No reconocí este QR.' : 'Falta indicar el QR.'} Elige dónde estás:<select id="selInicio"></select>`;
    const sel = $('selInicio');
    sel.innerHTML = c.anclajes.map((a) => `<option value="${a.id}">${a.nombre.replace(/</g, '&lt;')}</option>`).join('');
    sel.onchange = () => { estado.ancla = c.anclajes.find((a) => a.id === sel.value); revisarListo(); };
    estado.ancla = c.anclajes[0];
  } else {
    caja.className = 'mal'; caja.textContent = 'Este sitio todavía no tiene anclajes QR configurados.';
  }
  if (!isSecureContext) $('msgInicio').textContent = 'Para usar la cámara esta página debe abrirse por HTTPS.';
  revisarListo();
}
function revisarListo() { $('btnIniciar').disabled = !(estado.config && estado.ancla && renderer); }

/* ---------- Inicio: permisos, cámara y sensores ---------- */
async function iniciar() {
  $('btnIniciar').disabled = true; $('msgInicio').textContent = 'Solicitando permisos…';
  let permiso = 'granted';
  try { // iOS exige pedirlo dentro del toque del usuario
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') permiso = await DeviceOrientationEvent.requestPermission();
  } catch (e) { permiso = 'denied'; }
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('sin cámara');
    const flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = flujo; await video.play(); estado.camara = true;
  } catch (e) { estado.camara = false; console.warn('Cámara no disponible:', e); }
  const giro = new SeguidorGiroscopio();
  if (permiso !== 'denied') giro.iniciar();
  const hayGiro = permiso !== 'denied' && await giro.esperarPrimero(1500);
  seguidor = hayGiro ? giro : new SeguidorManual(lienzo);
  estado.sensor = seguidor.nombre;
  if (!estado.camara) {
    rejilla = new THREE.GridHelper(60, 60, 0x4a6a90, 0x22344f); rejilla.position.y = estado.ancla.pie[1]; escena.add(rejilla);
  }
  ajustarVista();
  $('hAncla').textContent = ` · ${estado.ancla.nombre}`;
  pasarA('alinear');
  const nota = [];
  if (!estado.camara) nota.push('Sin cámara: se muestra solo la guía.');
  if (!hayGiro) nota.push('Sin sensores de movimiento: arrastra el dedo para girar la vista.');
  if (nota.length) toast(nota.join(' '), 7000);
}

/* ---------- Alinear ---------- */
function alinear() {
  const a = estado.ancla;
  al.calibrar(seguidor.cuaternion(), a.pie, a.qr, aj.altura);
  if (rejilla) rejilla.position.y = a.pie[1];
  pasarA('guia');
  const recordado = leer(K_DESTINO);
  if (!estado.destino && recordado && Date.now() - recordado.t < 2 * 3600 * 1000) estado.destino = estado.config.puntos.find((p) => p.id === recordado.id) || null;
  const pedido = params.get('d');
  if (pedido) estado.destino = estado.config.puntos.find((p) => p.id === pedido) || estado.destino;
  renderDestinos(); reconstruirGuia();
}

/* ---------- Guía ---------- */
function elegirDestino(p) {
  estado.destino = estado.destino && estado.destino.id === p.id ? null : p;
  if (estado.destino) guardar(K_DESTINO, { id: p.id, t: Date.now() });
  renderDestinos(); reconstruirGuia();
}
function renderDestinos() {
  const cont = $('destinos'); cont.innerHTML = '';
  for (const p of estado.config.puntos) {
    const tipo = TIPOS[p.tipo] || TIPOS.otro;
    const b = document.createElement('button');
    b.className = `btn ${estado.destino && estado.destino.id === p.id ? 'activo' : ''}`;
    b.textContent = `${tipo.icono} ${p.nombre}`;
    b.onclick = () => elegirDestino(p);
    cont.appendChild(b);
  }
}
function reconstruirGuia() {
  if (grupoGuia) { escena.remove(grupoGuia); liberar(grupoGuia); grupoGuia = null; }
  estado.guia = null; ultimoTexto = '';
  const d = estado.destino;
  if (!d) { mostrarGuia('Elige a dónde quieres ir', 'Toca un destino abajo'); $('brujula').classList.add('oculto'); return; }
  grupoGuia = new THREE.Group(); escena.add(grupoGuia);
  grupoGuia.add(crearMarcador(d, { resaltado: true }));
  const ruta = mejorRuta(estado.config.rutas.filter((r) => r.destino === d.id), al.pie);
  if (!ruta) { mostrarGuia(`Hacia ${d.nombre}`, 'Este destino aún no tiene camino marcado'); $('brujula').classList.add('oculto'); return; }
  const rr = rutaRestante(ruta.puntos, al.pie);
  const vista = recortarLongitud(rr.puntos, LOOKAHEAD);
  if (vista.length >= 2) grupoGuia.add(crearFlechas({ id: 'ar', color: ruta.color, puntos: vista }, { pulso: true }));
  const sig = siguienteAncla(estado.config, ruta, rr.s, estado.ancla.id);
  const objetivo = rr.restante > 1 ? puntoA(rr.puntos, Math.min(4, rr.restante)) : d.pos;
  estado.guia = { ruta, restante: rr.restante, desvio: rr.desvio, sig, rumbo: rumboEntre(al.pie, objetivo) };
  $('brujula').classList.toggle('oculto', rr.restante <= 1);
}
function mostrarGuia(titulo, detalle) {
  const t = `${titulo}|${detalle}`;
  if (t === ultimoTexto) return;
  ultimoTexto = t;
  $('guiaTexto').innerHTML = `${titulo.replace(/</g, '&lt;')}<small>${detalle.replace(/</g, '&lt;')}</small>`;
}
function textoGuia(rel) {
  const g = estado.guia, d = estado.destino;
  if (!g) return;
  if (g.desvio > 8) return mostrarGuia(`Hacia ${d.nombre}`, `Este QR está a ${Math.round(g.desvio)} m del camino. Ve al QR de la entrada o elige otro punto en Ajustes.`);
  if (g.restante < 3) return mostrarGuia(`¡Llegaste a ${d.nombre}!`, 'Está justo aquí');
  const min = Math.max(1, Math.round(g.restante / METROS_POR_MIN));
  const dir = Math.abs(rel) < 0.35 ? 'Sigue de frente' : rel > 0 ? 'Gira a la izquierda' : 'Gira a la derecha';
  const sig = g.sig ? `Próximo QR: ${g.sig.ancla.nombre} (a ${Math.round(g.sig.metros)} m)` : (g.restante > 25 ? 'Sigue las flechas hasta el destino' : 'Ya casi llegas');
  mostrarGuia(`${dir} · ${d.nombre}`, `${Math.round(g.restante)} m · ${min} min a pie · ${sig}`);
}

/* ---------- Ciclo de dibujo ---------- */
const pose = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
let anterior = performance.now();
function ciclo(ahora) {
  requestAnimationFrame(ciclo);
  const dt = Math.min(0.1, (ahora - anterior) / 1000); anterior = ahora; tiempo += dt;
  if (!seguidor || !renderer) return;
  al.altura = aj.altura;
  if (al.listo && estado.modo === 'guia') al.camara(seguidor.cuaternion(), pose);
  else { pose.quat.copy(seguidor.cuaternion()); pose.pos.set(estado.ancla.pie[0], estado.ancla.pie[1] + aj.altura, estado.ancla.pie[2]); }
  camara.position.copy(pose.pos); camara.quaternion.copy(pose.quat);
  if (grupoGuia) grupoGuia.visible = estado.modo === 'guia';
  if (grupoGuia) for (const h of grupoGuia.children) if (h.userData.tipo === 'ruta') pulsarFlechas(h, tiempo);
  if (estado.modo === 'guia' && estado.guia) {
    const rel = anguloRelativo(estado.guia.rumbo, rumboDeCamara(pose.quat));
    $('brujula').firstElementChild.style.transform = `rotate(${(-rel * 180 / Math.PI).toFixed(1)}deg)`;
    textoGuia(rel);
  }
  renderer.render(escena, camara);
}

/* ---------- Ajustes y avisos ---------- */
let temporizadorAviso = 0;
function toast(msg, ms = 4000) {
  let el = $('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.style.cssText = 'position:fixed;z-index:9;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 64px);margin:auto;max-width:520px;padding:10px 14px;border-radius:12px;background:rgba(11,22,38,.94);border:1px solid #25395a;text-align:center'; document.body.appendChild(el); }
  el.textContent = msg; el.style.display = 'block';
  clearTimeout(temporizadorAviso); temporizadorAviso = setTimeout(() => { el.style.display = 'none'; }, ms);
}
function pintarAjustes() {
  $('rAltura').value = aj.altura; $('vAltura').textContent = Number(aj.altura).toFixed(2);
  $('rFov').value = aj.fov; $('vFov').textContent = aj.fov;
  $('selAncla').innerHTML = estado.config.anclajes.map((a) => `<option value="${a.id}" ${estado.ancla && a.id === estado.ancla.id ? 'selected' : ''}>${a.nombre.replace(/</g, '&lt;')}</option>`).join('');
}
$('btnIniciar').onclick = iniciar;
$('btnAlinear').onclick = alinear;
$('btnRealinear').onclick = () => { pasarA('alinear'); };
$('btnAjustes').onclick = () => { if (!estado.config) return; pintarAjustes(); $('ajustes').classList.toggle('oculto'); };
$('btnCerrarAjustes').onclick = () => $('ajustes').classList.add('oculto');
$('rAltura').oninput = (e) => { aj.altura = Number(e.target.value); $('vAltura').textContent = aj.altura.toFixed(2); guardar(K_AJUSTES, aj); };
$('rFov').oninput = (e) => { aj.fov = Number(e.target.value); $('vFov').textContent = aj.fov; guardar(K_AJUSTES, aj); ajustarVista(); };
$('btnIzq').onclick = () => { al.ajuste -= 2 * Math.PI / 180; };
$('btnDer').onclick = () => { al.ajuste += 2 * Math.PI / 180; };
$('selAncla').onchange = (e) => {
  estado.ancla = estado.config.anclajes.find((a) => a.id === e.target.value) || estado.ancla;
  $('hAncla').textContent = ` · ${estado.ancla.nombre}`; $('ajustes').classList.add('oculto'); pasarA('alinear');
};

window.AR = { estado, camara, al, escena, get seguidor() { return seguidor; }, aj };
requestAnimationFrame(ciclo);
cargar();
