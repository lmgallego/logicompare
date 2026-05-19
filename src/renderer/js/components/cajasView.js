import { formatPrice } from '../utils/formatters.js'
import { alertModal, showFormModal } from '../utils/modals.js'

export function initCajasView() {
  const form = document.getElementById('cajas-form')
  const largoSel = document.getElementById('cajas-largo')

  if (!form) return

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const largo = parseInt(largoSel.value)
    const cp = document.getElementById('cajas-cp').value.trim()
    if (!largo || !/^\d{2}$/.test(cp)) {
      await alertModal('Selecciona un largo y escribe un CP de 2 dígitos.', 'Datos incompletos')
      return
    }
    await calcularCajas(largo, cp)
  })

  // Botón nueva caja
  document.getElementById('btn-add-caja')?.addEventListener('click', async () => {
    const result = await showFormModal({
      title: 'Nueva caja',
      subtitle: 'Introduce las medidas en centímetros.',
      submitLabel: 'Añadir caja',
      fields: [
        { name: 'largoCm', label: 'Largo (cm)', type: 'number', value: '', required: true, min: 1, step: '1', placeholder: '110' },
        { name: 'anchoCm', label: 'Ancho (cm)', type: 'number', value: '', required: true, min: 1, step: '1', placeholder: '35' },
        { name: 'altoCm',  label: 'Alto (cm)',  type: 'number', value: '', required: true, min: 1, step: '1', placeholder: '82' },
      ],
    })
    if (!result) return
    try {
      const res = await window.api.invoke('add-caja', {
        largoCm: parseInt(result.largoCm),
        anchoCm: parseInt(result.anchoCm),
        altoCm:  parseInt(result.altoCm),
      })
      if (!res.ok) {
        await alertModal(res.error, 'Error')
        return
      }
      await alertModal('Caja añadida correctamente.', 'Hecho')
      await loadCajasView()
    } catch (err) {
      await alertModal('Error: ' + err.message, 'Error')
    }
  })
}

function resetCajasForm() {
  const largoSel = document.getElementById('cajas-largo')
  const cpEl     = document.getElementById('cajas-cp')
  const results  = document.getElementById('cajas-results')
  const empty    = document.getElementById('cajas-empty')
  const info     = document.getElementById('cajas-info')
  if (largoSel) largoSel.value = ''
  if (cpEl) cpEl.value = ''
  if (results) { results.innerHTML = ''; results.classList.add('hidden') }
  if (empty) empty.classList.remove('hidden')
  if (info) { info.innerHTML = ''; info.classList.add('hidden') }
  setTimeout(() => largoSel?.focus(), 30)
}

export async function loadCajasView() {
  // Populate largo selector
  try {
    const largos = await window.api.invoke('get-cajas-largos')
    const sel = document.getElementById('cajas-largo')
    if (sel) {
      const currentVal = sel.value
      sel.innerHTML = '<option value="">— Selecciona largo —</option>'
      largos.forEach(l => {
        const opt = document.createElement('option')
        opt.value = l
        opt.textContent = l + ' cm'
        sel.appendChild(opt)
      })
      if (currentVal) sel.value = currentVal
    }
  } catch (_) {}

  // Update count
  try {
    const count = await window.api.invoke('count-cajas')
    const el = document.getElementById('cajas-count')
    if (el) el.textContent = (count || 0).toLocaleString('es-ES')
  } catch (_) {}

  setTimeout(() => document.getElementById('cajas-largo')?.focus(), 50)
}

async function calcularCajas(largo, cpPrefix) {
  const resultsEl = document.getElementById('cajas-results')
  const emptyEl   = document.getElementById('cajas-empty')
  const infoEl    = document.getElementById('cajas-info')

  resultsEl.classList.remove('hidden')
  resultsEl.innerHTML = '<div class="text-center py-8 text-on-surface-variant text-xs" style="opacity:0.6;"><span class="material-symbols-outlined animate-spin" style="font-size:28px;">progress_activity</span><p class="mt-2">Calculando...</p></div>'
  emptyEl.classList.add('hidden')
  infoEl.classList.add('hidden')

  try {
    // Get all cajas with this largo
    const cajas = await window.api.invoke('get-cajas-by-largo', { largo })
    if (!cajas || cajas.length === 0) {
      resultsEl.innerHTML = '<p class="text-sm text-on-surface-variant text-center py-8" style="opacity:0.6;">No hay cajas con largo ' + largo + ' cm.</p>'
      return
    }

    let allHtml = ''
    let provinciaNombre = null

    for (const caja of cajas) {
      const res = await window.api.invoke('calcular-caja', { cajaId: caja.id, cpPrefix })
      if (!res.ok) {
        allHtml += renderCajaError(caja, res.error)
        continue
      }
      if (res.provinciaNombre) provinciaNombre = res.provinciaNombre
      allHtml += renderCajaSection(caja, res.resultados)
    }

    resultsEl.innerHTML = allHtml

    // Show info with province
    const provText = provinciaNombre ? '  ·  <strong>' + provinciaNombre + '</strong>' : ''
    infoEl.innerHTML = '<div class="flex items-center gap-3 text-xs text-on-surface-variant" style="opacity:0.8;">'
      + '<span class="material-symbols-outlined text-primary" style="font-size:16px;">inventory_2</span>'
      + '<span>' + cajas.length + ' caja(s) con largo ' + largo + ' cm  ·  CP ' + cpPrefix + provText + '</span>'
      + '</div>'
    infoEl.classList.remove('hidden')

  } catch (err) {
    resultsEl.innerHTML = '<div class="card-surface rounded-xl p-6 text-center">'
      + '<span class="material-symbols-outlined text-3xl mb-2" style="color:#ba1a1a;">error</span>'
      + '<p class="text-sm font-semibold">Error: ' + err.message + '</p></div>'
  }
}

function renderCajaError(caja, error) {
  return '<div class="card-surface rounded-xl p-4">'
    + '<div class="flex items-center justify-between mb-3">'
    + '<p class="text-sm font-bold">' + caja.largo_cm + '×' + caja.ancho_cm + '×' + caja.alto_cm + ' cm</p>'
    + '</div>'
    + '<p class="text-xs" style="color:#ba1a1a;">' + error + '</p>'
    + '</div>'
}

function renderCajaSection(caja, resultados) {
  const dims = caja.largo_cm + '×' + caja.ancho_cm + '×' + caja.alto_cm
  const withPrice = resultados.filter(r => r.precioFinal != null && !r.advertencia)
  const mejor = withPrice[0]

  let header = '<div class="flex items-center gap-3 mb-3">'
    + '<div class="w-9 h-9 rounded-lg flex items-center justify-center" style="background:rgba(0,64,224,0.1);">'
    + '<span class="material-symbols-outlined text-primary" style="font-size:18px;">inventory_2</span>'
    + '</div>'
    + '<div>'
    + '<p class="text-sm font-bold">' + dims + ' cm</p>'
    + '<p class="text-[10px] text-on-surface-variant" style="opacity:0.55;">'
    + (withPrice.length > 0 ? 'Peso tasable ' + withPrice[0].peso + ' kg · ' + withPrice[0].metrosCubicos + ' m³' : 'Sin resultados')
    + '</p>'
    + '</div>'
    + '</div>'

  if (!resultados || resultados.length === 0) {
    return '<div class="card-surface rounded-xl p-4">' + header
      + '<p class="text-xs text-on-surface-variant text-center py-4" style="opacity:0.6;">Sin agencias disponibles.</p></div>'
  }

  const cards = resultados.map(r => {
    const hasPrice = r.precioFinal != null
    const zonaName = r.zona?.nombre_zona || '—'
    const isBest = hasPrice && mejor && r.agencia.id === mejor.agencia.id && r.precioFinal === mejor.precioFinal
    return '<div class="flex items-center gap-3 py-2 px-3 rounded-lg ' + (isBest ? 'ring-1 ring-primary' : '') + '" style="' + (isBest ? 'background:rgba(0,64,224,0.04);' : '') + '">'
      + '<div class="flex-1 min-w-0">'
      + '<div class="flex items-center gap-2">'
      + '<p class="text-xs font-bold truncate">' + r.agencia.nombre + '</p>'
      + (isBest ? '<span class="bg-primary text-white text-[8px] font-black px-1 py-0.5 rounded-full uppercase">Mejor</span>' : '')
      + '</div>'
      + '<p class="text-[10px] text-on-surface-variant" style="opacity:0.6;">Zona ' + zonaName
      + (r.error ? ' · <span style="color:#ba1a1a;">' + r.error + '</span>' : '')
      + (r.advertencia ? ' · <span style="color:#e65100;font-weight:600;">⚠ ' + r.advertencia + '</span>' : '')
      + '</p></div>'
      + '<div class="text-right">'
      + (hasPrice
        ? '<p class="text-base font-black text-primary">' + formatPrice(r.precioFinal) + '</p>'
          + '<p class="text-[9px] text-on-surface-variant" style="opacity:0.5;">base ' + formatPrice(r.precioBase) + '</p>'
        : '<p class="text-[10px] font-semibold" style="color:#ba1a1a;opacity:0.7;">Sin tarifa</p>')
      + '</div></div>'
  }).join('')

  return '<div class="card-surface rounded-xl p-4">' + header + '<div class="space-y-1">' + cards + '</div></div>'
}
