function getBtnHtml() {
  const style = 'background:rgba(0,64,224,0.08); color:#0040e0; border:1px solid rgba(0,64,224,0.2);'
  return '<div class="flex justify-end" id="btn-new-agency-row">'
    + '<button id="btn-new-agency" class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all" style="' + style + '">'
    + '<span class="material-symbols-outlined" style="font-size:14px;">add</span>'
    + ' Nueva Agencia'
    + '</button></div>'
}

export async function loadAgencies() {
  const container = document.getElementById('agencies-list')
  if (!container) return

  const setContent = (html) => {
    container.innerHTML = getBtnHtml() + html
    // Re-attach modal trigger since button was recreated
    const btn = container.querySelector('#btn-new-agency')
    if (btn) btn.addEventListener('click', () => openAgencyModal())
  }

  setContent(`<div class="text-center py-8 text-on-surface-variant text-xs" style="opacity:0.5;">Cargando...</div>`)

  if (!window.api) {
    setContent(`<div class="text-center py-8 text-on-surface-variant text-xs" style="opacity:0.5;">Sin conexión IPC.</div>`)
    return
  }

  try {
    const agencies = await window.api.invoke('get-agencies')
    if (!agencies || agencies.length === 0) {
      setContent(`
        <div class="bg-surface-container-lowest rounded-xl p-8 text-center" style="border: 1px solid rgba(196,197,217,0.12);">
          <span class="material-symbols-outlined text-4xl text-on-surface-variant mb-3" style="opacity:0.3; display:block;">local_shipping</span>
          <p class="text-sm text-on-surface-variant" style="opacity:0.6;">No hay agencias configuradas.<br/>Crea la primera con el botón de arriba.</p>
        </div>
      `)
      return
    }

    setContent(agencies.map(a => `
      <div class="bg-surface-container-lowest rounded-xl p-5 flex items-center justify-between gap-4" style="box-shadow: 0px 4px 20px rgba(23,28,31,0.05); border: 1px solid rgba(196,197,217,0.12);">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-surface-container rounded-lg flex items-center justify-center overflow-hidden shrink-0">
            ${a.logo_path
              ? `<img src="file://${a.logo_path}" class="w-full h-full object-contain mix-blend-multiply" alt="${a.nombre}" />`
              : `<span class="material-symbols-outlined text-on-surface-variant" style="font-size:20px; opacity:0.35;">local_shipping</span>`
            }
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="font-bold text-sm">${a.nombre}</h3>
              <span class="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${a.activa ? 'bg-green-100 text-green-700' : 'bg-surface-container text-on-surface-variant opacity-60'}">
                ${a.activa ? 'Activa' : 'Inactiva'}
              </span>
            </div>
            <p class="text-xs text-on-surface-variant mt-0.5" style="opacity:0.65;">Ámbito: ${a.ambito} · ID: ${a.id}</p>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button class="p-2 rounded-lg bg-surface-container-high hover:bg-primary hover:text-white transition-all text-on-surface-variant btn-edit-agency" data-agency-id="${a.id}" title="Editar">
            <span class="material-symbols-outlined pointer-events-none" style="font-size:16px;">edit</span>
          </button>
          <button class="p-2 rounded-lg bg-surface-container-high hover:bg-red-500 hover:text-white transition-all text-on-surface-variant btn-delete-agency" data-agency-id="${a.id}" data-agency-nombre="${a.nombre}" title="Eliminar">
            <span class="material-symbols-outlined pointer-events-none" style="font-size:16px;">delete</span>
          </button>
        </div>
      </div>
    `).join(''))

    container.querySelectorAll('.btn-edit-agency').forEach(btn => {
      btn.addEventListener('click', () => openAgencyModal(parseInt(btn.dataset.agencyId)))
    })

    container.querySelectorAll('.btn-delete-agency').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm(`¿Eliminar la agencia "${btn.dataset.agencyNombre}"? Esta acción no se puede deshacer.`)) {
          await window.api.invoke('delete-agency', parseInt(btn.dataset.agencyId))
          loadAgencies()
        }
      })
    })
  } catch (err) {
    container.innerHTML = `<div class="text-center py-8 text-red-500 text-xs">Error: ${err.message}</div>`
  }
}

export function initAgencyModal() {
  const modal = document.getElementById('modal-agency')
  const form = document.getElementById('agency-form')

  // btn-new-agency is dynamically injected by loadAgencies — use delegation
  document.getElementById('agencies-list')?.addEventListener('click', (e) => {
    if (e.target.closest('#btn-new-agency')) openAgencyModal(null)
  })
  document.getElementById('btn-close-modal').addEventListener('click', closeModal)
  document.getElementById('btn-cancel-agency').addEventListener('click', closeModal)
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal() })

  document.getElementById('btn-select-logo').addEventListener('click', async () => {
    const filePath = await window.api.invoke('select-logo-file')
    if (filePath) {
      document.getElementById('agency-logo-path').value = filePath
      const preview = document.getElementById('logo-preview')
      preview.innerHTML = `<img src="file://${filePath}" class="w-full h-full object-contain mix-blend-multiply rounded-lg" />`
    }
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const id = document.getElementById('agency-id').value
    const rawLogoPath = document.getElementById('agency-logo-path').value || null

    let logoPath = rawLogoPath

    // Copy logo to userData/logos/ if a new file was selected (not already a saved path)
    if (rawLogoPath && !rawLogoPath.includes('logicompare')) {
      try {
        const originalName = rawLogoPath.split(/[\\/]/).pop()
        const agenciaId = id ? parseInt(id) : 0
        logoPath = await window.api.invoke('save-agency-logo', { agenciaId, srcPath: rawLogoPath, originalName })
      } catch (err) {
        console.warn('No se pudo copiar el logo, se usará la ruta original:', err)
      }
    }

    const data = {
      nombre: document.getElementById('agency-nombre').value.trim(),
      ambito: 'Nacional',
      baremo: parseInt(document.getElementById('agency-baremo').value) || 1,
      recargo_combustible: parseFloat(document.getElementById('agency-recargo-combustible').value) || 0,
      recargo_seguro: parseFloat(document.getElementById('agency-recargo-seguro').value) || 0,
      logo_path: logoPath,
      activa: document.getElementById('agency-activa').checked ? 1 : 0,
    }

    try {
      if (id) {
        await window.api.invoke('update-agency', { id: parseInt(id), data })
      } else {
        const newAgency = await window.api.invoke('create-agency', data)
        // If logo was saved with agenciaId=0, re-save with real ID
        if (rawLogoPath && !rawLogoPath.includes('logicompare') && newAgency?.id) {
          const originalName = rawLogoPath.split(/[\\/]/).pop()
          const finalLogoPath = await window.api.invoke('save-agency-logo', { agenciaId: newAgency.id, srcPath: rawLogoPath, originalName })
          await window.api.invoke('update-agency', { id: newAgency.id, data: { ...data, logo_path: finalLogoPath } })
        }
      }
      closeModal()
      loadAgencies()
    } catch (err) {
      alert(`Error al guardar: ${err.message}`)
    }
  })
}

async function openAgencyModal(agencyId) {
  const modal = document.getElementById('modal-agency')
  const title = document.getElementById('modal-agency-title')
  const tarifasSection = document.getElementById('agency-tarifas-section')
  const tarifasContent = document.getElementById('agency-tarifas-content')

  document.getElementById('agency-form').reset()
  document.getElementById('agency-id').value = ''
  document.getElementById('agency-logo-path').value = ''
  document.getElementById('logo-preview').innerHTML = `<span class="material-symbols-outlined text-on-surface-variant" style="font-size:20px; opacity:0.4;">image</span>`
  tarifasSection.classList.add('hidden')
  tarifasContent.innerHTML = ''

  if (agencyId) {
    title.textContent = 'Editar Agencia'
    try {
      const detail = await window.api.invoke('get-agency-detail', agencyId)
      if (detail) {
        document.getElementById('agency-id').value = detail.agencia.id
        document.getElementById('agency-nombre').value = detail.agencia.nombre
        document.getElementById('agency-baremo').value = detail.agencia.baremo ?? 1
        document.getElementById('agency-recargo-combustible').value = detail.agencia.recargo_combustible ?? 0
        document.getElementById('agency-recargo-seguro').value = detail.agencia.recargo_seguro ?? 0
        document.getElementById('agency-activa').checked = !!detail.agencia.activa
        if (detail.agencia.logo_path) {
          document.getElementById('agency-logo-path').value = detail.agencia.logo_path
          document.getElementById('logo-preview').innerHTML = `<img src="file://${detail.agencia.logo_path}" class="w-full h-full object-contain mix-blend-multiply rounded-lg" />`
        }

        // Load and render tarifas per zone
        if (detail.zonas && detail.zonas.length > 0) {
          tarifasSection.classList.remove('hidden')
          renderTarifasEditor(detail.agencia.id, detail.zonas)
        }
      }
    } catch (err) {
      console.error('Error cargando agencia:', err)
    }
  } else {
    title.textContent = 'Nueva Agencia'
  }

  modal.classList.remove('hidden')
}

async function renderTarifasEditor(agenciaId, zonas) {
  const container = document.getElementById('agency-tarifas-content')
  container.innerHTML = '<p class="text-on-surface-variant opacity-60 text-xs">Cargando tarifas...</p>'

  try {
    const allTarifas = await window.api.invoke('get-tarifas-by-agency', agenciaId)
    const makeLabel = (t) => `${t.kilos_desde}–${t.kilos_hasta} kg`

    container.innerHTML = ''

    for (const zona of zonas) {
      const tarifas = (allTarifas || []).filter(t => t.zona_id === zona.id).sort((a, b) => a.kilos_desde - b.kilos_desde)

      // Summary line (always visible)
      const summary = tarifas.map(t =>
        `${makeLabel(t)}: ${t.precio_base.toFixed(2)}€`
      ).join(' · ')

      const block = document.createElement('div')
      block.className = 'rounded-lg overflow-hidden'
      block.style.border = '1px solid rgba(196,197,217,0.2)'

      // Header row (always visible, click to expand)
      const header = document.createElement('button')
      header.type = 'button'
      header.className = 'w-full flex items-center justify-between px-3 py-2.5 bg-surface-container hover:bg-surface-container-high transition-colors text-left'
      header.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <span class="font-bold text-[11px] uppercase tracking-wide shrink-0">${zona.nombre_zona}</span>
          <span class="text-[10px] text-on-surface-variant opacity-60 truncate hidden sm:block">${summary}</span>
        </div>
        <span class="material-symbols-outlined shrink-0 transition-transform" style="font-size:16px; opacity:0.5;" data-chevron>expand_more</span>
      `

      // Collapsible body (hidden by default)
      const body = document.createElement('div')
      body.className = 'hidden px-3 pb-3 pt-2 bg-surface-container-lowest space-y-2'
      body.style.borderTop = '1px solid rgba(196,197,217,0.15)'

      // kg_adicional row
      const kgRow = document.createElement('div')
      kgRow.className = 'flex items-center justify-between mb-2'
      kgRow.innerHTML = `
        <span class="text-[11px] text-on-surface-variant opacity-70">Precio por kg adicional &gt;${tarifas.length ? tarifas[tarifas.length - 1].kilos_hasta : '?'} kg</span>
        <div class="flex items-center gap-1.5">
          <input type="number" step="0.01" min="0"
            value="${zona.kg_adicional}"
            data-zona-id="${zona.id}" data-field="kg_adicional"
            class="input-field text-right px-2" style="height:26px; width:72px; font-size:12px;" />
          <span class="text-xs opacity-50">€/kg</span>
        </div>
      `
      body.appendChild(kgRow)

      // Tariff rows
      for (const t of tarifas) {
        const row = document.createElement('div')
        row.className = 'flex items-center justify-between'
        row.innerHTML = `
          <span class="text-xs text-on-surface-variant opacity-70">${makeLabel(t)}</span>
          <div class="flex items-center gap-1.5">
            <input type="number" step="0.01" min="0"
              value="${t.precio_base}"
              data-tarifa-id="${t.id}"
              class="input-field text-right px-2" style="height:26px; width:72px; font-size:12px;" />
            <span class="text-xs opacity-50">€</span>
          </div>
        `
        body.appendChild(row)
      }

      // Save button
      const saveBtn = document.createElement('button')
      saveBtn.type = 'button'
      saveBtn.className = 'btn-primary w-full mt-2 py-1.5 text-[11px] font-bold'
      saveBtn.dataset.saveZona = zona.id
      saveBtn.dataset.agenciaId = agenciaId
      saveBtn.textContent = `Guardar ${zona.nombre_zona}`
      body.appendChild(saveBtn)

      // Toggle accordion
      header.addEventListener('click', () => {
        const isOpen = !body.classList.contains('hidden')
        body.classList.toggle('hidden', isOpen)
        const chevron = header.querySelector('[data-chevron]')
        chevron.style.transform = isOpen ? '' : 'rotate(180deg)'
      })

      // Save handler
      saveBtn.addEventListener('click', async () => {
        const zonaId = parseInt(saveBtn.dataset.saveZona)

        const kgInput = body.querySelector(`[data-zona-id="${zonaId}"][data-field="kg_adicional"]`)
        if (kgInput) {
          await window.api.invoke('update-zona-kg-adicional', { zonaId, kgAdicional: parseFloat(kgInput.value) || 0 })
        }

        const tarifasDeEstaZona = (allTarifas || []).filter(t => t.zona_id === zonaId)
        for (const t of tarifasDeEstaZona) {
          const input = body.querySelector(`[data-tarifa-id="${t.id}"]`)
          if (input) {
            await window.api.invoke('update-rate', { id: t.id, precio_base: parseFloat(input.value) || 0 })
          }
        }

        const originalText = saveBtn.textContent
        saveBtn.textContent = '✓ Guardado'
        saveBtn.disabled = true
        setTimeout(() => { saveBtn.textContent = originalText; saveBtn.disabled = false }, 2000)
      })

      block.appendChild(header)
      block.appendChild(body)
      container.appendChild(block)
    }
  } catch (err) {
    container.innerHTML = `<p class="text-red-500 text-xs">Error cargando tarifas: ${err.message}</p>`
  }
}

function closeModal() {
  document.getElementById('modal-agency').classList.add('hidden')
}
