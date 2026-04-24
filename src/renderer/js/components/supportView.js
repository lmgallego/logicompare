import { formatPrice, formatDate } from '../utils/formatters.js'
import { confirmModal, alertModal } from '../utils/modals.js'

let mergedRows = null

export function initSupportView() {
  // DB buttons
  document.getElementById('btn-export-db')?.addEventListener('click', async () => {
    const res = await window.api.invoke('export-db')
    if (res?.ok) {
      showToast('Copia guardada correctamente', 'success')
    } else if (res?.error) {
      showToast('Error: ' + res.error, 'error')
    }
  })

  document.getElementById('btn-import-db')?.addEventListener('click', async () => {
    const ok = await confirmModal('Esto reemplazará la base de datos actual y reiniciará la app.\n¿Continuar?', 'Importar base de datos')
    if (!ok) return
    await window.api.invoke('import-db')
  })

  document.getElementById('btn-db-backup')?.addEventListener('click', async () => {
    const res = await window.api.invoke('db-backup')
    if (res?.ok) {
      showToast(`Copia de seguridad guardada (${formatBytes(res.sizeBytes)})`, 'success')
      loadDbStats()
    } else if (res?.error) {
      showToast('Error: ' + res.error, 'error')
    }
  })

  document.getElementById('btn-db-refresh-stats')?.addEventListener('click', loadDbStats)

  // Parachoques import
  document.getElementById('btn-import-parachoques')?.addEventListener('click', handleParachoquesImport)

  // Merge buttons
  document.getElementById('btn-merge-select')?.addEventListener('click', handleMergeSelect)
  document.getElementById('btn-merge-excel-full')?.addEventListener('click', () => exportMergedExcel(false))
  document.getElementById('btn-merge-excel-simple')?.addEventListener('click', () => exportMergedExcel(true))
  document.getElementById('btn-merge-pdf-full')?.addEventListener('click', () => buildMergedPDF(false))
  document.getElementById('btn-merge-pdf-simple')?.addEventListener('click', () => buildMergedPDF(true))

  // Version
  window.api?.invoke('get-app-version').then(v => {
    const el = document.getElementById('support-version')
    if (el) el.textContent = `V. ${v}`
  }).catch(() => {})

  // Load DB stats on init (also reloads when refreshed)
  loadDbStats()
}

function formatBytes(n) {
  if (n == null) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB'
}

async function loadDbStats() {
  try {
    const s = await window.api.invoke('db-stats')
    if (!s) return

    document.getElementById('db-stat-size').textContent = formatBytes(s.sizeBytes)
    document.getElementById('db-stat-rows').textContent = (s.totalRows || 0).toLocaleString('es-ES')
    document.getElementById('db-stat-cot').textContent  = ((s.counts?.cotizaciones) || 0).toLocaleString('es-ES')
    document.getElementById('db-stat-par').textContent  = ((s.counts?.parachoques) || 0).toLocaleString('es-ES')
    document.getElementById('db-stat-path').textContent = s.dbPath

    // Size warning above 50MB
    const warn = document.getElementById('db-stat-warning')
    const warnText = document.getElementById('db-stat-warning-text')
    if (s.sizeBytes > 50 * 1024 * 1024) {
      warnText.textContent = `La base de datos supera los 50 MB (${formatBytes(s.sizeBytes)}). Considera hacer copia de seguridad periódicamente.`
      warn.classList.remove('hidden')
    } else if (s.sizeBytes > 100 * 1024 * 1024) {
      warnText.textContent = `Base de datos muy grande (${formatBytes(s.sizeBytes)}). Conviene hacer backup urgente.`
      warn.classList.remove('hidden')
    } else {
      warn.classList.add('hidden')
    }

    // Detail per table
    const detail = document.getElementById('db-stat-detail')
    if (detail && s.counts) {
      detail.innerHTML = Object.entries(s.counts).map(([t, n]) =>
        `<div class="flex justify-between gap-2" style="padding:4px 8px;background:rgba(0,0,0,0.03);border-radius:4px;">
          <span style="opacity:0.7;">${t}</span>
          <span style="font-weight:700;">${(n ?? 0).toLocaleString('es-ES')}</span>
        </div>`
      ).join('')
    }
  } catch (err) {
    console.warn('db-stats failed:', err)
  }
}

async function handleParachoquesImport() {
  const statusEl = document.getElementById('parachoques-import-status')
  statusEl.className = 'flex items-center gap-2 text-xs text-on-surface-variant px-1'
  statusEl.innerHTML = '<span class="material-symbols-outlined text-sm" style="animation:spin 1s linear infinite;">progress_activity</span> Leyendo y procesando Excel...'
  statusEl.classList.remove('hidden')

  try {
    const res = await window.api.invoke('import-parachoques-xlsx')
    if (res?.cancelled) {
      statusEl.classList.add('hidden')
      return
    }
    if (!res?.ok) {
      statusEl.className = 'text-xs px-3 py-2 rounded-lg'
      statusEl.style.cssText = 'color:#ba1a1a; background:rgba(186,26,26,0.06);'
      statusEl.textContent = res?.error || 'Operación cancelada.'
      return
    }

    const { summary, warnings } = res
    const warnHtml = warnings && warnings.length
      ? `<details class="text-xs mt-2"><summary style="cursor:pointer;opacity:0.65;">${warnings.length} aviso(s) durante la importación</summary>
           <ul style="list-style:disc;padding-left:1.2rem;margin-top:4px;opacity:0.75;">
             ${warnings.slice(0, 20).map(w => `<li>${w}</li>`).join('')}
             ${warnings.length > 20 ? `<li>… y ${warnings.length - 20} más</li>` : ''}
           </ul></details>`
      : ''

    statusEl.className = 'space-y-2 p-3 rounded-lg'
    statusEl.style.cssText = 'background:rgba(21,128,61,0.06);border:1px solid rgba(21,128,61,0.2);'
    statusEl.innerHTML = `
      <div class="flex items-center gap-2 text-xs font-semibold" style="color:#15803d;">
        <span class="material-symbols-outlined text-sm">check_circle</span>
        Importación completada
      </div>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <div><span style="opacity:0.6;">Leídas</span> <strong class="block">${summary.filasLeidas}</strong></div>
        <div><span style="opacity:0.6;">Nuevas</span> <strong class="block" style="color:#15803d;">${summary.insertadas}</strong></div>
        <div><span style="opacity:0.6;">Actualizadas</span> <strong class="block" style="color:#0040e0;">${summary.actualizadas}</strong></div>
        <div><span style="opacity:0.6;">Eliminadas</span> <strong class="block" style="color:#ba1a1a;">${summary.eliminadas}</strong></div>
      </div>
      <p class="text-[11px]" style="opacity:0.65;">Total en BD: <strong>${summary.antesTotal}</strong> → <strong>${summary.ahoraTotal}</strong> referencias</p>
      ${warnHtml}
    `

    loadDbStats()
  } catch (err) {
    statusEl.className = 'text-xs px-3 py-2 rounded-lg'
    statusEl.style.cssText = 'color:#ba1a1a; background:rgba(186,26,26,0.06);'
    statusEl.textContent = 'Error: ' + err.message
  }
}

async function handleMergeSelect() {
  const statusEl = document.getElementById('merge-status')
  const actionsEl = document.getElementById('merge-actions')

  statusEl.className = 'flex items-center gap-2 text-xs text-on-surface-variant px-1'
  statusEl.innerHTML = '<span class="material-symbols-outlined text-sm" style="animation:spin 1s linear infinite;">progress_activity</span> Leyendo archivos...'
  statusEl.classList.remove('hidden')
  actionsEl.classList.add('hidden')
  mergedRows = null

  const res = await window.api.invoke('merge-excels')

  if (!res?.ok) {
    statusEl.className = 'text-xs px-1 py-2 rounded-lg'
    statusEl.style.cssText = 'color:#ba1a1a; background:rgba(186,26,26,0.06);'
    statusEl.textContent = res?.error || 'Operación cancelada.'
    return
  }

  mergedRows = res.rows

  // Build summary
  const groups = {}
  mergedRows.forEach(r => {
    const k = r.agencia_nombre || 'Sin agencia'
    if (!groups[k]) groups[k] = { count: 0, total: 0 }
    groups[k].count++
    groups[k].total += r.precio_final || 0
  })

  const lines = Object.entries(groups)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, g]) =>
      `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold" style="background:rgba(0,64,224,0.1);color:#0040e0;">
        ${name} — ${g.count} cotiz. · ${formatPrice(g.total)}
      </span>`
    ).join(' ')

  statusEl.className = 'space-y-2'
  statusEl.style.cssText = ''
  statusEl.innerHTML = `
    <div class="flex items-center gap-2 text-xs font-semibold" style="color:#15803d;">
      <span class="material-symbols-outlined text-sm">check_circle</span>
      ${res.count} cotizaciones consolidadas (duplicados eliminados)
    </div>
    <div class="flex flex-wrap gap-1.5">${lines}</div>
  `

  actionsEl.classList.remove('hidden')
  actionsEl.classList.add('flex')
}

async function exportMergedExcel(simplificada) {
  if (!mergedRows) return
  const res = await window.api.invoke('export-merged-xlsx', { rows: mergedRows, simplificada })
  if (res?.ok) {
    showToast('Excel guardado correctamente', 'success')
  } else if (res?.error) {
    showToast('Error: ' + res.error, 'error')
  }
}

function redondear5(precio) {
  if (precio == null) return null
  return Math.ceil(precio * 20) / 20
}

function buildMergedPDF(simplificada) {
  if (!mergedRows || !mergedRows.length) return
  const win = window.open('', '_blank', 'width=900,height=700')

  // Group by agency, each sorted by date
  const groups = []
  const groupMap = {}
  mergedRows.forEach(r => {
    const key = r.agencia_nombre || 'Sin agencia'
    if (!groupMap[key]) { groupMap[key] = []; groups.push(key) }
    groupMap[key].push(r)
  })

  const renderGroup = (agName, rows) => {
    let head, body
    if (simplificada) {
      head = '<tr><th>Fecha</th><th style="text-align:right">Precio Final</th><th style="text-align:right">Precio Redondeado</th></tr>'
      body = rows.map((r, i) => {
        const red = r.precio_redondeado || redondear5(r.precio_final)
        return '<tr style="background:' + (i % 2 === 0 ? '#f8f9fb' : '#fff') + '">'
          + '<td>' + r.fecha + '</td>'
          + '<td style="text-align:right"><strong>' + formatPrice(r.precio_final) + '</strong></td>'
          + '<td style="text-align:right"><strong style="color:#15803d">' + formatPrice(red) + '</strong></td>'
          + '</tr>'
      }).join('')
    } else {
      head = '<tr><th>Fecha</th><th>Medidas</th><th>CP</th><th>m³</th><th>Peso</th><th style="text-align:right">Precio Final</th><th style="text-align:right">P. Redondeado</th></tr>'
      body = rows.map((r, i) => {
        const red = r.precio_redondeado || redondear5(r.precio_final)
        return '<tr style="background:' + (i % 2 === 0 ? '#f8f9fb' : '#fff') + '">'
          + '<td>' + r.fecha + '</td>'
          + '<td>' + (r.medidas || '—') + '</td>'
          + '<td>' + (r.cp_prefix || '—') + '</td>'
          + '<td>' + (r.metros_cubicos ? Number(r.metros_cubicos).toFixed(3).replace('.', ',') + ' m³' : '—') + '</td>'
          + '<td><strong>' + (r.peso ? r.peso + ' kg' : '—') + '</strong></td>'
          + '<td style="text-align:right"><strong>' + formatPrice(r.precio_final) + '</strong></td>'
          + '<td style="text-align:right"><strong style="color:#15803d">' + formatPrice(red) + '</strong></td>'
          + '</tr>'
      }).join('')
    }

    const agHeader = '<div style="margin:18px 0 10px; padding:8px 14px; background:#0040e0; color:white; border-radius:6px; font-size:14px; font-weight:bold;">'
      + agName + ' <span style="font-size:10px; font-weight:normal; opacity:0.75;">(' + rows.length + ' cotizacion' + (rows.length !== 1 ? 'es' : '') + ')</span></div>'

    return agHeader + '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
  }

  const allSections = groups.map(ag => renderGroup(ag, groupMap[ag])).join('')
  const totalRows = mergedRows.length
  const totalIngresos = mergedRows.reduce((s, r) => s + (r.precio_final || 0), 0)

  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Historial Consolidado — LogiCompare</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;font-size:11px;margin:20px}'
    + 'h2{color:#0040e0;margin-bottom:4px}'
    + 'table{border-collapse:collapse;width:100%;margin-bottom:8px}'
    + 'th{background:#0040e0;color:white;padding:6px 8px;text-align:left;font-size:10px}'
    + 'td{padding:5px 8px;border-bottom:1px solid #e8eaf0}'
    + '.summary{background:#f0f4ff;border:1px solid #c7d7fb;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:11px;}'
    + '@media print{button{display:none}}'
    + '</style></head><body>'
    + '<h2>Historial Consolidado — LogiCompare</h2>'
    + '<p style="font-size:10px;color:#666;margin-bottom:8px">Generado: ' + new Date().toLocaleString('es-ES') + ' · ' + groups.length + ' agencias · ' + totalRows + ' cotizaciones · ' + formatPrice(totalIngresos) + ' total</p>'
    + '<div class="summary"><strong>' + totalRows + '</strong> cotizaciones de <strong>' + groups.length + '</strong> agencias · Facturación total: <strong style="color:#15803d">' + formatPrice(totalIngresos) + '</strong></div>'
    + allSections
    + '<div style="margin-top:24px;text-align:center;">'
    + '<button onclick="window.print()" style="background:#0040e0;color:white;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-size:12px;">Imprimir / Guardar PDF</button>'
    + '</div></body></html>')
  win.document.close()
}

function showToast(msg, type = 'success') {
  const toast = document.createElement('div')
  toast.className = 'fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg flex items-center gap-2'
  toast.style.cssText = type === 'success'
    ? 'background:#15803d;color:white;'
    : 'background:#ba1a1a;color:white;'
  toast.innerHTML = `<span class="material-symbols-outlined text-base">${type === 'success' ? 'check_circle' : 'error'}</span>${msg}`
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 3500)
}
