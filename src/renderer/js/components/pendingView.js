import { formatPrice, formatWeight, formatVolume } from '../utils/formatters.js'

function formatDate(str) {
  if (!str) return '—'
  const d = new Date(str)
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export async function loadPendingView() {
  const el = document.getElementById('page-pending')
  if (!el) return

  const rows = await window.api.invoke('get-pending-quotes')

  if (rows.length === 0) {
    el.innerHTML = `
      <div class="max-w-4xl mx-auto p-6">
        <h2 class="text-lg font-bold tracking-tight mb-6">Cotizaciones Pendientes de Agencia</h2>
        <div class="flex flex-col items-center justify-center py-24 text-center">
          <span class="material-symbols-outlined text-5xl text-on-surface-variant mb-3" style="opacity:0.25;">pending_actions</span>
          <p class="text-sm text-on-surface-variant" style="opacity:0.55;">No hay cotizaciones pendientes.<br/>Aparecerán aquí si guardas sin elegir agencia.</p>
        </div>
      </div>
    `
    updatePendingBadge(0)
    return
  }

  updatePendingBadge(rows.length)

  el.innerHTML = `
    <div class="max-w-5xl mx-auto p-6 space-y-4">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-3">
          <h2 class="text-lg font-bold tracking-tight">Cotizaciones Pendientes de Agencia</h2>
          <span class="bg-amber-500/15 text-amber-700 text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter">${rows.length} pendiente${rows.length !== 1 ? 's' : ''}</span>
        </div>
      </div>
      <div id="pending-list" class="space-y-4"></div>
    </div>
  `

  const list = el.querySelector('#pending-list')
  rows.forEach(row => renderPendingCard(list, row))
}

function renderPendingCard(container, row) {
  const card = document.createElement('div')
  card.className = 'bg-surface-container-lowest rounded-xl p-5 space-y-3'
  card.style = 'box-shadow:0 2px 12px rgba(23,28,31,0.07);border:1px solid rgba(196,197,217,0.14);'

  const bultosSummary = row.bultos.map((b, i) =>
    `<span class="inline-block bg-surface-container px-2 py-0.5 rounded text-xs font-mono">${b.largoCm}×${b.anchoCm}×${b.altoCm}</span>`
  ).join(' ')

  const resultadosValidos = row.resultados.filter(r => r.precioFinal !== null)
    .sort((a, b) => a.precioFinal - b.precioFinal)

  const opciones = resultadosValidos.map(r => `
    <div class="flex items-center justify-between py-2 border-b border-surface-container last:border-0">
      <div>
        <span class="font-semibold text-sm">${r.agencia.nombre}</span>
        <span class="text-xs text-on-surface-variant ml-2" style="opacity:0.6;">
          ${r.zona?.nombre_zona || '—'} · ${r.peso ?? 0} kg · ${formatVolume(r.metrosCubicos ?? 0)}
        </span>
      </div>
      <div class="flex items-center gap-3">
        <span class="font-black text-primary text-base">${formatPrice(r.precioFinal)}</span>
        <button
          class="btn-primary text-xs px-4 py-1.5"
          data-pending-id="${row.id}"
          data-agencia-id="${r.agencia.id}"
          data-metros="${r.metrosCubicos ?? 0}"
          data-peso="${r.peso ?? 0}"
          data-precio="${r.precioFinal}"
          data-cp="${row.cp_prefix}"
          data-largo="${row.bultos[0]?.largoCm ?? 0}"
          data-ancho="${row.bultos[0]?.anchoCm ?? 0}"
          data-alto="${row.bultos[0]?.altoCm ?? 0}"
        >Elegir</button>
      </div>
    </div>
  `).join('')

  card.innerHTML = `
    <div class="flex items-start justify-between gap-4">
      <div class="space-y-1">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="material-symbols-outlined text-amber-500" style="font-size:18px;">pending_actions</span>
          <span class="font-bold text-sm">CP ${row.cp_prefix}</span>
          <span class="text-xs text-on-surface-variant" style="opacity:0.55;">${formatDate(row.fecha)}</span>
          ${row.bultos.length > 1 ? `<span class="text-[10px] font-black px-1.5 py-0.5 rounded-full" style="background:rgba(0,64,224,0.08);color:#0040e0;">${row.bultos.length} bultos</span>` : ''}
        </div>
        <div class="flex flex-wrap gap-1 mt-1">${bultosSummary}</div>
      </div>
      <button class="btn-delete-pending shrink-0 w-7 h-7 flex items-center justify-center rounded hover:bg-red-50 text-red-400 hover:text-red-600 transition-colors" data-id="${row.id}" title="Descartar esta cotización pendiente">
        <span class="material-symbols-outlined" style="font-size:16px;">delete</span>
      </button>
    </div>
    ${resultadosValidos.length > 0
      ? `<div class="rounded-lg overflow-hidden border border-surface-container">${opciones}</div>`
      : `<p class="text-xs text-on-surface-variant" style="opacity:0.5;">Sin resultados válidos guardados.</p>`
    }
  `

  // Wire Elegir buttons
  card.querySelectorAll('[data-pending-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      btn.textContent = '✓ Guardando...'
      await window.api.invoke('resolve-pending-quote', {
        pendingId:     parseInt(btn.dataset.pendingId),
        agenciaId:     parseInt(btn.dataset.agenciaId),
        metrosCubicos: parseFloat(btn.dataset.metros),
        peso:          parseFloat(btn.dataset.peso),
        precioFinal:   parseFloat(btn.dataset.precio),
        cpPrefix:      btn.dataset.cp,
        largoCm:       parseFloat(btn.dataset.largo),
        anchoCm:       parseFloat(btn.dataset.ancho),
        altoCm:        parseFloat(btn.dataset.alto),
        bultos:        row.bultos,
      })
      card.remove()
      // Refresh badge
      const remaining = document.querySelectorAll('#pending-list > div').length
      updatePendingBadge(remaining)
      if (remaining === 0) loadPendingView()
    })
  })

  // Wire delete button
  card.querySelector('.btn-delete-pending').addEventListener('click', async () => {
    await window.api.invoke('delete-pending-quote', { id: row.id })
    card.remove()
    const remaining = document.querySelectorAll('#pending-list > div').length
    updatePendingBadge(remaining)
    if (remaining === 0) loadPendingView()
  })

  container.appendChild(card)
}

export function updatePendingBadge(count) {
  const badge = document.getElementById('pending-nav-badge')
  if (!badge) return
  if (count > 0) {
    badge.textContent = count
    badge.classList.remove('hidden')
  } else {
    badge.classList.add('hidden')
  }
}
