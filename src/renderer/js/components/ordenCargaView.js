import { formatPrice, formatVolume } from '../utils/formatters.js'

// Orden de carga: solo lectura. Lista de get-orden-carga para una fecha local y una agencia.
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const hoyLocal = () => new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD en hora local
const precio = v => (v == null ? '—' : formatPrice(v))
const m3 = v => formatVolume(v).replace(' m³', '')
const signo = v => (v > 0 ? '+' : '') + formatPrice(v)

let seq = 0 // descarta respuestas de una petición anterior si el usuario cambia rápido

const el = id => document.getElementById(id)

export function initOrdenCargaView() {
  el('orden-fecha').value = hoyLocal()
  el('orden-fecha').addEventListener('change', cargarAgencias)
  el('orden-agencia').addEventListener('change', cargarLista)
}

export function loadOrdenCargaView() {
  if (!el('orden-fecha').value) el('orden-fecha').value = hoyLocal()
  cargarAgencias()
}

function mostrar(html) { el('orden-resultado').innerHTML = html }
const mensaje = (texto, error = false) => mostrar(`<div class="rounded-xl px-4 py-6 text-center text-sm"
  style="${error ? 'color:#ba1a1a;background:rgba(186,26,26,0.06);border:1px solid rgba(186,26,26,0.2);' : 'opacity:0.6;'}">${esc(texto)}</div>`)

async function cargarAgencias() {
  const mio = ++seq
  const sel = el('orden-agencia')
  const previa = sel.value
  const res = await window.api.invoke('get-agencias-del-dia', { fecha: el('orden-fecha').value })
  if (mio !== seq) return
  if (!res.ok) { sel.innerHTML = ''; return mensaje(res.error, true) }
  sel.innerHTML = res.agencias.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('')
  if (!res.agencias.length) return mensaje('No hay cotizaciones para esta agencia en esta fecha')
  if (res.agencias.some(a => String(a.id) === previa)) sel.value = previa
  cargarLista()
}

async function cargarLista() {
  const mio = ++seq
  mensaje('Calculando…')
  const res = await window.api.invoke('get-orden-carga', { fecha: el('orden-fecha').value, agenciaId: Number(el('orden-agencia').value) })
  if (mio !== seq) return
  if (!res.ok) return mensaje(res.error, true)
  if (!res.filas.length) return mensaje('No hay cotizaciones para esta agencia en esta fecha')
  pintar(res.filas)
}

const CHIP = 'display:inline-block;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle;padding:1px 6px;margin:1px 2px 1px 0;border-radius:9999px;font-size:9px;font-weight:700;'
const chip = (texto, estilo) => `<span title="${esc(texto)}" style="${CHIP}${estilo}">${esc(texto)}</span>`
const ESTILO_NEUTRO = 'background:rgba(196,197,217,0.25);color:#434656;'
const ESTILO_TARIFA = 'background:#f59e0b;color:#fff;'

// Avisos que ya se pintan en otra columna no se repiten como chip
const yaPintado = a => a === 'Sin alternativa: cargar sí o sí' || a.startsWith('Más barato con ')

function pintar(filas) {
  const totM3 = filas.reduce((s, f) => s + f.m3, 0)
  const totBultos = filas.reduce((s, f) => s + f.numBultos, 0)
  const th = (t, right) => `<th class="label-stencil px-2 py-2 ${right ? 'text-right' : 'text-left'}" style="font-size:9px;">${t}</th>`
  const td = (html, extra = '') => `<td class="px-2 py-1.5" style="vertical-align:top;${extra}">${html}</td>`
  const num = (html, extra = '') => td(html, 'text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;' + extra)

  const cuerpo = filas.map((f, i) => {
    const alt = f.alternativa
      ? `${esc(f.alternativa.agencia)} <span style="white-space:nowrap;">${precio(f.alternativa.precio)}</span>`
      : chip('Cargar sí o sí', 'background:#ba1a1a;color:#fff;')
    const barato = f.sobrecoste != null && f.sobrecoste < 0
    const sobrecoste = f.sobrecoste == null ? '—'
      : barato ? `<div style="color:#15803d;font-weight:700;">${signo(f.sobrecoste)}</div><div style="color:#15803d;font-size:9px;white-space:normal;">Más barato con ${esc(f.alternativa.agencia)}</div>`
      : signo(f.sobrecoste)
    const avisos = f.avisos.filter(a => !yaPintado(a))
      .map(a => chip(a, a === 'Tarifa cambiada' ? ESTILO_TARIFA : ESTILO_NEUTRO)).join('')
    return `<tr style="border-top:1px solid rgba(196,197,217,0.2);">
      ${num(`<b>${i + 1}</b>`)}${num(f.id)}
      ${td(esc(f.cliente || f.clienteCodigo || '—'))}${td(esc(f.destinatario || '—'))}
      ${td(esc(f.cp))}${td(esc(f.zona || '—'))}
      ${num(f.numBultos)}${num(m3(f.m3))}
      ${num(precio(f.precioGuardado))}${num(precio(f.precioRecalculado), f.avisos.includes('Tarifa cambiada') ? 'background:rgba(245,158,11,0.15);font-weight:700;' : '')}
      ${td(alt)}${num(sobrecoste)}${num(f.sobrecostePorM3 == null ? '—' : formatPrice(f.sobrecostePorM3))}
      ${td(avisos, 'min-width:150px;')}
    </tr>`
  }).join('')

  mostrar(`
    <div class="flex flex-wrap gap-3 mb-3 text-xs">
      <div class="stat-card-neutral" style="padding:8px 14px;"><span class="label-stencil">Cotizaciones</span> <b>${filas.length}</b></div>
      <div class="stat-card-neutral" style="padding:8px 14px;"><span class="label-stencil">Bultos</span> <b>${totBultos}</b></div>
      <div class="stat-card-neutral" style="padding:8px 14px;"><span class="label-stencil">m³</span> <b>${m3(Math.round(totM3 * 1000) / 1000)}</b></div>
    </div>
    <div class="bg-surface-container-lowest rounded-xl" style="overflow-x:auto;border:1px solid rgba(196,197,217,0.12);">
      <table style="font-size:11px;min-width:900px;width:100%;">
        <thead><tr class="bg-surface-container-low">
          ${th('Pos', 1)}${th('Id', 1)}${th('Cliente')}${th('Destinatario')}${th('CP')}${th('Zona')}${th('Bultos', 1)}${th('m³', 1)}
          ${th('Precio guardado', 1)}${th('Precio recalculado', 1)}${th('Alternativa')}${th('Sobrecoste', 1)}${th('Sobrecoste/m³', 1)}${th('Avisos')}
        </tr></thead>
        <tbody>${cuerpo}</tbody>
      </table>
    </div>`)
}
