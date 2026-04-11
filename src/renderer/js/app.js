import { initSidebar } from './components/sidebar.js'
import { initFormHandler, getLastFormDatos } from './components/formHandler.js'
import { loadHistory, initHistoryControls } from './components/historyView.js'
import { loadAgencies, initAgencyModal } from './components/databaseView.js'
import { initDevidosView } from './components/devidosView.js'
import { loadAnalytics } from './components/analyticsView.js'
import { initAgenciasView, loadAgenciasView } from './components/agenciasView.js'
import { initSupportView } from './components/supportView.js'
import { loadPendingView, updatePendingBadge } from './components/pendingView.js'

const PAGES = ['new-quote', 'pending', 'debidos', 'history', 'agencias', 'analytics', 'database', 'support']
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

function showConfirmModal({ title, message, buttons }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;
      display:flex;align-items:center;justify-content:center;
    `
    const box = document.createElement('div')
    box.style.cssText = `
      background:var(--color-surface,#1e1e2e);color:var(--color-on-surface,#e0e0ff);
      border-radius:16px;padding:28px 32px;max-width:420px;width:90%;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `
    box.innerHTML = `
      <p style="font-size:15px;font-weight:700;margin:0 0 8px 0;">${title}</p>
      <p style="font-size:13px;opacity:0.7;margin:0 0 24px 0;">${message}</p>
      <div id="modal-btns" style="display:flex;flex-direction:column;gap:8px;"></div>
    `
    const btnsEl = box.querySelector('#modal-btns')
    buttons.forEach(({ label, style, value }) => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = `
        padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;
        cursor:pointer;border:none;width:100%;text-align:left;
        ${style}
      `
      btn.addEventListener('click', () => {
        overlay.remove()
        setTimeout(() => document.getElementById('input-largo')?.focus(), 50)
        resolve(value)
      })
      btnsEl.appendChild(btn)
    })
    overlay.appendChild(box)
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.remove()
        setTimeout(() => document.getElementById('input-largo')?.focus(), 50)
        resolve('cancel')
      }
    })
    document.body.appendChild(overlay)
    setTimeout(() => btnsEl.querySelector('button')?.focus(), 50)
  })
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
      } else {
        // If results are visible and no agency was chosen, warn the user
        const resultsList = document.getElementById('results-list')
        const hasResults = resultsList && !resultsList.classList.contains('hidden')
        if (hasResults) {
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
