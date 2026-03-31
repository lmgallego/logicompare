import { formatVolume } from '../utils/formatters.js'

export function initDevidosView() {
  const form      = document.getElementById('debidos-form')
  const btnClear  = document.getElementById('btn-debidos-clear')
  const cardsEl   = document.getElementById('debidos-cards')
  const resultsEl = document.getElementById('debidos-results')
  const emptyEl   = document.getElementById('debidos-empty')
  const m3Row     = document.getElementById('debidos-m3-row')
  const m3Value   = document.getElementById('debidos-m3-value')
  const recaCheck = document.getElementById('deb-reca')
  const recaLabel = document.getElementById('reca-label')

  // Highlight RECA label when checked
  recaCheck?.addEventListener('change', () => {
    if (recaLabel) {
      recaLabel.style.borderColor = recaCheck.checked ? '#0040e0' : 'rgba(196,197,217,0.25)'
      recaLabel.style.background  = recaCheck.checked ? 'rgba(0,64,224,0.08)' : 'rgba(196,197,217,0.06)'
    }
  })

  function clearAll() {
    const l = document.getElementById('deb-largo')
    const a = document.getElementById('deb-ancho')
    const al = document.getElementById('deb-alto')
    if (l) l.value = ''
    if (a) a.value = ''
    if (al) al.value = ''
    if (recaCheck) recaCheck.checked = false
    if (recaLabel) {
      recaLabel.style.borderColor = 'rgba(196,197,217,0.25)'
      recaLabel.style.background  = 'rgba(196,197,217,0.06)'
    }
    cardsEl.innerHTML = ''
    resultsEl.classList.add('hidden')
    m3Row.classList.add('hidden')
    emptyEl.classList.remove('hidden')
    document.getElementById('deb-largo')?.focus()
  }

  btnClear?.addEventListener('click', clearAll)

  // Expose clearAll so app.js Ctrl+N can call it when on debidos page
  window._devidosClear = clearAll

  form?.addEventListener('submit', async (e) => {
    e.preventDefault()

    const largoCm = parseFloat(document.getElementById('deb-largo').value) || 0
    const anchoCm = parseFloat(document.getElementById('deb-ancho').value) || 0
    const altoCm  = parseFloat(document.getElementById('deb-alto').value)  || 0
    const isReca  = recaCheck?.checked ?? false

    if (!largoCm || !anchoCm || !altoCm) {
      alert('Introduce las tres medidas.')
      return
    }

    if (!window.api) return

    const m3 = (largoCm * anchoCm * altoCm) * 0.000001
    m3Value.textContent = formatVolume(m3)
    m3Row.classList.remove('hidden')

    const btn = document.getElementById('btn-debidos-calc')
    btn.disabled = true
    btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;animation:spin 1s linear infinite;">progress_activity</span> Calculando...'

    try {
      const resultados = await window.api.invoke('calcular-pesos-debidos', { largoCm, anchoCm, altoCm })
      renderCards(resultados, cardsEl, isReca)
      resultsEl.classList.remove('hidden')
      emptyEl.classList.add('hidden')
    } catch (err) {
      alert('Error: ' + err.message)
    } finally {
      btn.disabled = false
      btn.innerHTML = '<span class="material-symbols-outlined" style="font-size:16px;">scale</span> Calcular pesos'
    }
  })
}

function renderCards(resultados, container, isReca = false) {
  container.innerHTML = ''

  // RECA mode: show only DHL. Normal mode: hide DHL.
  const filtered = resultados.filter(r => {
    const isDhl = r.agencia.nombre?.toLowerCase().includes('dhl')
    return isReca ? isDhl : !isDhl
  })

  if (!filtered.length) {
    container.innerHTML = '<div class="col-span-full text-center py-8 text-on-surface-variant text-sm" style="opacity:0.5;">'
      + (isReca ? 'No hay agencia DHL configurada.' : 'No hay resultados.') + '</div>'
    return
  }

  // Sort: valid first by peso ascending, then errors
  const sorted = [...filtered].sort((a, b) => {
    if (a.peso == null && b.peso == null) return 0
    if (a.peso == null) return 1
    if (b.peso == null) return -1
    return a.peso - b.peso
  })

  // Lowest peso highlight
  const validPesos = sorted.filter(r => r.peso != null && r.error == null).map(r => r.peso)
  const minPeso = validPesos.length ? Math.min(...validPesos) : null

  sorted.forEach(r => {
    const isMin = r.peso != null && r.peso === minPeso && r.error == null
    const hasError = r.error != null || r.peso == null

    const logoHtml = r.agencia.logo_path
      ? '<img src="file://' + r.agencia.logo_path + '" style="width:100%;height:100%;object-fit:contain;mix-blend-mode:multiply;" alt="' + r.agencia.nombre + '" />'
      : '<span class="material-symbols-outlined" style="font-size:20px;opacity:0.35;">local_shipping</span>'

    const card = document.createElement('div')
    card.className = 'rounded-xl p-4 flex flex-col gap-3 transition-all'

    if (hasError) {
      card.style.cssText = 'background:rgba(186,26,26,0.04); border:1px solid rgba(186,26,26,0.15); opacity:0.6;'
      card.innerHTML = '<div class="flex items-center gap-3">'
        + '<div class="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden shrink-0" style="background:rgba(196,197,217,0.2);">' + logoHtml + '</div>'
        + '<div><p class="font-bold text-sm text-on-surface-variant">' + r.agencia.nombre + '</p>'
        + '<p class="text-xs mt-0.5" style="color:#ba1a1a;">'
        + '<span class="material-symbols-outlined align-middle" style="font-size:12px;">warning</span> '
        + (r.error || 'Sin cobertura') + '</p></div></div>'
    } else {
      const borderColor = isMin ? 'rgba(0,64,224,0.4)' : 'rgba(196,197,217,0.2)'
      const bgColor = isMin ? 'rgba(0,64,224,0.04)' : 'rgba(196,197,217,0.06)'
      card.style.cssText = 'background:' + bgColor + '; border:2px solid ' + borderColor + ';'

      const pesoColor = isMin ? '#0040e0' : 'inherit'
      const pesoSize = isMin ? '3rem' : '2.25rem'

      card.innerHTML = '<div class="flex items-center justify-between">'
        + '<div class="flex items-center gap-3">'
        + '<div class="w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden shrink-0" style="background:rgba(196,197,217,0.15);">' + logoHtml + '</div>'
        + '<div>'
        + '<p class="font-bold text-sm">' + r.agencia.nombre + '</p>'
        + '<p class="text-[10px] text-on-surface-variant" style="opacity:0.6;">Baremo: ' + (r.agencia.baremo || '—') + '</p>'
        + '</div></div>'
        + (isMin ? '<span class="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full" style="background:rgba(0,64,224,0.1);color:#0040e0;">Menor peso</span>' : '')
        + '</div>'
        + '<div class="flex items-end justify-between mt-1">'
        + '<div>'
        + '<p class="font-black tracking-tight leading-none" style="font-size:' + pesoSize + '; color:' + pesoColor + ';">' + r.peso + '</p>'
        + '<p class="text-xs font-bold mt-0.5" style="opacity:0.5; color:' + pesoColor + ';">kg</p>'
        + '</div>'
        + '<div class="text-right">'
        + '<p class="text-xs text-on-surface-variant" style="opacity:0.55;">Zona</p>'
        + '<p class="text-sm font-bold">' + (r.zona?.nombre_zona || '—') + '</p>'
        + '</div>'
        + '</div>'
    }

    container.appendChild(card)
  })
}
