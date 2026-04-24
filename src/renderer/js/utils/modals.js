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
