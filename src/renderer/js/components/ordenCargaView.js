import { formatPrice } from '../utils/formatters.js'

// Orden de carga: solo lectura. Lista de get-orden-carga para una fecha local, un camión y el camión
// al que va el sobrante; con "Solo caben N bultos" muestra las propuestas de proponer-paso.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const hoyLocal = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD en hora local
const precio = v => (v == null ? '—' : formatPrice(v))
const signo = v => (v > 0 ? '+' : '') + formatPrice(v)

// Pareja de camiones: cada uno es el destino por defecto del sobrante del otro
const PAREJA = [/transabadell/i, /dsv/i]

let seq = 0 // descarta respuestas de una petición anterior si el usuario cambia rápido
let filas = [], propuesta = null, opcionSel = 0

const el = id => document.getElementById(id)

export function initOrdenCargaView() {
  el('orden-fecha').value = hoyLocal()
  el('orden-fecha').addEventListener('change', cargarAgencias)
  el('orden-agencia').addEventListener('change', () => { destinoPorDefecto(); cargarLista() })
  el('orden-destino').addEventListener('change', cargarLista)
  el('orden-capacidad').addEventListener('input', proponer)
}

export function loadOrdenCargaView() {
  if (!el('orden-fecha').value) el('orden-fecha').value = hoyLocal()
  cargarAgencias()
}

function mostrar(html) { el('orden-resultado').innerHTML = html }
const mensaje = (texto, error = false) => mostrar(`<div class="rounded-xl px-4 py-6 text-center text-sm"
  style="${error ? 'color:#ba1a1a;background:rgba(186,26,26,0.06);border:1px solid rgba(186,26,26,0.2);' : 'opacity:0.6;'}">${esc(texto)}</div>`)

let activas = [] // "El sobrante va a" solo ofrece agencias activas

async function cargarAgencias() {
  const mio = ++seq
  const sel = el('orden-agencia')
  const previa = sel.value
  const [res, act] = await Promise.all([
    window.api.invoke('get-agencias-del-dia', { fecha: el('orden-fecha').value }),
    window.api.invoke('get-agencies-active'),
  ])
  if (mio !== seq) return
  activas = act
  if (!res.ok) { sel.innerHTML = ''; return mensaje(res.error, true) }
  // Inactivas (p. ej. Transhaer) salen si tienen cotizaciones ese día, para consultar el histórico
  sel.innerHTML = res.agencias.map(a => `<option value="${a.id}">${esc(a.nombre)}${a.activa ? '' : ' (inactiva)'}</option>`).join('')
  if (!res.agencias.length) { el('orden-destino').innerHTML = ''; return mensaje('No hay cotizaciones para esta agencia en esta fecha') }
  if (res.agencias.some(a => String(a.id) === previa)) sel.value = previa
  destinoPorDefecto()
  cargarLista()
}

function destinoPorDefecto() {
  const camion = Number(el('orden-agencia').value)
  const nombre = el('orden-agencia').selectedOptions[0]?.text || ''
  const opciones = activas.filter(a => a.id !== camion)
  const dest = el('orden-destino')
  dest.innerHTML = opciones.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')
  const i = PAREJA.findIndex(re => re.test(nombre))
  const otra = i >= 0 && opciones.find(a => PAREJA[1 - i].test(a.nombre))
  if (otra) dest.value = String(otra.id)
}

async function cargarLista() {
  const mio = ++seq
  filas = []; propuesta = null
  el('orden-propuesta').innerHTML = ''
  if (!el('orden-destino').value) return mensaje('No hay ninguna agencia activa a la que pasar el sobrante', true)
  mensaje('Calculando…')
  const res = await window.api.invoke('get-orden-carga', {
    fecha: el('orden-fecha').value,
    agenciaId: Number(el('orden-agencia').value),
    agenciaDestinoId: Number(el('orden-destino').value),
  })
  if (mio !== seq) return
  if (!res.ok) return mensaje(res.error, true)
  if (!res.filas.length) return mensaje('No hay cotizaciones para esta agencia en esta fecha')
  filas = res.filas
  pintar()
  proponer()
}

async function proponer() {
  const valor = el('orden-capacidad').value
  propuesta = null; opcionSel = 0
  if (!filas.length) return pintarPropuesta()
  if (valor === '') { pintar(); return pintarPropuesta() }
  const mio = seq
  const res = await window.api.invoke('proponer-paso', { filas, capacidadBultos: Number(valor) })
  if (mio !== seq || valor !== el('orden-capacidad').value) return
  if (!res.ok) { el('orden-propuesta').innerHTML = `<p class="text-xs" style="color:#ba1a1a;">${esc(res.error)}</p>`; return }
  propuesta = res.propuesta
  pintar(); pintarPropuesta()
}

function pintarPropuesta() {
  const caja = el('orden-propuesta')
  if (!propuesta) { caja.innerHTML = ''; return }
  const destino = esc(filas[0].agenciaDestino)
  const nota = t => `<p class="text-xs px-3 py-2 rounded-lg" style="color:#92400e;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);">${esc(t)}</p>`
  const recomendadas = propuesta.recomendadas.length
    ? `<p class="text-xs" style="color:#15803d;">Más barato con ${destino}, recomendable pasarlas aunque quepan: ${propuesta.recomendadas.map(id => '#' + id).join(', ')}</p>` : ''
  if (propuesta.sobran <= 0) { caja.innerHTML = `<p class="text-xs" style="opacity:0.7;">Cabe todo.</p>${recomendadas}`; return }
  const botones = propuesta.opciones.map((o, i) => `
    <button data-opcion="${i}" class="text-left text-xs px-3 py-2 rounded-lg" style="border:1px solid ${i === opcionSel ? '#0040e0' : 'rgba(196,197,217,0.4)'};background:${i === opcionSel ? 'rgba(0,64,224,0.08)' : '#fff'};">
      <div class="font-bold">Opción ${i + 1}: ${signo(o.sobrecoste)}</div>
      <div style="opacity:0.75;">Pasar ${o.ids.map(id => '#' + id).join(', ')} · ${o.bultos} bulto${o.bultos === 1 ? '' : 's'}</div>
    </button>`).join('')
  caja.innerHTML = `
    <p class="text-xs mb-2">Sobran <b>${propuesta.sobran}</b> bulto${propuesta.sobran === 1 ? '' : 's'}: pasar a ${destino}</p>
    <div class="flex flex-wrap gap-2 mb-2">${botones}</div>
    ${propuesta.avisos.map(nota).join('')}${recomendadas}`
  caja.querySelectorAll('[data-opcion]').forEach(b => b.addEventListener('click', () => {
    opcionSel = Number(b.dataset.opcion); pintar(); pintarPropuesta()
  }))
}

const CHIP = 'display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;padding:1px 6px;margin:1px 2px 1px 0;border-radius:9999px;font-size:9px;font-weight:700;'
const chip = (texto, estilo, titulo = texto) => `<span title="${esc(titulo)}" style="${CHIP}${estilo}">${esc(texto)}</span>`
const ESTILO_NEUTRO = 'background:rgba(196,197,217,0.25);color:#434656;'
const ESTILO_TARIFA = 'background:#f59e0b;color:#fff;'

// Avisos que ya se pintan en otra columna no se repiten como chip
const yaPintado = a => a.startsWith('No se puede pasar a ') || a.startsWith('Más barato con ')

function pintar() {
  const destino = esc(filas[0].agenciaDestino)
  const elegidas = new Set(propuesta?.opciones[opcionSel]?.ids || [])
  const totBultos = filas.reduce((s, f) => s + f.numBultos, 0)
  const th = (t, right) => `<th class="label-stencil px-2 py-2 ${right ? 'text-right' : 'text-left'}" style="font-size:9px;">${t}</th>`
  const td = (html, extra = '') => `<td class="px-2 py-1.5" style="vertical-align:top;${extra}">${html}</td>`
  const num = (html, extra = '') => td(html, 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;' + extra)

  const cuerpo = filas.map((f, i) => {
    const enDestino = f.alternativa
      ? precio(f.alternativa.precio)
      : chip('Cargar sí o sí', 'background:#ba1a1a;color:#fff;', f.avisos.find(a => a.startsWith('No se puede pasar a ')))
    const sobrecoste = f.sobrecoste == null ? '—'
      : f.sobrecoste < 0 ? `<div style="color:#15803d;font-weight:700;">${signo(f.sobrecoste)}</div><div style="color:#15803d;font-size:9px;white-space:normal;">Más barato con ${destino}</div>`
      : signo(f.sobrecoste)
    const avisos = f.avisos.filter(a => !yaPintado(a))
      .map(a => chip(a, a === 'Tarifa cambiada' ? ESTILO_TARIFA : ESTILO_NEUTRO)).join('')
    const marca = elegidas.has(f.id) ? 'background:rgba(0,64,224,0.08);box-shadow:inset 3px 0 #0040e0;' : ''
    return `<tr style="border-top:1px solid rgba(196,197,217,0.2);${marca}">
      ${num(`<b>${i + 1}</b>`)}${num(f.id)}
      ${td(esc(f.cliente || f.clienteCodigo || '—'))}${td(esc(f.destinatario || '—'))}
      ${td(esc(f.cp))}${td(esc(f.zona || '—'))}
      ${num(f.numBultos)}${num(precio(f.precioGuardado))}${num(enDestino)}${num(sobrecoste)}
      ${td(avisos, 'min-width:150px;')}
    </tr>`
  }).join('')

  mostrar(`
    <div class="flex flex-wrap gap-3 mb-3 text-xs">
      <div class="stat-card-neutral" style="padding:8px 14px;"><span class="label-stencil">Cotizaciones</span> <b>${filas.length}</b></div>
      <div class="stat-card-neutral" style="padding:8px 14px;"><span class="label-stencil">Bultos</span> <b>${totBultos}</b></div>
    </div>
    <div class="bg-surface-container-lowest rounded-xl" style="overflow-x:auto;border:1px solid rgba(196,197,217,0.12);">
      <table style="font-size:11px;min-width:820px;width:100%;">
        <thead><tr class="bg-surface-container-low">
          ${th('Pos', 1)}${th('Id', 1)}${th('Cliente')}${th('Destinatario')}${th('CP')}${th('Zona')}${th('Bultos', 1)}
          ${th('Precio guardado', 1)}${th('Precio en ' + destino, 1)}${th('Sobrecoste', 1)}${th('Avisos')}
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>
    </div>`)
}
