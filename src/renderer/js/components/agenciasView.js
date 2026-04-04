import { formatPrice } from '../utils/formatters.js'

let allAgencias = []
let selectedIds = new Set()

export async function initAgenciasView() {
  if (!window.api) return

  try {
    const agencies = await window.api.invoke('get-agencies-simple')
    allAgencias = agencies
  } catch (_) {}

  renderSelector()
}

export function loadAgenciasView() {
  renderSelector()
}

function renderSelector() {
  const container = document.getElementById('agencias-selector-list')
  if (!container) return

  if (!allAgencias.length) {
    container.innerHTML = `<p class="text-xs text-on-surface-variant py-4 text-center" style="opacity:0.5;">No hay agencias configuradas.</p>`
    return
  }

  container.innerHTML = allAgencias.map(a => {
    const active = selectedIds.has(a.id)
    return `
      <button
        class="agencia-chip flex items-center gap-2.5 px-4 py-2.5 rounded-xl border transition-all text-sm font-semibold ${active ? 'bg-primary text-white border-primary shadow-sm' : 'bg-surface-container border-outline-variant text-on-surface hover:border-primary hover:text-primary'}"
        data-agency-id="${a.id}"
      >
        <span class="material-symbols-outlined text-base" style="${active ? '' : 'opacity:0.5;'}">local_shipping</span>
        ${a.nombre}
      </button>
    `
  }).join('')

  container.querySelectorAll('.agencia-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.agencyId)
      if (selectedIds.has(id)) {
        selectedIds.delete(id)
      } else {
        selectedIds.add(id)
      }
      renderSelector()
      renderComparison()
    })
  })

  renderComparison()
}

async function renderComparison() {
  const tableContainer = document.getElementById('agencias-comparison-table')
  if (!tableContainer) return

  if (selectedIds.size === 0) {
    tableContainer.innerHTML = `
      <div class="flex flex-col items-center justify-center py-16 text-on-surface-variant text-center">
        <span class="material-symbols-outlined text-5xl mb-3" style="opacity:0.2;">table_chart</span>
        <p class="text-sm" style="opacity:0.5;">Selecciona una o más agencias para comparar sus tarifas</p>
      </div>
    `
    return
  }

  tableContainer.innerHTML = `<div class="text-xs text-on-surface-variant text-center py-6" style="opacity:0.4;">Cargando tarifas...</div>`

  let data
  try {
    data = await window.api.invoke('get-agencies-tariff-comparison', Array.from(selectedIds))
  } catch (err) {
    tableContainer.innerHTML = `<p class="text-red-500 text-sm p-4">Error: ${err.message}</p>`
    return
  }

  const { agencias, bandas, preciosIdx } = data

  if (!bandas.length) {
    tableContainer.innerHTML = `<p class="text-xs text-on-surface-variant text-center py-8" style="opacity:0.5;">No hay tarifas registradas para las agencias seleccionadas.</p>`
    return
  }

  // Build header
  const headerCells = agencias.map(a =>
    `<th class="px-4 py-3 text-right text-xs font-bold uppercase tracking-wider whitespace-nowrap" style="background:#0040e0;color:white;">${a.nombre}</th>`
  ).join('')

  // Build rows
  const rows = bandas.map((banda, idx) => {
    const bg = idx % 2 === 0 ? '' : 'style="background:rgba(0,0,0,0.02)"'
    const weightLabel = formatWeightBand(banda.kilos_desde, banda.kilos_hasta)

    const priceCells = agencias.map(a => {
      const entry = preciosIdx[a.id]?.[banda.kilos_desde]
      if (!entry) {
        return `<td class="px-4 py-2.5 text-right text-xs text-on-surface-variant" style="opacity:0.25;">—</td>`
      }

      const esTonelada = entry.es_por_tonelada === 1
      const minStr = esTonelada
        ? `${formatPrice(entry.precio_min)}<span style="font-size:9px;opacity:0.6;">/Tn</span>`
        : formatPrice(entry.precio_min)

      const hasRange = entry.precio_min !== entry.precio_max
      const rangeStr = hasRange
        ? `<span style="font-size:9px;opacity:0.5;"> – ${formatPrice(entry.precio_max)}</span>`
        : ''

      return `<td class="px-4 py-2.5 text-right tabular-nums">
        <span class="text-sm font-bold text-primary">${minStr}</span>${rangeStr}
        ${esTonelada ? '' : ''}
      </td>`
    }).join('')

    return `<tr class="border-b hover:bg-surface-container-low transition-colors" style="border-color:rgba(196,197,217,0.12);" ${bg}>
      <td class="px-4 py-2.5 text-xs font-semibold text-on-surface-variant whitespace-nowrap">${weightLabel}</td>
      ${priceCells}
    </tr>`
  }).join('')

  tableContainer.innerHTML = `
    <div class="overflow-x-auto rounded-xl" style="border:1px solid rgba(196,197,217,0.2);">
      <table class="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th class="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider sticky left-0 z-10"
                style="background:#0040e0;color:white;min-width:130px;">Peso</th>
            ${headerCells}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="text-[10px] text-on-surface-variant mt-2 px-1" style="opacity:0.45;">
      Los precios muestran el rango mínimo–máximo entre zonas de la agencia. /Tn = precio por tonelada.
    </p>
  `
}

function formatWeightBand(desde, hasta) {
  const d = Number(desde)
  const h = Number(hasta)
  if (d === 0) return `Hasta ${h} kg`
  if (!hasta || h >= 99999) return `> ${d} kg`
  return `${d} – ${h} kg`
}
