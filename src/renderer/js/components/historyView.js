import { formatPrice, formatDate, formatDimensions, formatVolume } from '../utils/formatters.js'

let currentRows = []
let pendingExportFormat = null  // 'excel' | 'pdf'

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
  const colCount = 8
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

    if (!currentRows.length) {
      tbody.innerHTML = '<tr><td colspan="' + colCount + '" class="text-center py-12 text-on-surface-variant text-xs" style="opacity:0.5;">No hay cotizaciones en el historial.</td></tr>'
      return
    }

    tbody.innerHTML = currentRows.map((row, idx) => {
      const redondeado = row.precio_redondeado != null ? row.precio_redondeado : redondear5(row.precio_final)
      return '<tr class="transition-colors ' + (idx % 2 === 0 ? 'bg-surface-container-lowest' : '') + ' hover:bg-surface-container-low">'
        + '<td class="px-4 py-3 text-xs text-on-surface-variant">' + formatDate(row.fecha) + '</td>'
        + '<td class="px-4 py-3 text-xs font-medium">' + formatDimensions(row.largo_cm, row.ancho_cm, row.alto_cm) + ' cm</td>'
        + '<td class="px-4 py-3 text-xs font-medium">' + row.cp_prefix + '</td>'
        + '<td class="px-4 py-3 text-xs">' + formatVolume(row.metros_cubicos) + '</td>'
        + '<td class="px-4 py-3 text-xs font-bold text-primary">' + (row.peso != null ? row.peso + ' kg' : '—') + '</td>'
        + '<td class="px-4 py-3 text-xs">' + (row.agencia_nombre || '—') + '</td>'
        + '<td class="px-4 py-3 text-right"><span class="text-sm font-black text-primary">' + formatPrice(row.precio_final) + '</span></td>'
        + '<td class="px-4 py-3 text-right"><span class="text-sm font-bold" style="color:#15803d;">' + formatPrice(redondeado) + '</span></td>'
        + '</tr>'
    }).join('')
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-red-500 text-xs">Error: ' + err.message + '</td></tr>'
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
    if (!confirm('¿Borrar cotizaciones ' + rango + '? Esta acción no se puede deshacer.')) return
    try {
      const res = await window.api.invoke('delete-history', { desde: f.desde, hasta: f.hasta })
      alert(res.deleted + ' cotización(es) eliminada(s).')
      loadHistory(f.desde, f.hasta, f.agenciaId)
    } catch (err) {
      alert('Error al borrar: ' + err.message)
    }
  })
}

function openExportModal(format) {
  if (!currentRows.length) { alert('No hay datos para exportar.'); return }
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

  let headers, dataRows, numCols
  if (simplificada) {
    headers = ['Fecha', 'Precio Final (€)', 'Precio Redondeado (€)']
    numCols = [1, 2]
    dataRows = currentRows.map(r => {
      const redondeado = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
      return [formatDate(r.fecha), (r.precio_final ?? 0).toFixed(2), (redondeado ?? 0).toFixed(2)]
    })
  } else {
    headers = ['Fecha', 'Medidas (cm)', 'CP', 'Metros Cúbicos', 'Peso (kg)', 'Agencia', 'Precio Final (€)', 'Precio Redondeado (€)']
    numCols = [4, 6, 7]
    dataRows = currentRows.map(r => {
      const redondeado = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
      return [
        formatDate(r.fecha),
        r.largo_cm + 'x' + r.ancho_cm + 'x' + r.alto_cm,
        r.cp_prefix,
        (r.metros_cubicos ?? 0).toFixed(6),
        r.peso ?? 0,
        r.agencia_nombre || '',
        (r.precio_final ?? 0).toFixed(2),
        (redondeado ?? 0).toFixed(2),
      ]
    })
  }

  const allRows = [headers, ...dataRows]
  const sheetRows = allRows.map((row, ri) =>
    '<row r="' + (ri + 1) + '">' + row.map((cell, ci) => {
      const col = String.fromCharCode(65 + ci)
      const ref = col + (ri + 1)
      const isNum = ri > 0 && numCols.includes(ci)
      if (isNum) return '<c r="' + ref + '"><v>' + esc(cell) + '</v></c>'
      return '<c r="' + ref + '" t="inlineStr"><is><t>' + esc(cell) + '</t></is></c>'
    }).join('') + '</row>'
  ).join('')

  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<sheetData>' + sheetRows + '</sheetData></worksheet>'

  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + '<sheets><sheet name="Historial" sheetId="1" r:id="rId1"/></sheets></workbook>'

  const wbRel = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '</Relationships>'

  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '</Types>'

  const topRel = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>'

  const suffix = simplificada ? '_simplificado' : '_completo'
  window.api.invoke('export-xlsx', {
    filename: 'historial' + suffix + '_' + new Date().toISOString().slice(0, 10) + '.xlsx',
    files: {
      '[Content_Types].xml': ct,
      '_rels/.rels': topRel,
      'xl/workbook.xml': wb,
      'xl/_rels/workbook.xml.rels': wbRel,
      'xl/worksheets/sheet1.xml': sheet,
    },
  })
}

// ── PDF ──────────────────────────────────────────────────────────────────────
function buildPDF(simplificada) {
  if (!currentRows.length) return
  const win = window.open('', '_blank', 'width=900,height=700')

  // Detect if filtered to a single agency
  const agencias = [...new Set(currentRows.map(r => r.agencia_nombre).filter(Boolean))]
  const agenciaUnica = agencias.length === 1 ? agencias[0] : null

  let tableHead, tableBody
  if (simplificada) {
    tableHead = '<tr><th>Fecha</th><th style="text-align:right">Precio Final</th><th style="text-align:right">Precio Redondeado</th></tr>'
    tableBody = currentRows.map((r, i) => {
      const redondeado = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
      return '<tr style="background:' + (i % 2 === 0 ? '#f8f9fb' : '#fff') + '">'
        + '<td>' + formatDate(r.fecha) + '</td>'
        + '<td style="text-align:right"><strong>' + formatPrice(r.precio_final) + '</strong></td>'
        + '<td style="text-align:right"><strong style="color:#15803d">' + formatPrice(redondeado) + '</strong></td>'
        + '</tr>'
    }).join('')
  } else {
    tableHead = '<tr><th>Fecha</th><th>Medidas</th><th>CP</th><th>m³</th><th>Peso</th><th>Agencia</th><th style="text-align:right">Precio Final</th><th style="text-align:right">P. Redondeado</th></tr>'
    tableBody = currentRows.map((r, i) => {
      const redondeado = r.precio_redondeado != null ? r.precio_redondeado : redondear5(r.precio_final)
      return '<tr style="background:' + (i % 2 === 0 ? '#f8f9fb' : '#fff') + '">'
        + '<td>' + formatDate(r.fecha) + '</td>'
        + '<td>' + r.largo_cm + '×' + r.ancho_cm + '×' + r.alto_cm + ' cm</td>'
        + '<td>' + r.cp_prefix + '</td>'
        + '<td>' + (r.metros_cubicos ?? 0).toFixed(3).replace('.', ',') + ' m³</td>'
        + '<td><strong>' + (r.peso ?? 0) + ' kg</strong></td>'
        + '<td>' + (r.agencia_nombre || '—') + '</td>'
        + '<td style="text-align:right"><strong>' + formatPrice(r.precio_final) + '</strong></td>'
        + '<td style="text-align:right"><strong style="color:#15803d">' + formatPrice(redondeado) + '</strong></td>'
        + '</tr>'
    }).join('')
  }

  const agenciaHeader = agenciaUnica
    ? '<div style="margin:10px 0 14px; padding:10px 14px; background:#0040e0; color:white; border-radius:8px; font-size:16px; font-weight:bold; letter-spacing:0.5px;">'
      + '<span style="font-size:11px; font-weight:normal; opacity:0.8; display:block; margin-bottom:2px;">Agencia seleccionada</span>'
      + agenciaUnica
      + '</div>'
    : ''

  win.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Historial de Cotizaciones</title>'
    + '<style>'
    + 'body{font-family:Arial,sans-serif;font-size:11px;margin:20px}'
    + 'h2{color:#0040e0;margin-bottom:6px}'
    + 'table{border-collapse:collapse;width:100%}'
    + 'th{background:#0040e0;color:white;padding:6px 8px;text-align:left;font-size:10px}'
    + 'td{padding:5px 8px;border-bottom:1px solid #e8eaf0}'
    + '@media print{button{display:none}}'
    + '</style></head><body>'
    + '<h2>Historial de Cotizaciones — LogiCompare</h2>'
    + '<p style="font-size:10px;color:#666;margin-bottom:4px">Generado: ' + new Date().toLocaleString('es-ES') + '</p>'
    + agenciaHeader
    + '<table><thead>' + tableHead + '</thead><tbody>' + tableBody + '</tbody></table>'
    + '<br/><button onclick="window.print()">🖨 Imprimir / Guardar PDF</button>'
    + '</body></html>')
  win.document.close()
}
