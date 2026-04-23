import { formatPrice } from '../utils/formatters.js'
import { alertModal } from '../utils/modals.js'

let suggestTimer = null
let activeSuggestIdx = -1

export function initParachoquesView() {
  const form    = document.getElementById('parachoques-form')
  const refEl   = document.getElementById('parachoques-ref')
  const cpEl    = document.getElementById('parachoques-cp')
  const suggest = document.getElementById('parachoques-suggest')

  if (!form) return

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    hideSuggest()
    await calcularYMostrar(refEl.value.trim(), cpEl.value.trim())
  })

  // Autocomplete referencia
  refEl.addEventListener('input', () => {
    const q = refEl.value.trim()
    activeSuggestIdx = -1
    if (suggestTimer) clearTimeout(suggestTimer)
    if (q.length < 2) { hideSuggest(); return }
    suggestTimer = setTimeout(() => fillSuggest(q), 150)
  })

  refEl.addEventListener('keydown', (e) => {
    const items = suggest.querySelectorAll('.suggest-item')
    if (!items.length || suggest.classList.contains('hidden')) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeSuggestIdx = Math.min(items.length - 1, activeSuggestIdx + 1)
      highlightSuggest(items)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeSuggestIdx = Math.max(0, activeSuggestIdx - 1)
      highlightSuggest(items)
    } else if (e.key === 'Enter' && activeSuggestIdx >= 0) {
      e.preventDefault()
      refEl.value = items[activeSuggestIdx].dataset.ref
      hideSuggest()
      cpEl.focus()
    } else if (e.key === 'Escape') {
      hideSuggest()
    }
  })

  document.addEventListener('click', (e) => {
    if (!suggest.contains(e.target) && e.target !== refEl) hideSuggest()
  })
}

export async function loadParachoquesView() {
  try {
    const count = await window.api.invoke('count-parachoques')
    const el = document.getElementById('parachoques-count')
    if (el) el.textContent = (count || 0).toLocaleString('es-ES')
  } catch (_) {}

  setTimeout(() => document.getElementById('parachoques-ref')?.focus(), 50)
}

function hideSuggest() {
  const suggest = document.getElementById('parachoques-suggest')
  if (suggest) {
    suggest.classList.add('hidden')
    suggest.innerHTML = ''
  }
  activeSuggestIdx = -1
}

function highlightSuggest(items) {
  items.forEach((el, i) => {
    el.style.background = i === activeSuggestIdx ? 'rgba(0,64,224,0.15)' : 'transparent'
  })
}

async function fillSuggest(query) {
  const suggest = document.getElementById('parachoques-suggest')
  if (!suggest) return
  try {
    const rows = await window.api.invoke('search-parachoques', { query, limit: 15 })
    if (!rows || rows.length === 0) { hideSuggest(); return }
    suggest.innerHTML = rows.map(r => `
      <div class="suggest-item" data-ref="${r.referencia}" style="padding:8px 12px;cursor:pointer;font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid rgba(196,197,217,0.08);">
        <span style="font-weight:600;">${r.referencia}</span>
        <span style="opacity:0.55;font-size:11px;">${r.largo_cm}×${r.ancho_cm}×${r.alto_cm} cm</span>
      </div>
    `).join('')
    suggest.classList.remove('hidden')
    suggest.querySelectorAll('.suggest-item').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = 'rgba(0,64,224,0.15)' })
      el.addEventListener('mouseleave', () => { el.style.background = 'transparent' })
      el.addEventListener('click', () => {
        document.getElementById('parachoques-ref').value = el.dataset.ref
        hideSuggest()
        document.getElementById('parachoques-cp')?.focus()
      })
    })
  } catch (_) { hideSuggest() }
}

async function calcularYMostrar(referencia, cpPrefix) {
  const resultsEl = document.getElementById('parachoques-results')
  const emptyEl   = document.getElementById('parachoques-empty')
  const infoEl    = document.getElementById('parachoques-info')
  const infoText  = document.getElementById('parachoques-info-text')

  if (!referencia || !/^\d{2}$/.test(cpPrefix)) {
    await alertModal('Introduce una referencia válida y un CP de 2 dígitos.', 'Datos incompletos')
    return
  }

  resultsEl.classList.add('hidden')
  resultsEl.innerHTML = '<div class="text-center py-8 text-on-surface-variant text-xs" style="opacity:0.6;"><span class="material-symbols-outlined animate-spin" style="font-size:28px;">progress_activity</span><p class="mt-2">Calculando...</p></div>'
  resultsEl.classList.remove('hidden')
  emptyEl.classList.add('hidden')
  infoEl.classList.add('hidden')

  try {
    const res = await window.api.invoke('calcular-parachoques', { referencia, cpPrefix })
    if (!res.ok) {
      resultsEl.innerHTML = `<div class="card-surface rounded-xl p-6 text-center">
        <span class="material-symbols-outlined text-3xl mb-2" style="color:#ba1a1a;">error</span>
        <p class="text-sm font-semibold">${res.error}</p>
      </div>`
      return
    }

    const { parachoque, resultados } = res
    infoText.textContent = `Referencia ${parachoque.referencia} — ${parachoque.largo_cm}×${parachoque.ancho_cm}×${parachoque.alto_cm} cm (con +5 aplicado)  ·  CP ${cpPrefix}`
    infoEl.classList.remove('hidden')

    renderResults(resultsEl, resultados)
  } catch (err) {
    resultsEl.innerHTML = `<div class="card-surface rounded-xl p-6 text-center">
      <span class="material-symbols-outlined text-3xl mb-2" style="color:#ba1a1a;">error</span>
      <p class="text-sm font-semibold">Error: ${err.message}</p>
    </div>`
  }
}

function renderResults(container, resultados) {
  if (!resultados || resultados.length === 0) {
    container.innerHTML = '<p class="text-sm text-on-surface-variant text-center py-8" style="opacity:0.6;">Sin agencias activas.</p>'
    return
  }

  const withPrice = resultados.filter(r => r.precioFinal != null)
  const mejor = withPrice[0]

  container.innerHTML = resultados.map((r, idx) => {
    const hasPrice = r.precioFinal != null
    const zonaName = r.zona?.nombre_zona || '—'
    const isBest = hasPrice && mejor && r.agencia.id === mejor.agencia.id && r.precioFinal === mejor.precioFinal
    return `
      <div class="card-surface rounded-xl p-4 flex items-center gap-4 ${isBest ? 'ring-2 ring-primary' : ''}" style="${isBest ? 'background:rgba(0,64,224,0.04);' : ''}">
        <div class="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center" style="background:rgba(0,64,224,0.1);">
          <span class="material-symbols-outlined text-primary" style="font-size:20px;">local_shipping</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="text-sm font-bold truncate">${r.agencia.nombre}</p>
            ${isBest ? '<span class="bg-primary text-white text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tight">Mejor precio</span>' : ''}
          </div>
          <p class="text-[11px] text-on-surface-variant mt-0.5" style="opacity:0.65;">
            Zona <strong>${zonaName}</strong>
            ${hasPrice ? ` · Peso tasable <strong>${r.peso} kg</strong> · ${r.metrosCubicos} m³` : ''}
            ${r.error ? ` · <span style="color:#ba1a1a;">${r.error}</span>` : ''}
          </p>
        </div>
        <div class="text-right">
          ${hasPrice
            ? `<p class="text-xl font-black text-primary">${formatPrice(r.precioFinal)}</p>
               <p class="text-[10px] text-on-surface-variant" style="opacity:0.55;">base ${formatPrice(r.precioBase)}</p>`
            : `<p class="text-xs font-semibold" style="color:#ba1a1a;opacity:0.7;">Sin tarifa</p>`
          }
        </div>
      </div>
    `
  }).join('')
}
