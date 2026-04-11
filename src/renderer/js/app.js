import { initSidebar } from './components/sidebar.js'
import { initFormHandler } from './components/formHandler.js'
import { loadHistory, initHistoryControls } from './components/historyView.js'
import { loadAgencies, initAgencyModal } from './components/databaseView.js'
import { initDevidosView } from './components/devidosView.js'
import { loadAnalytics } from './components/analyticsView.js'
import { initAgenciasView, loadAgenciasView } from './components/agenciasView.js'
import { initSupportView } from './components/supportView.js'

const PAGES = ['new-quote', 'debidos', 'history', 'agencias', 'analytics', 'database', 'support']
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
}

async function initApp() {
  initSidebar(showPage)
  initFormHandler()
  initDevidosView()
  initAgencyModal()
  initHistoryControls()  // fire-and-forget — populates agency dropdown async
  initAgenciasView()    // preload agency list for comparison view
  initSupportView()

  document.getElementById('btn-refresh-history')?.addEventListener('click', () => {
    const desde = document.getElementById('history-desde')?.value || null
    const hasta = document.getElementById('history-hasta')?.value || null
    const agenciaId = document.getElementById('history-agencia')?.value || null
    loadHistory(desde, hasta, agenciaId)
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
    } catch (err) {
      const dbStatus = document.getElementById('status-db')
      if (dbStatus) {
        dbStatus.textContent = 'DB: Error'
        dbStatus.style.color = '#ba1a1a'
      }
    }
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (!e.ctrlKey) return

    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault()
      if (currentPage === 'debidos') {
        window._devidosClear?.()
        // Also clear extra bulto rows in Debidos
        const debExtra = document.getElementById('deb-extra-bultos-container')
        if (debExtra) debExtra.innerHTML = ''
        document.getElementById('debidos-bultos-badge')?.classList.add('hidden')
      } else {
        showPage('new-quote')
        document.getElementById('quote-form')?.reset()
        // Clear extra bulto rows
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
