// Shared modal helpers. Replacing native confirm()/alert() avoids the focus
// bug where, after closing a native dialog in Electron, keyboard events no
// longer reach the renderer until the window is re-focused by the OS.

function restoreFocus() {
  // Put focus back on the first quote input if it's there, otherwise on body
  setTimeout(() => {
    const largo = document.getElementById('input-largo')
    if (largo) largo.focus()
    else document.body.focus()
  }, 40)
}

export function showConfirmModal({ title, message, buttons }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;
      display:flex;align-items:center;justify-content:center;
    `
    const box = document.createElement('div')
    box.style.cssText = `
      background:var(--color-surface,#1e1e2e);color:var(--color-on-surface,#e0e0ff);
      border-radius:16px;padding:28px 32px;max-width:460px;width:90%;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `
    box.innerHTML = `
      <p style="font-size:15px;font-weight:700;margin:0 0 8px 0;">${title}</p>
      <p style="font-size:13px;opacity:0.7;margin:0 0 24px 0;white-space:pre-line;">${message || ''}</p>
      <div id="modal-btns" style="display:flex;flex-direction:column;gap:8px;"></div>
    `
    const btnsEl = box.querySelector('#modal-btns')
    buttons.forEach(({ label, style, value }) => {
      const btn = document.createElement('button')
      btn.textContent = label
      btn.style.cssText = `
        padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;
        cursor:pointer;border:none;width:100%;text-align:left;
        ${style || ''}
      `
      btn.addEventListener('click', () => {
        overlay.remove()
        restoreFocus()
        resolve(value)
      })
      btnsEl.appendChild(btn)
    })
    overlay.appendChild(box)
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.remove()
        restoreFocus()
        resolve('cancel')
      }
    })
    document.body.appendChild(overlay)
    setTimeout(() => btnsEl.querySelector('button')?.focus(), 50)
  })
}

// Simple yes/no confirm
export function confirmModal(message, title = 'Confirmar') {
  return showConfirmModal({
    title,
    message,
    buttons: [
      { label: '✓ Sí, continuar', style: 'background:rgba(0,64,224,0.12);color:#0040e0;', value: true },
      { label: '✕ Cancelar',      style: 'background:rgba(196,197,217,0.08);opacity:0.7;', value: false },
    ],
  }).then(v => v === true)
}

/**
 * Modal para seleccionar un cliente. Búsqueda por código o razón social.
 * Resuelve con `{ codigo, razon_social }` al elegir, o `null` si se cancela.
 * `options.required` (true por defecto) → no permite cancelar con clic fuera.
 * `options.title`, `options.subtitle` → personalizables.
 */
export function pickClienteModal(options = {}) {
  const required = options.required !== false
  const title    = options.title    || 'Selecciona el cliente'
  const subtitle = options.subtitle || 'Escribe el código o parte del nombre y elige de la lista.'

  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;
      display:flex;align-items:center;justify-content:center;
    `
    const box = document.createElement('div')
    box.style.cssText = `
      background:#ffffff;color:#171c1f;
      border-radius:16px;padding:22px 24px;max-width:540px;width:92%;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;">
        <span class="material-symbols-outlined" style="font-size:22px;color:#0040e0;">person_search</span>
        <p style="font-size:15px;font-weight:700;margin:0;">${title}</p>
      </div>
      <p style="font-size:12px;opacity:0.65;margin:0 0 14px 0;">${subtitle}</p>
      <input id="cliente-pick-input" type="text" autocomplete="off" placeholder="Código o razón social…" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid rgba(23,28,31,0.2);background:#fff;color:#171c1f;font-size:14px;font-weight:600;" />
      <div id="cliente-pick-status" style="font-size:11px;opacity:0.55;margin-top:6px;min-height:14px;"></div>
      <div id="cliente-pick-list" style="margin-top:10px;max-height:280px;overflow-y:auto;border:1px solid rgba(23,28,31,0.08);border-radius:8px;background:#fafafa;"></div>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button type="button" id="cliente-pick-cancel" style="flex:1;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:rgba(23,28,31,0.06);color:#171c1f;opacity:${required ? '0.5' : '0.85'};">${required ? 'Cancelar (no se podrá cotizar)' : 'Cancelar'}</button>
      </div>
    `
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    const input  = box.querySelector('#cliente-pick-input')
    const list   = box.querySelector('#cliente-pick-list')
    const status = box.querySelector('#cliente-pick-status')
    const cancel = box.querySelector('#cliente-pick-cancel')
    let activeIdx = -1
    let lastResults = []
    let timer = null

    function close(value) {
      overlay.remove()
      restoreFocus()
      resolve(value)
    }

    function renderEmpty(msg) {
      list.innerHTML = `<div style="padding:14px 12px;font-size:12px;opacity:0.55;text-align:center;">${msg}</div>`
    }

    function highlight() {
      list.querySelectorAll('[data-row]').forEach((el, i) => {
        el.style.background = i === activeIdx ? 'rgba(0,64,224,0.12)' : 'transparent'
      })
    }

    async function refresh() {
      const q = input.value.trim()
      if (q.length < 1) {
        lastResults = []
        renderEmpty('Empieza a escribir para buscar…')
        status.textContent = ''
        activeIdx = -1
        return
      }
      try {
        const results = await window.api.invoke('search-clientes', { query: q, limit: 30 })
        lastResults = results || []
        if (lastResults.length === 0) {
          renderEmpty('Sin coincidencias. Verifica el código o el nombre.')
          status.textContent = ''
          activeIdx = -1
          return
        }
        list.innerHTML = lastResults.map((c, i) => `
          <div data-row="${i}" style="padding:9px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid rgba(23,28,31,0.05);font-size:13px;">
            <div style="min-width:0;flex:1;">
              <div style="font-weight:700;color:#171c1f;">${c.razon_social}</div>
              <div style="font-size:10px;opacity:0.55;font-family:monospace;">Código ${c.codigo}</div>
            </div>
            <span class="material-symbols-outlined" style="font-size:16px;color:#0040e0;opacity:0.5;">chevron_right</span>
          </div>
        `).join('')
        activeIdx = 0
        highlight()
        status.textContent = `${lastResults.length} resultado(s)`

        list.querySelectorAll('[data-row]').forEach((el, i) => {
          el.addEventListener('mouseenter', () => { activeIdx = i; highlight() })
          el.addEventListener('click', () => close(lastResults[i]))
        })
      } catch (err) {
        renderEmpty('Error al buscar: ' + err.message)
      }
    }

    input.addEventListener('input', () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refresh, 120)
    })

    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (lastResults.length) { activeIdx = Math.min(lastResults.length - 1, activeIdx + 1); highlight() }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (lastResults.length) { activeIdx = Math.max(0, activeIdx - 1); highlight() }
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (activeIdx >= 0 && lastResults[activeIdx]) close(lastResults[activeIdx])
      } else if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      }
    })

    cancel.addEventListener('click', () => close(null))
    if (!required) {
      overlay.addEventListener('click', e => { if (e.target === overlay) close(null) })
    }

    renderEmpty('Empieza a escribir para buscar…')
    setTimeout(() => input.focus(), 50)
  })
}

// Simple alert (message only, one OK button)
export function alertModal(message, title = 'Aviso') {
  return showConfirmModal({
    title,
    message,
    buttons: [
      { label: '✓ Entendido', style: 'background:rgba(0,64,224,0.12);color:#0040e0;', value: 'ok' },
    ],
  })
}

/**
 * Form modal. `fields` is an array of:
 *   { name, label, type: 'text'|'number'|'date'|'select', value, options?, required?, step?, min?, max?, placeholder? }
 * Resolves with object of values or null on cancel.
 */
export function showFormModal({ title, subtitle, fields, submitLabel = 'Guardar' }) {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.style.cssText = `
      position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;
      display:flex;align-items:center;justify-content:center;
    `
    const box = document.createElement('div')
    box.style.cssText = `
      background:var(--color-surface,#1e1e2e);color:var(--color-on-surface,#e0e0ff);
      border-radius:16px;padding:24px 28px;max-width:520px;width:92%;
      max-height:90vh;overflow-y:auto;
      box-shadow:0 8px 32px rgba(0,0,0,0.5);
    `

    const header = `
      <p style="font-size:15px;font-weight:700;margin:0 0 4px 0;">${title}</p>
      ${subtitle ? `<p style="font-size:12px;opacity:0.65;margin:0 0 18px 0;">${subtitle}</p>` : '<div style="margin-bottom:10px;"></div>'}
    `

    const fieldsHtml = fields.map(f => {
      const val = f.value ?? ''
      const req = f.required ? 'required' : ''
      const common = `style="width:100%;padding:8px 10px;border-radius:8px;border:1px solid rgba(196,197,217,0.35);background:rgba(255,255,255,0.05);color:inherit;font-size:13px;"`
      let input
      if (f.type === 'select') {
        const opts = (f.options || []).map(o =>
          `<option value="${String(o.value).replace(/"/g, '&quot;')}" ${String(o.value) === String(val) ? 'selected' : ''}>${o.label}</option>`
        ).join('')
        input = `<select name="${f.name}" ${req} ${common}>${opts}</select>`
      } else if (f.type === 'textarea') {
        input = `<textarea name="${f.name}" ${req} rows="3" ${common}>${val}</textarea>`
      } else if (f.type === 'cliente') {
        const labelText = (typeof f.getLabel === 'function') ? f.getLabel() : (f.value && f.value.razon_social ? f.value.razon_social : '— sin cliente —')
        input = `<button type="button" data-cliente-picker="${f.name}" style="width:100%;padding:9px 12px;border-radius:8px;border:1px solid rgba(23,28,31,0.2);background:#fff;color:#171c1f;font-size:13px;font-weight:600;text-align:left;cursor:pointer;display:flex;align-items:center;gap:8px;">
            <span class="material-symbols-outlined" style="font-size:16px;color:#0040e0;">person_search</span>
            <span data-cliente-label="${f.name}" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${labelText}</span>
            <span class="material-symbols-outlined" style="font-size:14px;opacity:0.5;">edit</span>
          </button>
          <input type="hidden" name="${f.name}" value="" />`
      } else {
        const step = f.step != null ? `step="${f.step}"` : ''
        const min  = f.min  != null ? `min="${f.min}"`   : ''
        const max  = f.max  != null ? `max="${f.max}"`   : ''
        const ph   = f.placeholder ? `placeholder="${f.placeholder}"` : ''
        input = `<input type="${f.type || 'text'}" name="${f.name}" value="${val}" ${step} ${min} ${max} ${ph} ${req} ${common} />`
      }
      return `
        <div style="margin-bottom:12px;">
          <label style="display:block;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;opacity:0.55;margin-bottom:5px;">${f.label}</label>
          ${input}
        </div>`
    }).join('')

    box.innerHTML = `
      ${header}
      <form id="modal-form">${fieldsHtml}</form>
      <div style="display:flex;gap:8px;margin-top:14px;">
        <button type="button" id="modal-cancel" style="flex:1;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;border:none;background:rgba(196,197,217,0.12);color:inherit;opacity:0.75;">Cancelar</button>
        <button type="button" id="modal-submit" style="flex:1;padding:10px 14px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;background:#0040e0;color:white;">${submitLabel}</button>
      </div>
    `
    overlay.appendChild(box)
    document.body.appendChild(overlay)

    const form = box.querySelector('#modal-form')

    // Conectar botones de tipo "cliente" al picker reutilizable
    fields.forEach(f => {
      if (f.type !== 'cliente') return
      const btn = box.querySelector(`[data-cliente-picker="${f.name}"]`)
      const lbl = box.querySelector(`[data-cliente-label="${f.name}"]`)
      if (!btn) return
      btn.addEventListener('click', async () => {
        const cliente = await pickClienteModal({ required: false, title: 'Selecciona cliente' })
        if (cliente === null) return
        if (typeof f.onPick === 'function') f.onPick(cliente)
        if (lbl) lbl.textContent = (typeof f.getLabel === 'function') ? f.getLabel() : (cliente?.razon_social || '— sin cliente —')
      })
    })

    // Auto-cálculo de metros cúbicos si el formulario tiene largoCm/anchoCm/altoCm y metrosCubicos
    const dimNames = ['largoCm', 'anchoCm', 'altoCm']
    const m3El = form.elements.namedItem('metrosCubicos')
    const dimEls = dimNames.map(n => form.elements.namedItem(n)).filter(Boolean)
    if (m3El && dimEls.length === 3) {
      // Hacer el campo m³ de solo lectura visualmente y dejar claro que se calcula solo
      m3El.readOnly = true
      m3El.style.opacity = '0.75'
      m3El.style.cursor = 'not-allowed'
      m3El.title = 'Se calcula automáticamente a partir de largo × ancho × alto'

      const recompute = () => {
        const l = parseFloat(dimEls[0].value) || 0
        const a = parseFloat(dimEls[1].value) || 0
        const h = parseFloat(dimEls[2].value) || 0
        if (l > 0 && a > 0 && h > 0) {
          const m3 = Math.round(l * a * h * 0.000001 * 1000000) / 1000000
          m3El.value = m3
        } else {
          m3El.value = ''
        }
      }

      dimEls.forEach(el => el.addEventListener('input', recompute))
      // Recompute at open so edits to existing rows show an up-to-date value
      recompute()
    }

    function close(result) {
      overlay.remove()
      restoreFocus()
      resolve(result)
    }

    box.querySelector('#modal-cancel').addEventListener('click', () => close(null))
    overlay.addEventListener('click', e => { if (e.target === overlay) close(null) })
    box.querySelector('#modal-submit').addEventListener('click', () => {
      if (!form.checkValidity()) { form.reportValidity(); return }
      const data = {}
      fields.forEach(f => {
        const el = form.elements.namedItem(f.name)
        if (!el) return
        data[f.name] = el.value
      })
      close(data)
    })
    // Submit on Enter inside inputs
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault()
        box.querySelector('#modal-submit').click()
      }
    })

    setTimeout(() => form.querySelector('input,select,textarea')?.focus(), 50)
  })
}
