import { initSidebar } from './components/sidebar.js'
import { initFormHandler, getLastFormDatos, wasAgenciaElegida } from './components/formHandler.js'
import { loadHistory, initHistoryControls } from './components/historyView.js'
import { loadAgencies, initAgencyModal } from './components/databaseView.js'
import { initDevidosView } from './components/devidosView.js'
import { loadAnalytics } from './components/analyticsView.js'
import { initAgenciasView, loadAgenciasView } from './components/agenciasView.js'
import { initSupportView } from './components/supportView.js'
import { loadPendingView, updatePendingBadge } from './components/pendingView.js'
import { initParachoquesView, loadParachoquesView } from './components/parachoquesView.js'
import { showConfirmModal, showFormModal, alertModal } from './utils/modals.js'

const PAGES = ['new-quote', 'pending', 'debidos', 'parachoques', 'history', 'agencias', 'analytics', 'database', 'support']
let currentPage = 'new-quote'

function showToast(msg, type = 'info') {
  const existing = document.getElementById('app-toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.id = 'app-toast'
  toast.textContent = msg
  const styles = {
    warning: 'background:#7c5c00;color:#fff8e1;',
    info:    'background:#1a237e;color:#fff;',
  }
  toast.style.cssText = `
    position:fixed;bottom:28px;left:50%;transform:translateX(-50%);
    padding:11px 22px;border-radius:12px;font-size:13px;font-weight:600;
    z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.25s;
    box-shadow:0 4px 16px rgba(0,0,0,0.25);
    ${styles[type] || styles.info}
  `
  document.body.appendChild(toast)
  requestAnimationFrame(() => { toast.style.opacity = '1' })
  setTimeout(() => {
    toast.style.opacity = '0'
    setTimeout(() => toast.remove(), 300)
  }, 3800)
}

function showPage(pageId) {
  // Aviso si salimos de Pagados con resultados visibles pero sin haber elegido agencia
  if (currentPage === 'new-quote' && pageId !== 'new-quote') {
    const resultsList = document.getElementById('results-list')
    const hasResults = resultsList && !resultsList.classList.contains('hidden')
    if (hasResults) {
      showToast('⚠️ Has salido sin seleccionar ninguna agencia para este envío', 'warning')
    }
  }

  currentPage = pageId
  PAGES.forEach(id => {
    const el = document.getElementById(`page-${id}`)
    if (el) {
      el.classList.toggle('active', id === pageId)
    }
  })

  if (pageId === 'history') {
    const desde = document.getElementById('history-desde')?.value || null
    const hasta = document.getElementById('history-hasta')?.value || null
    const agenciaId = document.getElementById('history-agencia')?.value || null
    loadHistory(desde, hasta, agenciaId)
  }
  if (pageId === 'database') loadAgencies()
  if (pageId === 'analytics') loadAnalytics()
  if (pageId === 'agencias') loadAgenciasView()
  if (pageId === 'pending') loadPendingView()
  if (pageId === 'parachoques') loadParachoquesView()

  if (pageId === 'new-quote') {
    setTimeout(() => document.getElementById('input-largo')?.focus(), 80)
  }
}

async function initApp() {
  initSidebar(showPage)
  initFormHandler()
  initDevidosView()
  initAgencyModal()
  initHistoryControls()  // fire-and-forget — populates agency dropdown async
  initAgenciasView()    // preload agency list for comparison view
  initParachoquesView()
  initSupportView()

  document.getElementById('btn-refresh-history')?.addEventListener('click', () => {
    const desde = document.getElementById('history-desde')?.value || null
    const hasta = document.getElementById('history-hasta')?.value || null
    const agenciaId = document.getElementById('history-agencia')?.value || null
    loadHistory(desde, hasta, agenciaId)
  })

  document.getElementById('btn-add-manual')?.addEventListener('click', async () => {
    let agencyOptions = [{ value: '', label: '— Sin agencia —' }]
    try {
      const list = await window.api.invoke('get-agencies-simple')
      agencyOptions = agencyOptions.concat(list.map(a => ({ value: String(a.id), label: a.nombre })))
    } catch (_) {}

    const today = new Date().toISOString().slice(0, 10)
    // Prefill from current form if the user already typed something
    const largoEl = document.getElementById('input-largo')
    const anchoEl = document.getElementById('input-ancho')
    const altoEl  = document.getElementById('input-alto')
    const cpEl    = document.getElementById('input-cp')

    const result = await showFormModal({
      title: 'Añadir cotización manual',
      subtitle: 'Crea un registro directamente en el historial sin calcular tarifas',
      submitLabel: 'Guardar en historial',
      fields: [
        { name: 'fecha',         label: 'Fecha',           type: 'date',   value: today, required: true },
        { name: 'largoCm',       label: 'Largo (cm)',      type: 'number', value: largoEl?.value || '', step: '0.1', min: 0, required: true },
        { name: 'anchoCm',       label: 'Ancho (cm)',      type: 'number', value: anchoEl?.value || '', step: '0.1', min: 0, required: true },
        { name: 'altoCm',        label: 'Alto (cm)',       type: 'number', value: altoEl?.value || '',  step: '0.1', min: 0, required: true },
        { name: 'cpPrefix',      label: 'CP (2 dígitos)',  type: 'text',   value: cpEl?.value || '', required: true },
        { name: 'peso',          label: 'Peso (kg)',       type: 'number', value: '', step: '0.01', min: 0 },
        { name: 'metrosCubicos', label: 'Metros cúbicos',  type: 'number', value: '', step: '0.000001', min: 0 },
        { name: 'agenciaId',     label: 'Agencia',         type: 'select', value: '', options: agencyOptions },
        { name: 'precioFinal',   label: 'Precio final (€)', type: 'number', value: '', step: '0.01', min: 0, required: true },
      ],
    })

    if (!result) return

    try {
      const res = await window.api.invoke('save-quote-manual', {
        fecha: result.fecha ? (result.fecha + ' 12:00:00') : null,
        largoCm: parseFloat(result.largoCm),
        anchoCm: parseFloat(result.anchoCm),
        altoCm:  parseFloat(result.altoCm),
        cpPrefix: String(result.cpPrefix).trim().padStart(2, '0').slice(0, 2),
        peso: parseFloat(result.peso) || 0,
        metrosCubicos: parseFloat(result.metrosCubicos) || 0,
        agenciaId: result.agenciaId ? parseInt(result.agenciaId) : null,
        precioFinal: parseFloat(result.precioFinal),
      })
      if (!res.ok) throw new Error(res.error || 'No se pudo guardar')
      showToast('✓ Cotización manual guardada en el historial', 'success')
    } catch (err) {
      alertModal('Error al guardar: ' + err.message, 'Error')
    }
  })

  document.getElementById('btn-minimize')?.addEventListener('click', () => {
    window.api?.send('window-minimize')
  })
  document.getElementById('btn-maximize')?.addEventListener('click', () => {
    window.api?.send('window-maximize')
  })
  document.getElementById('btn-close')?.addEventListener('click', () => {
    window.api?.send('window-close')
  })

  if (window.api) {
    try {
      const version = await window.api.invoke('get-app-version')
      const versionEl = document.getElementById('app-version')
      if (versionEl) versionEl.textContent = `V. ${version} (Industrial)`
    } catch (_) {}

    try {
      await window.api.invoke('get-provincias')
      const dbStatus = document.getElementById('status-db')
      if (dbStatus) dbStatus.textContent = 'DB: Conectado'
      // Load pending badge count on startup
      try {
        const countRow = await window.api.invoke('get-pending-count')
        updatePendingBadge(countRow?.c ?? 0)
      } catch (_) {}
    } catch (err) {
      const dbStatus = document.getElementById('status-db')
      if (dbStatus) {
        dbStatus.textContent = 'DB: Error'
        dbStatus.style.color = '#ba1a1a'
      }
    }
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', async (e) => {
    if (!e.ctrlKey) return

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      if (currentPage === 'debidos') {
        window._devidosClear?.()
        const debExtra = document.getElementById('deb-extra-bultos-container')
        if (debExtra) debExtra.innerHTML = ''
        document.getElementById('debidos-bultos-badge')?.classList.add('hidden')
      } else if (currentPage === 'parachoques') {
        // Limpiar formulario de parachoques sin salir de la página
        const refEl    = document.getElementById('parachoques-ref')
        const cpEl     = document.getElementById('parachoques-cp')
        const results  = document.getElementById('parachoques-results')
        const empty    = document.getElementById('parachoques-empty')
        const info     = document.getElementById('parachoques-info')
        const suggest  = document.getElementById('parachoques-suggest')
        if (refEl) refEl.value = ''
        if (cpEl)  cpEl.value  = ''
        if (results) { results.innerHTML = ''; results.classList.add('hidden') }
        if (empty)   empty.classList.remove('hidden')
        if (info)    info.classList.add('hidden')
        if (suggest) { suggest.innerHTML = ''; suggest.classList.add('hidden') }
        setTimeout(() => refEl?.focus(), 30)
      } else {
        // If results are visible and no agency was chosen, warn the user
        const resultsList = document.getElementById('results-list')
        const hasResults = resultsList && !resultsList.classList.contains('hidden')
        if (hasResults && !wasAgenciaElegida()) {
          const action = await showConfirmModal({
            title: '⚠️ No has seleccionado ninguna agencia',
            message: '¿Qué quieres hacer con las medidas actuales antes de empezar un nuevo registro?',
            buttons: [
              { label: '💾 Guardar en Pendientes y continuar', style: 'background:rgba(196,197,217,0.12);', value: 'save' },
              { label: '🗑 Descartar y continuar de todas formas', style: 'background:rgba(186,26,26,0.12);color:#f87171;', value: 'discard' },
              { label: '✕ Cancelar (volver al formulario)', style: 'background:rgba(196,197,217,0.06);opacity:0.65;', value: 'cancel' },
            ]
          })
          if (action === 'cancel') return
          if (action === 'save') {
            const datos = getLastFormDatos()
            if (datos && window.api) {
              await window.api.invoke('save-pending-quote', {
                cpPrefix:   datos.cpPrefix,
                bultos:     datos.bultos,
                resultados: datos.lastResultados || [],
              })
              const countRow = await window.api.invoke('get-pending-count')
              updatePendingBadge(countRow?.c ?? 0)
            }
          }
        }
        showPage('new-quote')
        document.getElementById('quote-form')?.reset()
        const extraContainer = document.getElementById('extra-bultos-container')
        if (extraContainer) extraContainer.innerHTML = ''
        document.getElementById('bultos-badge')?.classList.add('hidden')
        document.getElementById('results-list')?.classList.add('hidden')
        document.getElementById('results-empty')?.classList.remove('hidden')
        document.getElementById('results-stats')?.classList.add('hidden')
        document.getElementById('metros-cubicos-row')?.classList.add('hidden')
        document.getElementById('cp-info')?.classList.add('hidden')
        document.getElementById('quotes-badge')?.classList.add('hidden')
        document.getElementById('input-largo')?.focus()
      }
    }
  })

  showPage('new-quote')
}

document.addEventListener('DOMContentLoaded', initApp)
