import { formatPrice, formatWeight, formatVolume } from '../utils/formatters.js'
import { getSelectedAgenciaIds } from './agenciasView.js'
import { confirmModal } from '../utils/modals.js'

let sortedAsc = true
let sortAbortController = null
let lastFormDatos = null
let lastResultados = []
let agenciaElegida = false

// Extra package rows (beyond the first)
let extraBultos = []

// Keyboard shortcuts: key letter → fragment of agency name to match (lowercase)
// Order matters: more specific fragments first
const AGENCY_SHORTCUTS = {
  g: 'gls',
  s: 'seur',
  t: 'transabadell',
  p: 'palet',
  b: 'bulto',
  l: 'log',   // Logística
}
// Ordered list for display lookup (specific before generic)
const SHORTCUT_DISPLAY_LIST = [
  { fragment: 'gls',        key: 'Ctrl+G' },
  { fragment: 'seur',       key: 'Ctrl+S' },
  { fragment: 'transabadell', key: 'Ctrl+T' },
  { fragment: 'palet',      key: 'Ctrl+P' },
  { fragment: 'bulto',      key: 'Ctrl+B' },
  { fragment: 'log',        key: 'Ctrl+L' },
]

function getShortcutForAgency(nombre) {
  if (!nombre) return null
  const lower = nombre.toLowerCase()
  for (const { fragment, key } of SHORTCUT_DISPLAY_LIST) {
    if (lower.includes(fragment)) return key
  }
  return null
}

function getBultosFromForm() {
  const largo0 = parseFloat(document.getElementById('input-largo').value) || 0
  const ancho0 = parseFloat(document.getElementById('input-ancho').value) || 0
  const alto0  = parseFloat(document.getElementById('input-alto').value)  || 0
  const bultos = [{ largoCm: largo0, anchoCm: ancho0, altoCm: alto0 }]
  document.querySelectorAll('.extra-bulto-row').forEach(row => {
    const largo = parseFloat(row.querySelector('.eb-largo').value) || 0
    const ancho = parseFloat(row.querySelector('.eb-ancho').value) || 0
    const alto  = parseFloat(row.querySelector('.eb-alto').value)  || 0
    bultos.push({ largoCm: largo, anchoCm: ancho, altoCm: alto })
  })
  return bultos
}

function updateBultoBadge() {
  const count = 1 + document.querySelectorAll('.extra-bulto-row').length
  const badge = document.getElementById('bultos-badge')
  if (!badge) return
  if (count > 1) {
    badge.textContent = `${count} bultos`
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }
}

function addExtraBultoRow() {
  const container = document.getElementById('extra-bultos-container')
  if (!container) return

  const row = document.createElement('div')
  row.className = 'extra-bulto-row flex items-end gap-2 mt-2 animate-fade-in'
  row.innerHTML = `
    <div class="flex-1 grid grid-cols-3 gap-2">
      <div class="space-y-1">
        <label class="label-stencil block text-[9px]">Largo (cm)</label>
        <input class="input-field eb-largo" type="number" min="1" step="0.1" placeholder="0" />
      </div>
      <div class="space-y-1">
        <label class="label-stencil block text-[9px]">Ancho (cm)</label>
        <input class="input-field eb-ancho" type="number" min="1" step="0.1" placeholder="0" />
      </div>
      <div class="space-y-1">
        <label class="label-stencil block text-[9px]">Alto (cm)</label>
        <input class="input-field eb-alto" type="number" min="1" step="0.1" placeholder="0" />
      </div>
    </div>
    <button type="button" class="remove-bulto-btn flex items-center justify-center w-7 h-7 rounded text-red-500 hover:bg-red-50 transition-colors shrink-0 mb-0.5" title="Eliminar bulto">
      <span class="material-symbols-outlined" style="font-size:16px;">close</span>
    </button>
  `
  row.querySelector('.remove-bulto-btn').addEventListener('click', () => {
    row.remove()
    updateBultoBadge()
  })
  container.appendChild(row)
  updateBultoBadge()
  // Focus first input of new row
  row.querySelector('.eb-largo')?.focus()
}

export function getLastFormDatos() { return lastFormDatos ? { ...lastFormDatos, lastResultados } : null }
export function wasAgenciaElegida() { return agenciaElegida }

export function initFormHandler() {
  const form = document.getElementById('quote-form')
  const cpInput = document.getElementById('input-cp')
  const cpInfo = document.getElementById('cp-info')

  if (!form || !cpInput) return

  // Ctrl+M — add extra bulto row
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'm') {
      const activePage = document.querySelector('.page.active')
      if (activePage && activePage.id === 'page-new-quote') {
        e.preventDefault()
        addExtraBultoRow()
      }
    }
  })

  // Agency shortcuts: Ctrl+G/S/T/P/B/L → click Elegir on matching card
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    const key = e.key.toLowerCase()
    if (!AGENCY_SHORTCUTS[key]) return
    const activePage = document.querySelector('.page.active')
    if (!activePage || activePage.id !== 'page-new-quote') return
    e.preventDefault()
    const fragment = AGENCY_SHORTCUTS[key]
    // Find the Elegir button on a visible card whose agency name matches
    const cards = document.querySelectorAll('#results-list .carrier-card')
    for (const card of cards) {
      const nameEl = card.querySelector('h3')
      if (!nameEl) continue
      if (nameEl.textContent.toLowerCase().includes(fragment)) {
        const btn = card.querySelector('[data-agency-id]')
        if (btn && !btn.disabled) btn.click()
        break
      }
    }
  })

  cpInput.addEventListener('input', async () => {
    const val = cpInput.value.trim()
    if (val.length === 2 && window.api) {
      const prov = await window.api.invoke('get-provincia-by-prefix', val)
      if (prov) {
        cpInfo.textContent = `📍 ${prov.nombre}`
        cpInfo.className = 'text-xs text-primary px-1 font-medium'
      } else {
        cpInfo.textContent = '⚠ Código postal no reconocido'
        cpInfo.className = 'text-xs text-yellow-600 px-1 font-medium'
      }
      cpInfo.classList.remove('hidden')
    } else {
      cpInfo.classList.add('hidden')
    }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = document.getElementById('btn-calculate')
    btn.disabled = true
    btn.innerHTML = '<span class="material-symbols-outlined animate-spin" style="font-size:16px;">progress_activity</span> Calculando...'

    showLoading()

    const bultos = getBultosFromForm()
    const primero = bultos[0]

    agenciaElegida = false
    lastFormDatos = {
      largoCm: primero.largoCm,
      anchoCm: primero.anchoCm,
      altoCm:  primero.altoCm,
      cpPrefix: document.getElementById('input-cp').value.trim(),
      agenciaIds: getSelectedAgenciaIds(),
      bultos,
    }
    const datos = lastFormDatos

    try {
      const resultados = await window.api.invoke('calcular-tarifas', datos)
      renderResults(resultados)
    } catch (err) {
      showError(err.message || 'Error desconocido en el cálculo.')
    } finally {
      btn.disabled = false
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">calculate</span> Calcular y Comparar Precios'
    }
  })
}

function showLoading() {
  document.getElementById('results-empty').classList.add('hidden')
  document.getElementById('results-loading').classList.remove('hidden')
  document.getElementById('results-list').classList.add('hidden')
  document.getElementById('results-stats').classList.add('hidden')
  document.getElementById('quotes-badge').classList.add('hidden')
}

function showError(msg) {
  document.getElementById('results-loading').classList.add('hidden')
  document.getElementById('results-list').classList.add('hidden')
  document.getElementById('results-stats').classList.add('hidden')
  const empty = document.getElementById('results-empty')
  empty.classList.remove('hidden')
  empty.innerHTML = `
    <span class="material-symbols-outlined text-5xl text-red-400 mb-3" style="opacity:0.7;">error</span>
    <p class="text-sm font-medium text-red-600">${msg}</p>
  `
}

function renderResults(resultados) {
  lastResultados = resultados
  document.getElementById('results-loading').classList.add('hidden')
  document.getElementById('results-empty').classList.add('hidden')

  const list = document.getElementById('results-list')
  list.innerHTML = ''

  const validos = resultados.filter(r => r.precioFinal !== null)
  const badge = document.getElementById('quotes-badge')
  if (validos.length > 0) {
    badge.textContent = `${validos.length} cotizacion${validos.length !== 1 ? 'es' : ''}`
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }

  const m3El = document.getElementById('resultado-metros-cubicos')
  if (m3El && resultados.length > 0) {
    const m3 = resultados[0].metrosCubicos ?? 0
    m3El.textContent = formatVolume(m3)
    m3El.closest('#metros-cubicos-row')?.classList.remove('hidden')
  }

  if (resultados.length === 0) {
    list.innerHTML = `<div class="text-center py-16 text-on-surface-variant text-sm" style="opacity:0.5;">
      No hay agencias activas configuradas. <a class="text-primary font-medium cursor-pointer underline" data-nav="database">Configura una agencia</a>.
    </div>`
    list.classList.remove('hidden')
    return
  }

  if (sortAbortController) sortAbortController.abort()
  sortAbortController = new AbortController()
  document.getElementById('btn-sort-price').addEventListener('click', () => {
    sortedAsc = !sortedAsc
    renderCarrierCards(resultados, list, sortedAsc)
  }, { signal: sortAbortController.signal })

  renderCarrierCards(resultados, list, sortedAsc)

  list.classList.remove('hidden')

  if (validos.length > 0) {
    const cheapest = validos.reduce((a, b) => a.precioFinal <= b.precioFinal ? a : b)
    renderStats(validos, cheapest)
  }
}

function renderCarrierCards(resultados, container, sortedAsc) {
  const sorted = [...resultados].sort((a, b) => {
    if (a.precioFinal === null) return 1
    if (b.precioFinal === null) return -1
    return sortedAsc
      ? a.precioFinal - b.precioFinal
      : b.precioFinal - a.precioFinal
  })

  container.innerHTML = ''
  const validos = sorted.filter(r => r.precioFinal !== null)
  const bestPrice = validos.length > 0 ? validos[0].precioFinal : null

  sorted.forEach((r) => {
    const isBest = r.precioFinal !== null && r.precioFinal === bestPrice && sortedAsc

    const logoHtml = r.agencia.logo_path
      ? `<img src="file://${r.agencia.logo_path}" class="w-full h-full object-contain mix-blend-multiply" alt="${r.agencia.nombre}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><span class="material-symbols-outlined text-on-surface-variant hidden items-center justify-center" style="font-size:24px; opacity:0.4;">local_shipping</span>`
      : `<span class="material-symbols-outlined text-on-surface-variant flex items-center justify-center w-full h-full" style="font-size:24px; opacity:0.4;">local_shipping</span>`

    const desgloseHtml = ''

    const card = document.createElement('div')
    card.className = `carrier-card ${isBest ? 'best-carrier' : ''}`
    if (isBest) {
      card.style.borderColor = 'rgba(0, 64, 224, 0.35)'
    }

    // GLS largo > 110 warning (use maxLargoCm from multi-bulto result)
    const maxLargo = r.maxLargoCm ?? (lastFormDatos?.largoCm ?? 0)
    const maxSumaDim = r.maxSumaDimCm ?? ((lastFormDatos?.largoCm ?? 0) + (lastFormDatos?.anchoCm ?? 0) + (lastFormDatos?.altoCm ?? 0))
    const agenciaNombreLower = r.agencia.nombre?.toLowerCase() || ''
    const glsOversize = agenciaNombreLower.includes('gls') && maxLargo > 110

    // Seur: mercancía fuera de norma si largo > 175 o largo+ancho+alto > 300
    const seurLargoFuera = maxLargo > 175
    const seurSumaFuera  = maxSumaDim > 300
    const seurFueraNorma = agenciaNombreLower.includes('seur') && (seurLargoFuera || seurSumaFuera)

    let oversizeHtml = ''
    if (glsOversize) {
      oversizeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tight" style="background:rgba(186,26,26,0.1); color:#ba1a1a;"><span class="material-symbols-outlined" style="font-size:10px;">warning</span>Largo &gt;110cm — No elegible GLS</span>`
    } else if (seurFueraNorma) {
      const motivos = []
      if (seurLargoFuera) motivos.push(`largo ${maxLargo}cm &gt; 175`)
      if (seurSumaFuera)  motivos.push(`L+A+H ${maxSumaDim}cm &gt; 300`)
      oversizeHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tight" style="background:rgba(186,26,26,0.1); color:#ba1a1a;" title="${motivos.join(' · ').replace(/&gt;/g, '>')}"><span class="material-symbols-outlined" style="font-size:10px;">warning</span>Mercancía fuera de norma</span>`
    }

    const shortcut = getShortcutForAgency(r.agencia.nombre)
    const shortcutHtml = shortcut
      ? `<kbd class="px-1 py-0.5 rounded text-[9px] font-bold" style="background:rgba(196,197,217,0.25);color:inherit;">${shortcut}</kbd>`
      : ''

    if (r.precioFinal !== null) {
      card.innerHTML = `
        <div class="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <div class="w-14 h-14 bg-surface-container rounded-lg flex items-center justify-center p-2 overflow-hidden shrink-0">
              ${logoHtml}
            </div>
            <div>
              <div class="flex items-center gap-2 flex-wrap">
                <h3 class="font-bold text-base">${r.agencia.nombre}</h3>
                ${isBest ? `<span class="bg-primary/10 text-primary text-[9px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tight">Mejor precio</span>` : ''}
                ${oversizeHtml}
                ${shortcutHtml}
              </div>
              <p class="text-xs text-on-surface-variant mt-0.5" style="opacity:0.65;">Zona: ${r.zona?.nombre_zona || '—'} &nbsp;·&nbsp; <span class="font-semibold" style="opacity:1;">${formatVolume(r.metrosCubicos ?? 0)}</span>${r.numeroBultos > 1 ? ` &nbsp;·&nbsp; <span class="font-semibold text-primary" style="opacity:0.85;">${r.numeroBultos} bultos</span>` : ''}</p>
              <p class="text-xl font-black text-primary mt-1 tracking-tight">${r.peso ?? 0} kg &nbsp;|&nbsp; ${formatPrice(r.precioFinal)}</p>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1.5 shrink-0">
            <button class="btn-primary px-5 py-1.5 text-xs font-bold" data-agency-id="${r.agencia.id}">
              Elegir
            </button>
          </div>
        </div>
        ${desgloseHtml}
      `
    } else {
      card.innerHTML = `
        <div class="flex items-center gap-4">
          <div class="w-14 h-14 bg-surface-container rounded-lg flex items-center justify-center p-2 overflow-hidden shrink-0">
            ${logoHtml}
          </div>
          <div>
            <h3 class="font-bold text-base text-on-surface-variant" style="opacity:0.7;">${r.agencia.nombre}</h3>
            <p class="text-xs mt-0.5" style="color: #ba1a1a; opacity:0.8;">
              <span class="material-symbols-outlined align-middle" style="font-size:14px;">warning</span>
              ${r.error || 'Sin cobertura'}
            </p>
          </div>
        </div>
      `
      card.style.opacity = '0.6'
    }

    container.appendChild(card)

    // Wire Elegir button to save quote
    if (r.precioFinal !== null) {
      const elegirBtn = card.querySelector('[data-agency-id]')
      elegirBtn?.addEventListener('click', async () => {
        if (glsOversize) {
          const ok = await confirmModal(
            'GLS no admite largos superiores a 110 cm.\nEsta expedición puede ser rechazada.\n\n¿Deseas elegir GLS de todas formas?',
            '⚠️ Largo fuera de norma GLS'
          )
          if (!ok) return
        }
        if (seurFueraNorma) {
          const motivos = []
          if (seurLargoFuera) motivos.push(`• Largo ${maxLargo} cm (máx. 175)`)
          if (seurSumaFuera)  motivos.push(`• Suma L+A+H ${maxSumaDim} cm (máx. 300)`)
          const ok = await confirmModal(
            'Seur no admite esta mercancía por:\n' + motivos.join('\n') +
            '\n\nEsta expedición puede ser rechazada. ¿Elegir Seur de todas formas?',
            '⚠️ Mercancía fuera de norma Seur'
          )
          if (!ok) return
        }
        agenciaElegida = true
        elegirBtn.disabled = true
        elegirBtn.textContent = '✓ Elegido'
        elegirBtn.classList.remove('btn-primary')
        elegirBtn.classList.add('btn-secondary')
        if (window.api && lastFormDatos) {
          await window.api.invoke('save-quote', {
            largoCm: lastFormDatos.largoCm,
            anchoCm: lastFormDatos.anchoCm,
            altoCm: lastFormDatos.altoCm,
            cpPrefix: lastFormDatos.cpPrefix,
            metrosCubicos: r.metrosCubicos,
            peso: r.peso,
            agenciaId: r.agencia.id,
            precioFinal: r.precioFinal,
            bultos: lastFormDatos.bultos,
          })
        }
      })
    }
  })
}

function renderStats(validos, bestResult) {
  const stats = document.getElementById('results-stats')
  const avgPrice = validos.reduce((s, r) => s + r.precioFinal, 0) / validos.length

  document.getElementById('stat-best-price').textContent = formatPrice(bestResult.precioFinal)
  document.getElementById('stat-best-agency').textContent = bestResult.agencia.nombre
  document.getElementById('stat-avg-price').textContent = formatPrice(avgPrice)
  document.getElementById('stat-agencies-count').textContent = validos.length

  stats.classList.remove('hidden')
}
