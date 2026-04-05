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

function showPage(pageId) {
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
      } else {
        showPage('new-quote')
        document.getElementById('quote-form')?.reset()
        document.getElementById('results-list')?.classList.add('hidden')
        document.getElementById('results-empty')?.classList.remove('hidden')
        document.getElementById('results-stats')?.classList.add('hidden')
        document.getElementById('metros-cubicos-row')?.classList.add('hidden')
        document.getElementById('cp-info')?.classList.add('hidden')
        document.getElementById('input-largo')?.focus()
      }
    }

    if (e.key === 'g' || e.key === 'G') {
      e.preventDefault()
      // Click Elegir on the first visible GLS result card
      const resultsList = document.getElementById('results-list')
      if (!resultsList || resultsList.classList.contains('hidden')) return
      const cards = resultsList.querySelectorAll('.carrier-card')
      for (const card of cards) {
        const nombre = card.querySelector('h3')?.textContent?.toLowerCase() || ''
        if (nombre.includes('gls')) {
          card.querySelector('[data-agency-id]')?.click()
          break
        }
      }
    }
  })

  showPage('new-quote')
}

document.addEventListener('DOMContentLoaded', initApp)
