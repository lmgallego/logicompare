// ── Global filter state ────────────────────────────────────────────────────
// null = todas las agencias activas (sin filtro), Set = filtro activo
let allAgencias = []
let selectedIds = null  // null means "all"

/**
 * Returns the currently selected agency IDs, or null if all are selected.
 * Used by formHandler and devidosView to filter calculations.
 */
export function getSelectedAgenciaIds() {
  if (selectedIds === null) return null
  return Array.from(selectedIds)
}

export async function initAgenciasView() {
  if (!window.api) return
  try {
    const agencies = await window.api.invoke('get-agencies-simple')
    allAgencias = agencies
  } catch (_) {}
}

export function loadAgenciasView() {
  renderPage()
}

function renderPage() {
  const container = document.getElementById('agencias-selector-list')
  const infoEl    = document.getElementById('agencias-filter-info')
  if (!container) return

  if (!allAgencias.length) {
    container.innerHTML = `<p class="text-xs text-on-surface-variant py-4 text-center" style="opacity:0.5;">No hay agencias configuradas.</p>`
    return
  }

  // Chips
  container.innerHTML = allAgencias.map(a => {
    const active = selectedIds === null || selectedIds.has(a.id)
    return `
      <button
        class="agencia-chip flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all text-sm font-semibold
          ${active
            ? 'bg-primary text-white border-primary shadow-sm'
            : 'bg-surface-container border-outline-variant text-on-surface-variant hover:border-primary hover:text-primary'}"
        data-agency-id="${a.id}"
      >
        <span class="material-symbols-outlined text-base" style="font-variation-settings:'FILL' ${active ? '1' : '0'};">local_shipping</span>
        ${a.nombre}
        ${active ? '<span class="material-symbols-outlined text-sm" style="font-variation-settings:\'FILL\' 1;">check_circle</span>' : ''}
      </button>
    `
  }).join('')

  // Info banner
  if (infoEl) {
    const n = selectedIds === null ? allAgencias.length : selectedIds.size
    const todas = selectedIds === null
    infoEl.className = `flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all ${todas ? 'bg-surface-container text-on-surface-variant' : 'text-white'}`
    infoEl.style.background = todas ? '' : '#0040e0'
    infoEl.innerHTML = todas
      ? `<span class="material-symbols-outlined text-sm">filter_list_off</span> Usando todas las agencias (${n})`
      : `<span class="material-symbols-outlined text-sm">filter_list</span> Filtrando: ${n} de ${allAgencias.length} agencia${n !== 1 ? 's' : ''} activa${n !== 1 ? 's' : ''} en el calculador`
  }

  updateNavBadge()

  // Events
  container.querySelectorAll('.agencia-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.agencyId)

      if (selectedIds === null) {
        // First click: switch from "all" to individual selection — deselect just this one
        selectedIds = new Set(allAgencias.map(a => a.id))
        selectedIds.delete(id)
      } else if (selectedIds.has(id)) {
        selectedIds.delete(id)
        // If all are now selected again, revert to null (all)
        if (selectedIds.size === allAgencias.length) selectedIds = null
      } else {
        selectedIds.add(id)
        if (selectedIds.size === allAgencias.length) selectedIds = null
      }

      renderPage()
    })
  })

  // "Seleccionar todas" button
  document.getElementById('btn-agencias-all')?.addEventListener('click', () => {
    selectedIds = null
    renderPage()
  })
}

function updateNavBadge() {
  const badge = document.getElementById('agencias-nav-badge')
  if (!badge) return
  if (selectedIds === null) {
    badge.classList.add('hidden')
  } else {
    badge.textContent = selectedIds.size
    badge.classList.remove('hidden')
  }
}
