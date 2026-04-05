const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

// ── Parse a LogiCompare XLSX (our own format) ─────────────────────────────────
// We read the xl/worksheets/sheet*.xml files from the ZIP and extract rows.
// Our XLSX uses inlineStr for strings and plain <v> for numbers.
function parseXlsxBuffer(buf) {
  const sheets = unzipSheets(buf)
  const rows = []

  for (const [sheetName, xml] of Object.entries(sheets)) {
    const sheetRows = parseSheetXml(xml)
    if (sheetRows.length < 2) continue  // no data rows
    const headers = sheetRows[0].map(h => h.toLowerCase().trim())

    // Detect column indexes
    const iDate  = headers.findIndex(h => h.includes('fecha'))
    const iMed   = headers.findIndex(h => h.includes('medidas'))
    const iCp    = headers.findIndex(h => h === 'cp')
    const iM3    = headers.findIndex(h => h.includes('metros') || h.includes('m³'))
    const iPeso  = headers.findIndex(h => h.includes('peso'))
    const iAg    = headers.findIndex(h => h.includes('agencia'))
    const iPF    = headers.findIndex(h => h.includes('precio final') || h.includes('precio final (€)'))
    const iPR    = headers.findIndex(h => h.includes('redondeado') || h.includes('precio redondeado'))

    for (let i = 1; i < sheetRows.length; i++) {
      const r = sheetRows[i]
      if (!r || r.length === 0) continue
      const fecha = iDate >= 0 ? r[iDate] : ''
      if (!fecha) continue

      rows.push({
        fecha:           fecha,
        medidas:         iMed >= 0  ? r[iMed]  : '',
        cp_prefix:       iCp >= 0   ? r[iCp]   : '',
        metros_cubicos:  iM3 >= 0   ? parseFloat(r[iM3])  || 0 : 0,
        peso:            iPeso >= 0 ? parseFloat(r[iPeso]) || 0 : 0,
        agencia_nombre:  iAg >= 0   ? r[iAg]   : sheetName,
        precio_final:    iPF >= 0   ? parseFloat(r[iPF])  || 0 : 0,
        precio_redondeado: iPR >= 0 ? parseFloat(r[iPR])  || 0 : 0,
      })
    }
  }

  return rows
}

function parseSheetXml(xml) {
  const rows = []
  const rowMatches = xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)
  for (const rowMatch of rowMatches) {
    const cells = []
    const cellMatches = rowMatch[1].matchAll(/<c r="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)
    for (const cm of cellMatches) {
      const col = cm[1]
      const inner = cm[2]
      const colIdx = colLetterToIndex(col)
      // Inline string
      const tMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/)
      const vMatch = inner.match(/<v[^>]*>([\s\S]*?)<\/v>/)
      const val = tMatch ? decodeXmlEntities(tMatch[1]) : (vMatch ? vMatch[1] : '')
      while (cells.length < colIdx) cells.push('')
      cells[colIdx] = val
    }
    rows.push(cells)
  }
  return rows
}

function colLetterToIndex(col) {
  let idx = 0
  for (let i = 0; i < col.length; i++) {
    idx = idx * 26 + (col.charCodeAt(i) - 64)
  }
  return idx - 1
}

function decodeXmlEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
}

// Minimal ZIP reader — find and decompress xl/worksheets/sheet*.xml entries
function unzipSheets(buf) {
  const sheets = {}
  let offset = 0

  while (offset < buf.length - 4) {
    const sig = buf.readUInt32LE(offset)
    if (sig !== 0x04034b50) { offset++; continue }

    const compression  = buf.readUInt16LE(offset + 8)
    const compSize     = buf.readUInt32LE(offset + 18)
    const fnLen        = buf.readUInt16LE(offset + 26)
    const extraLen     = buf.readUInt16LE(offset + 28)
    const filename     = buf.slice(offset + 30, offset + 30 + fnLen).toString('utf8')
    const dataStart    = offset + 30 + fnLen + extraLen
    const compData     = buf.slice(dataStart, dataStart + compSize)

    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(filename)) {
      try {
        const xmlBuf = compression === 8
          ? zlib.inflateRawSync(compData)
          : compData
        // Extract sheet name from filename index
        const m = filename.match(/sheet(\d+)\.xml/)
        const sheetKey = m ? `Hoja${m[1]}` : filename
        sheets[sheetKey] = xmlBuf.toString('utf8')
      } catch (_) {}
    }

    offset = dataStart + compSize
  }

  return sheets
}

// ── Normalize agency name (strip Palet/Bulto) ────────────────────────────────
function normalizeAgencia(nombre) {
  if (!nombre) return 'Sin agencia'
  return nombre.replace(/\s*\((Palet|Bulto|Palets|Bultos)\)\s*$/i, '').trim()
}

// ── Parse "dd/mm/yyyy hh:mm" → sortable string ───────────────────────────────
function parseDateEs(str) {
  if (!str) return ''
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}`
  return str
}

function redondear5(precio) {
  if (precio == null) return null
  return Math.ceil(precio * 20) / 20
}

// ── IPC: merge-excels ─────────────────────────────────────────────────────────
ipcMain.handle('merge-excels', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecciona los archivos Excel de LogiCompare (hasta 3)',
    filters: [{ name: 'Excel LogiCompare', extensions: ['xlsx'] }],
    properties: ['openFile', 'multiSelections'],
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false }

  const filePaths = result.filePaths.slice(0, 3)
  let allRows = []

  for (const fp of filePaths) {
    try {
      const buf = fs.readFileSync(fp)
      const rows = parseXlsxBuffer(buf)
      allRows = allRows.concat(rows)
    } catch (err) {
      return { ok: false, error: `Error leyendo ${path.basename(fp)}: ${err.message}` }
    }
  }

  if (!allRows.length) return { ok: false, error: 'No se encontraron datos en los archivos.' }

  // Deduplicate by fecha+agencia+precio (same row from multiple exports)
  const seen = new Set()
  allRows = allRows.filter(r => {
    const key = `${r.fecha}|${normalizeAgencia(r.agencia_nombre)}|${r.precio_final}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // Normalize agency names
  allRows.forEach(r => { r.agencia_nombre = normalizeAgencia(r.agencia_nombre) })

  // Sort by sortable date then by agency
  allRows.sort((a, b) => {
    const da = parseDateEs(a.fecha)
    const db2 = parseDateEs(b.fecha)
    if (da < db2) return -1
    if (da > db2) return 1
    return (a.agencia_nombre || '').localeCompare(b.agencia_nombre || '')
  })

  return { ok: true, rows: allRows, count: allRows.length }
})

// ── IPC: export-merged-xlsx ───────────────────────────────────────────────────
ipcMain.handle('export-merged-xlsx', async (event, { rows, simplificada }) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Guardar Excel consolidado',
    defaultPath: 'historial_consolidado_' + new Date().toISOString().slice(0, 10) + '.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (!filePath) return { ok: false }

  try {
    const xlsxBuf = buildMergedXlsx(rows, simplificada)
    fs.writeFileSync(filePath, xlsxBuf)
    return { ok: true, filePath }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

function buildMergedXlsx(rows, simplificada) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  // Group by agency, each group sorted by date
  const groups = []
  const groupMap = {}
  rows.forEach(r => {
    const key = r.agencia_nombre || 'Sin agencia'
    if (!groupMap[key]) { groupMap[key] = []; groups.push(key) }
    groupMap[key].push(r)
  })
  // Sort each group by date
  groups.forEach(k => groupMap[k].sort((a, b) => parseDateEs(a.fecha).localeCompare(parseDateEs(b.fecha))))

  const makeSheetXml = (dataRows, numCols, headers) => {
    const allRows2 = [headers, ...dataRows]
    const sheetRows = allRows2.map((row, ri) =>
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
  let sheetEls = '', wbRelEls = '', ctOverrides = ''

  groups.forEach((agName, i) => {
    const idx = i + 1
    const sheetName = agName.replace(/[\\/*?:\[\]]/g, '').slice(0, 31)
    const agRows = groupMap[agName]
    let headers, numCols, dataRows

    if (simplificada) {
      headers = ['Fecha', 'Precio Final (€)', 'Precio Redondeado (€)']
      numCols = [1, 2]
      dataRows = agRows.map(r => {
        const red = r.precio_redondeado || redondear5(r.precio_final) || 0
        return [r.fecha, r.precio_final.toFixed(2), red.toFixed(2)]
      })
    } else {
      headers = ['Fecha', 'Medidas (cm)', 'CP', 'Metros Cúbicos', 'Peso (kg)', 'Agencia', 'Precio Final (€)', 'Precio Redondeado (€)']
      numCols = [3, 4, 6, 7]
      dataRows = agRows.map(r => {
        const red = r.precio_redondeado || redondear5(r.precio_final) || 0
        return [r.fecha, r.medidas || '', r.cp_prefix || '', r.metros_cubicos.toFixed(6),
          r.peso || 0, r.agencia_nombre || '', r.precio_final.toFixed(2), red.toFixed(2)]
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

  return buildZip(files)
}

function buildZip(files) {
  const entries = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const dataBytes = Buffer.from(content, 'utf8')
    const compressed = zlib.deflateRawSync(dataBytes, { level: 6 })
    const useDeflate = compressed.length < dataBytes.length
    const method = useDeflate ? 8 : 0
    const fileData = useDeflate ? compressed : dataBytes
    const crc = crc32(dataBytes)
    const modTime = dosTime(new Date())

    const localHeader = Buffer.alloc(30 + nameBytes.length)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(modTime.time, 10)
    localHeader.writeUInt16LE(modTime.date, 12)
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(fileData.length, 18)
    localHeader.writeUInt32LE(dataBytes.length, 22)
    localHeader.writeUInt16LE(nameBytes.length, 26)
    localHeader.writeUInt16LE(0, 28)
    nameBytes.copy(localHeader, 30)

    entries.push({ name: nameBytes, localHeader, fileData, crc, method, modTime,
      compressedSize: fileData.length, uncompressedSize: dataBytes.length, offset })
    offset += localHeader.length + fileData.length
  }

  const cdirParts = []
  for (const e of entries) {
    const cd = Buffer.alloc(46 + e.name.length)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(e.method, 10)
    cd.writeUInt16LE(e.modTime.time, 12); cd.writeUInt16LE(e.modTime.date, 14)
    cd.writeUInt32LE(e.crc, 16)
    cd.writeUInt32LE(e.compressedSize, 20); cd.writeUInt32LE(e.uncompressedSize, 24)
    cd.writeUInt16LE(e.name.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(e.offset, 42)
    e.name.copy(cd, 46)
    cdirParts.push(cd)
  }

  const cdir = Buffer.concat(cdirParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdir.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20)

  const localParts = entries.map(e => Buffer.concat([e.localHeader, e.fileData]))
  return Buffer.concat([...localParts, cdir, eocd])
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      t[i] = c
    }
    return t
  })())
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8))
  return (crc ^ 0xFFFFFFFF) >>> 0
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}
