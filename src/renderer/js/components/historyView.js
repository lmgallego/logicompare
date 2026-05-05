import { formatPrice, formatDate, formatDimensions, formatVolume } from '../utils/formatters.js'
import { confirmModal, alertModal, showFormModal, pickClienteModal } from '../utils/modals.js'

let currentRows = []
let pendingExportFormat = null  // 'excel' | 'pdf'

function normalizeAgencia(nombre) {
  if (!nombre) return 'Sin agencia'
  return nombre.replace(/\s*\((Palet|Bulto|Palets|Bultos)\)\s*$/i, '').trim()
}

function redondear5(precio) {
  if (precio == null) return null
  return Math.ceil(precio * 20) / 20
}

function formatRounded(precio) {
  const r = redondear5(precio)
  return r != null ? formatPrice(r) : '—'
}

export async function loadHistory(desde, hasta, agenciaId) {
  const tbody = document.getElementById('history-table-body')
  const colCount = 10
  tbody.innerHTML = '<tr><td colspan="' + colCount + '" class="text-center py-8 text-on-surface-variant text-xs" style="opacity:0.5;">Cargando...</td></tr>'

  if (!window.api) {
    tbody.innerHTML = '<tr><td colspan="' + colCount + '" class="text-center py-8 text-on-surface-variant text-xs" style="opacity:0.5;">Sin conexión IPC.</td></tr>'
    return
  }

  try {
    const rows = await window.api.invoke('get-history', {
      desde: desde || null,
      hasta: hasta || null,
      agenciaId: agenciaId ? parseInt(agenciaId) : null,
    })
    currentRows = rows || []
    renderTable(tbody, colCount)
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="' + colCount + '" class="text-center py-8 text-red-500 text-xs">Error: ' + err.message + '</td></tr>'
  }
}

function renderTable(tbody, colCount) {
  if (!currentRows.length) {
    tbody.innerHTML = '<tr><td colspan="' + colCount + '" class="text-center py-12 text-on-surface-variant text-xs" style="opacity:0.5;">No hay cotizaciones en el historial.</td></tr>'
    return
  }

  tbody.innerHTML = ''
  currentRows.forEach((row, idx) => {
    const redondeado = row.precio_redondeado != null ? row.precio_redondeado : redondear5(row.precio_final)
    const tr = document.createElement('tr')
    tr.className = 'transition-colors ' + (idx % 2 === 0 ? 'bg-surface-container-lowest' : '') + ' hover:bg-surface-container-low'
    tr.dataset.id = row.id
    const clienteCell = row.cliente_razon_social
      ? '<div class="text-xs font-semibold truncate" style="max-width:200px;" title="' + row.cliente_razon_social + '">' + row.cliente_razon_social + '</div>'
        + '<div class="text-[10px] font-mono" style="opacity:0.5;">' + (row.cliente_codigo || '') + '</div>'
      : (row.cliente_codigo
          ? '<div class="text-[10px] font-mono" style="opacity:0.65;">' + row.cliente_codigo + '</div><div class="text-[10px]" style="opacity:0.4;">sin razón social</div>'
          : '<span class="text-xs" style="opacity:0.35;">—</span>')
    tr.innerHTML = '<td class="px-4 py-3 text-xs text-on-surface-variant">' + formatDate(row.fecha) + '</td>'
      + '<td class="px-4 py-3">' + clienteCell + '</td>'
      + '<td class="px-4 py-3 text-xs font-medium">' + formatDimensions(row.largo_cm, row.ancho_cm, row.alto_cm) + ' cm</td>'
      + '<td class="px-4 py-3 text-xs font-medium">' + row.cp_prefix + '</td>'
      + '<td class="px-4 py-3 text-xs">' + formatVolume(row.metros_cubicos) + '</td>'
      + '<td class="px-4 py-3 text-xs font-bold text-primary">' + (row.peso != null ? row.peso + ' kg' : '—') + '</td>'
      + '<td class="px-4 py-3 text-xs">' + (row.agencia_nombre || '—') + '</td>'
      + '<td class="px-4 py-3 text-right"><span class="text-sm font-black text-primary">' + formatPrice(row.precio_final) + '</span></td>'
      + '<td class="px-4 py-3 text-right"><span class="text-sm font-bold" style="color:#15803d;">' + formatPrice(redondeado) + '</span></td>'
      + '<td class="px-3 py-3 text-center">'
      + '<div class="flex items-center justify-center gap-1">'
      + '<button class="btn-edit-row w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-blue-100" title="Editar esta fila" data-row-id="' + row.id + '">'
      + '<span class="material-symbols-outlined" style="font-size:15px; color:#0040e0;">edit</span>'
      + '</button>'
      + '<button class="btn-delete-row w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-red-100" title="Borrar esta fila" data-row-id="' + row.id + '">'
      + '<span class="material-symbols-outlined" style="font-size:15px; color:#ba1a1a;">delete</span>'
      + '</button>'
      + '</div></td>'

    tbody.appendChild(tr)

    tr.querySelector('.btn-delete-row').addEventListener('click', async () => {
      const ok = await confirmModal(
        '¿Borrar esta cotización (' + formatDate(row.fecha) + ' · ' + (row.agencia_nombre || '—') + ')?\nUna vez borrada no aparecerá en las exportaciones.',
        'Borrar cotización'
      )
      if (!ok) return
      try {
        await window.api.invoke('delete-quote-by-id', { id: row.id })
        currentRows = currentRows.filter(r => r.id !== row.id)
        renderTable(tbody, colCount)
      } catch (err) {
        alertModal('Error al borrar: ' + err.message, 'Error')
      }
    })

    tr.querySelector('.btn-edit-row').addEventListener('click', async () => {
      await openEditModal(row, tbody, colCount)
    })
  })
}

async function getAgenciesOptions() {
  try {
    const list = await window.api.invoke('get-agencies-simple')
    return [
      { value: '', label: '— Sin agencia —' },
      ...list.map(a => ({ value: String(a.id), label: a.nombre }))
    ]
  } catch (_) {
    return [{ value: '', label: '— Sin agencia —' }]
  }
}

async function openEditModal(row, tbody, colCount) {
  const agencyOptions = await getAgenciesOptions()
  // ISO date slice for date picker (fecha stored as 'YYYY-MM-DD HH:MM:SS')
  const fechaDate = (row.fecha || '').slice(0, 10)

  // Cliente seleccionable a través de un picker. Guardamos el actual aquí.
  let pickedCliente = row.cliente_codigo
    ? { codigo: row.cliente_codigo, razon_social: row.cliente_razon_social || '' }
    : null

  const clienteLabel = () => pickedCliente
    ? `${pickedCliente.razon_social || '(sin razón social)'} · cód. ${pickedCliente.codigo}`
    : '— sin cliente —'

  const result = await showFormModal({
    title: 'Editar cotización',
    subtitle: 'Modifica los datos y pulsa Guardar',
    submitLabel: 'Guardar cambios',
    fields: [
      { name: 'fecha',         label: 'Fecha',           type: 'date',   value: fechaDate, required: true },
      { name: 'cliente',       label: 'Cliente',         type: 'cliente', value: pickedCliente,
        onPick: (c) => { pickedCliente = c }, getLabel: clienteLabel },
      { name: 'largoCm',       label: 'Largo (cm)',      type: 'number', value: row.largo_cm, step: '0.1', min: 0, required: true },
      { name: 'anchoCm',       label: 'Ancho (cm)',      type: 'number', value: row.ancho_cm, step: '0.1', min: 0, required: true },
      { name: 'altoCm',        label: 'Alto (cm)',       type: 'number', value: row.alto_cm,  step: '0.1', min: 0, required: true },
      { name: 'cpPrefix',      label: 'CP (2 dígitos)',  type: 'text',   value: row.cp_prefix, required: true },
      { name: 'peso',          label: 'Peso (kg)',       type: 'number', value: row.peso ?? 0, step: '0.01', min: 0 },
      { name: 'metrosCubicos', label: 'Metros cúbicos',  type: 'number', value: row.metros_cubicos ?? 0, step: '0.000001', min: 0 },
      { name: 'agenciaId',     label: 'Agencia',         type: 'select', value: row.agencia_id ? String(row.agencia_id) : '', options: agencyOptions },
      { name: 'precioFinal',   label: 'Precio final (€)', type: 'number', value: row.precio_final ?? 0, step: '0.01', min: 0, required: true },
    ],
  })

  if (!result) return

  try {
    const res = await window.api.invoke('update-quote', {
      id: row.id,
      fecha: result.fecha ? (result.fecha + ' ' + ((row.fecha || '').slice(11, 19) || '12:00:00')) : null,
      largoCm: parseFloat(result.largoCm),
      anchoCm: parseFloat(result.anchoCm),
      altoCm:  parseFloat(result.altoCm),
      cpPrefix: String(result.cpPrefix).trim().padStart(2, '0').slice(0, 2),
      peso: parseFloat(result.peso) || 0,
      metrosCubicos: parseFloat(result.metrosCubicos) || 0,
      agenciaId: result.agenciaId ? parseInt(result.agenciaId) : null,
      precioFinal: parseFloat(result.precioFinal),
      clienteCodigo: pickedCliente ? pickedCliente.codigo : null,
    })
    if (!res.ok) throw new Error(res.error || 'No se pudo actualizar')
    // Reload current filters
    const desde = document.getElementById('history-desde')?.value || null
    const hasta = document.getElementById('history-hasta')?.value || null
    const agenciaId = document.getElementById('history-agencia')?.value || null
    await loadHistory(desde, hasta, agenciaId)
  } catch (err) {
    alertModal('Error al actualizar: ' + err.message, 'Error')
  }
}

export async function initHistoryControls() {
  const btnFilter   = document.getElementById('btn-history-filter')
  const btnReset    = document.getElementById('btn-history-reset')
  const btnExcel    = document.getElementById('btn-export-excel')
  const btnPdf      = document.getElementById('btn-export-pdf')
  const btnDelete   = document.getElementById('btn-delete-history')
  const inputDesde  = document.getElementById('history-desde')
  const inputHasta  = document.getElementById('history-hasta')
  const selectAgencia = document.getElementById('history-agencia')

  // Populate agency filter select
  if (window.api && selectAgencia) {
    try {
      const agencies = await window.api.invoke('get-agencies-simple')
      agencies.forEach(a => {
        const opt = document.createElement('option')
        opt.value = a.id
        opt.textContent = a.nombre
        selectAgencia.appendChild(opt)
      })
    } catch (_) {}
  }

  const getFilters = () => ({
    desde: inputDesde?.value || null,
    hasta: inputHasta?.value || null,
    agenciaId: selectAgencia?.value || null,
  })

  btnFilter?.addEventListener('click', () => {
    const f = getFilters()
    loadHistory(f.desde, f.hasta, f.agenciaId)
  })

  btnReset?.addEventListener('click', () => {
    if (inputDesde) inputDesde.value = ''
    if (inputHasta) inputHasta.value = ''
    if (selectAgencia) selectAgencia.value = ''
    loadHistory()
  })

  // Export buttons open modal
  btnExcel?.addEventListener('click', () => openExportModal('excel'))
  btnPdf?.addEventListener('click', () => openExportModal('pdf'))

  // Export modal buttons
  document.getElementById('btn-close-export-modal')?.addEventListener('click', closeExportModal)
  document.getElementById('modal-export')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-export')) closeExportModal()
  })
  document.getElementById('btn-export-completa')?.addEventListener('click', () => {
    const fmt = pendingExportFormat
    closeExportModal()
    if (fmt === 'excel') buildXLSX(false)
    else buildPDF(false)
  })
  document.getElementById('btn-export-simplificada')?.addEventListener('click', () => {
    const fmt = pendingExportFormat
    closeExportModal()
    if (fmt === 'excel') buildXLSX(true)
    else buildPDF(true)
  })

  btnDelete?.addEventListener('click', async () => {
    const f = getFilters()
    const rango = f.desde || f.hasta
      ? 'entre ' + (f.desde || '…') + ' y ' + (f.hasta || '…')
      : 'TODO el historial'
    const ok = await confirmModal('¿Borrar cotizaciones ' + rango + '?\nEsta acción no se puede deshacer.', 'Borrar cotizaciones')
    if (!ok) return
    try {
      const res = await window.api.invoke('delete-history', { desde: f.desde, hasta: f.hasta })
      await alertModal(res.deleted + ' cotización(es) eliminada(s).', 'Hecho')
      loadHistory(f.desde, f.hasta, f.agenciaId)
    } catch (err) {
      alertModal('Error al borrar: ' + err.message, 'Error')
    }
  })
}

function openExportModal(format) {
  if (!currentRows.length) { alertModal('No hay datos para exportar.', 'Aviso'); return }
  pendingExportFormat = format
  const title = document.getElementById('modal-export-title')
  if (title) title.textContent = format === 'excel' ? 'Exportar a Excel' : 'Exportar a PDF'
  document.getElementById('modal-export')?.classList.remove('hidden')
}

function closeExportModal() {
  document.getElementById('modal-export')?.classList.add('hidden')
  pendingExportFormat = null
}

// ── XLSX ─────────────────────────────────────────────────────────────────────
function buildXLSX(simplificada) {
  if (!currentRows.length) return

  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Group rows by agency name (preserve insertion order)
  const groups = []
  const groupMap = {}
  currentRows.forEach(r => {
    const key = normalizeAgencia(r.agencia_nombre)
    if (!groupMap[key]) {
      groupMap[key] = []
      groups.push(key)
    }
    groupMap[key].push(r)
  })

  const makeSheetXml = (rows, numCols, headers) => {
    const allRows = [headers, ...rows]
    const sheetRows = allRows.map((row, ri) =>
      '<row r="' + (ri + 1) + '">' + row.map((cell, ci) => {
        const col = String.fromCharCode(65 + ci)
        const ref = col + (ri + 1)
        const isNum = ri > 0 && numCols.includes(ci)
        if (isNum) return '<c r="' + ref + '"><v>' + esc(cell) + '</v></c>'
        return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(cell) + '</t></is></c>'
      }).join('') + '</row>'
    ).join('')
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData>' + sheetRows + '</sheetData></worksheet>'
  }

  const files = {}
  let sheetEls = ''
  let wbRelEls = ''
  let ctOverrides = ''

  groups.forEach((agName, i) => {
    const idx = i + 1
    const sheetName = agName.replace(/[\\/*?:\[\]]/g, '').slice(0, 31)
    const rows = groupMap[agName]
    let headers, numCols, dataRows

    if (simplificada) {
      headers = ['Fecha', 'Precio Final (€)', 'Precio Redondeado (€)']
      numCols = [1, 2]
      dataRows = rows.map(r => {
        const red = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
        return [formatDate(r.fecha), (r.precio_final ?? 0).toFixed(2), (red ?? 0).toFixed(2)]
      })
    } else {
      headers = ['Fecha', 'Cód. Cliente', 'Cliente', 'Medidas (cm)', 'CP', 'Metros Cúbicos', 'Peso (kg)', 'Agencia', 'Precio Final (€)', 'Precio Redondeado (€)']
      numCols = [6, 8, 9]
      dataRows = rows.map(r => {
        const red = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
        return [formatDate(r.fecha), r.cliente_codigo || '', r.cliente_razon_social || '',
          r.largo_cm + 'x' + r.ancho_cm + 'x' + r.alto_cm, r.cp_prefix,
          (r.metros_cubicos ?? 0).toFixed(6), r.peso ?? 0, r.agencia_nombre || '',
          (r.precio_final ?? 0).toFixed(2), (red ?? 0).toFixed(2)]
      })
    }

    files['xl/worksheets/sheet' + idx + '.xml'] = makeSheetXml(dataRows, numCols, headers)
    sheetEls += '<sheet name="' + esc(sheetName) + '" sheetId="' + idx + '" r:id="rId' + idx + '"/>'
    wbRelEls += '<Relationship Id="rId' + idx + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + idx + '.xml"/>'
    ctOverrides += '<Override PartName="/xl/worksheets/sheet' + idx + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  })

  files['xl/workbook.xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets>' + sheetEls + '</sheets></workbook>'

  files['xl/_rels/workbook.xml.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + wbRelEls + '</Relationships>'

  files['[Content_Types].xml'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + ctOverrides + '</Types>'

  files['_rels/.rels'] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>'

  const suffix = simplificada ? '_simplificado' : '_completo'
  window.api.invoke('export-xlsx', {
    filename: 'historial' + suffix + '_' + new Date().toISOString().slice(0, 10) + '.xlsx',
    files,
  })
}

// ── PDF ──────────────────────────────────────────────────────────────────────
function buildPDF(simplificada) {
  if (!currentRows.length) return
  const win = window.open('', '_blank', 'width=900,height=700')

  // Group rows by agency
  const groups = []
  const groupMap = {}
  currentRows.forEach(r => {
    const key = normalizeAgencia(r.agencia_nombre)
    if (!groupMap[key]) { groupMap[key] = []; groups.push(key) }
    groupMap[key].push(r)
  })

  const multiAgency = groups.length > 1

  const renderGroup = (agName, rows) => {
    let head, body
    if (simplificada) {
      head = '<tr><th>Fecha</th><th style="text-align:right">Precio Final</th><th style="text-align:right">Precio Redondeado</th></tr>'
      body = rows.map((r, i) => {
        const red = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
        return '<tr style="background:' + (i % 2 === 0 ? '#f8f9fb' : '#fff') + '">'
          + '<td>' + formatDate(r.fecha) + '</td>'
          + '<td style="text-align:right"><strong>' + formatPrice(r.precio_final) + '</strong></td>'
          + '<td style="text-align:right"><strong style="color:#15803d">' + formatPrice(red) + '</strong></td>'
          + '</tr>'
      }).join('')
    } else {
      head = '<tr><th>Fecha</th><th>Cliente</th><th>Medidas</th><th>CP</th><th>m³</th><th>Peso</th><th style="text-align:right">Precio Final</th><th style="text-align:right">P. Redondeado</th></tr>'
      body = rows.map((r, i) => {
        const red = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
        const clienteHtml = r.cliente_razon_social
          ? '<div style="font-weight:bold;">' + r.cliente_razon_social + '</div><div style="font-size:9px;color:#666;">cód. ' + (r.cliente_codigo || '') + '</div>'
          : (r.cliente_codigo ? '<div style="font-size:10px;color:#666;">cód. ' + r.cliente_codigo + '</div>' : '<span style="opacity:0.4">—</span>')
        return '<tr style="background:' + (i % 2 === 0 ? '#f8f9fb' : '#fff') + '">'
          + '<td>' + formatDate(r.fecha) + '</td>'
          + '<td>' + clienteHtml + '</td>'
          + '<td>' + r.largo_cm + '×' + r.ancho_cm + '×' + r.alto_cm + ' cm</td>'
          + '<td>' + r.cp_prefix + '</td>'
          + '<td>' + (r.metros_cubicos ?? 0).toFixed(3).replace('.', ',') + ' m³</td>'
          + '<td><strong>' + (r.peso ?? 0) + ' kg</strong></td>'
          + '<td style="text-align:right"><strong>' + formatPrice(r.precio_final) + '</strong></td>'
          + '<td style="text-align:right"><strong style="color:#15803d">' + formatPrice(red) + '</strong></td>'
          + '</tr>'
      }).join('')
    }

    const agHeader = '<div style="margin:' + (multiAgency ? '18px' : '10px') + ' 0 10px; padding:8px 14px; background:#0040e0; color:white; border-radius:6px; font-size:14px; font-weight:bold;">'
      + agName + ' <span style="font-size:10px; font-weight:normal; opacity:0.75;">(' + rows.length + ' cotizacion' + (rows.length !== 1 ? 'es' : '') + ')</span></div>'

    return agHeader + '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
  }

  const allSections = groups.map(ag => renderGroup(ag, groupMap[ag])).join('')

  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Historial de Cotizaciones</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;font-size:11px;margin:20px}'
    + 'h2{color:#0040e0;margin-bottom:4px}'
    + 'table{border-collapse:collapse;width:100%;margin-bottom:8px}'
    + 'th{background:#0040e0;color:white;padding:6px 8px;text-align:left;font-size:10px}'
    + 'td{padding:5px 8px;border-bottom:1px solid #e8eaf0}'
    + '@media print{button{display:none}}'
    + '</style></head><body>'
    + '<h2>Historial de Cotizaciones — LogiCompare</h2>'
    + '<p style="font-size:10px;color:#666;margin-bottom:8px">Generado: ' + new Date().toLocaleString('es-ES') + '</p>'
    + allSections
    + '<br/><button onclick="window.print()" style="margin-top:12px;padding:6px 16px;background:#0040e0;color:white;border:none;border-radius:4px;cursor:pointer;font-size:11px;">🖨 Imprimir / Guardar PDF</button>'
    + '</body></html>')
  win.document.close()
}
