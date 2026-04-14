const { ipcMain, dialog } = require('electron')
const { calcularTarifas, calcularPesosDebidos } = require('../services/calculationService')
const { getDb } = require('../database/connection')
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

ipcMain.handle('calcular-tarifas', (event, datos) => {
  return calcularTarifas(datos)
})

ipcMain.handle('calcular-pesos-debidos', (event, datos) => {
  return calcularPesosDebidos(datos)
})

function redondear5(precio) {
  if (precio == null) return null
  return Math.ceil(precio * 20) / 20
}

ipcMain.handle('save-quote', (event, { largoCm, anchoCm, altoCm, cpPrefix, metrosCubicos, peso, agenciaId, precioFinal, bultos }) => {
  try {
    const precioRedondeado = redondear5(precioFinal)
    // If multi-bulto, store first bulto dimensions; totals are already in metrosCubicos/peso
    const primerBulto = (bultos && bultos.length > 0) ? bultos[0] : { largoCm, anchoCm, altoCm }
    getDb()
      .prepare(`
        INSERT INTO cotizaciones (largo_cm, ancho_cm, alto_cm, cp_prefix, metros_cubicos, peso, agencia_id, precio_final, precio_redondeado)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(primerBulto.largoCm, primerBulto.anchoCm, primerBulto.altoCm, cpPrefix, metrosCubicos || 0, peso || 0, agenciaId, precioFinal, precioRedondeado)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('get-history', (event, { desde, hasta, agenciaId } = {}) => {
  const conds = []
  const params = []
  if (desde) { conds.push('date(c.fecha) >= date(?)'); params.push(desde) }
  if (hasta) { conds.push('date(c.fecha) <= date(?)'); params.push(hasta) }
  if (agenciaId) { conds.push('c.agencia_id = ?'); params.push(agenciaId) }
  const where = conds.length ? ' WHERE ' + conds.join(' AND ') : ''
  const sql = `SELECT c.*, a.nombre as agencia_nombre FROM cotizaciones c LEFT JOIN agencias a ON a.id = c.agencia_id${where} ORDER BY c.fecha DESC LIMIT 500`
  return getDb().prepare(sql).all(...params)
})

ipcMain.handle('get-agencies-simple', () => {
  return getDb().prepare('SELECT id, nombre FROM agencias ORDER BY nombre').all()
})

// ── Cotizaciones pendientes (guardadas sin agencia elegida) ──────────────────

ipcMain.handle('save-pending-quote', (event, { cpPrefix, bultos, resultados }) => {
  try {
    getDb()
      .prepare('INSERT INTO cotizaciones_pendientes (cp_prefix, bultos_json, resultados_json) VALUES (?,?,?)')
      .run(cpPrefix, JSON.stringify(bultos), JSON.stringify(resultados))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('get-pending-quotes', () => {
  return getDb()
    .prepare('SELECT * FROM cotizaciones_pendientes ORDER BY fecha DESC')
    .all()
    .map(row => ({
      ...row,
      bultos:     JSON.parse(row.bultos_json),
      resultados: JSON.parse(row.resultados_json),
    }))
})

ipcMain.handle('resolve-pending-quote', (event, { pendingId, agenciaId, metrosCubicos, peso, precioFinal, cpPrefix, largoCm, anchoCm, altoCm, bultos }) => {
  try {
    const db = getDb()
    const precioRedondeado = redondear5(precioFinal)
    const primerBulto = (bultos && bultos.length > 0) ? bultos[0] : { largoCm, anchoCm, altoCm }
    db.prepare(`
      INSERT INTO cotizaciones (largo_cm, ancho_cm, alto_cm, cp_prefix, metros_cubicos, peso, agencia_id, precio_final, precio_redondeado)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(primerBulto.largoCm, primerBulto.anchoCm, primerBulto.altoCm, cpPrefix, metrosCubicos || 0, peso || 0, agenciaId, precioFinal, precioRedondeado)
    db.prepare('DELETE FROM cotizaciones_pendientes WHERE id = ?').run(pendingId)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('delete-pending-quote', (event, { id }) => {
  const result = getDb().prepare('DELETE FROM cotizaciones_pendientes WHERE id = ?').run(id)
  return { deleted: result.changes }
})

ipcMain.handle('get-pending-count', () => {
  return getDb().prepare('SELECT COUNT(*) as c FROM cotizaciones_pendientes').get()
})

// ────────────────────────────────────────────────────────────────────────────

ipcMain.handle('delete-quote-by-id', (event, { id }) => {
  const result = getDb().prepare('DELETE FROM cotizaciones WHERE id = ?').run(id)
  return { deleted: result.changes }
})

ipcMain.handle('delete-history', (event, { desde, hasta } = {}) => {
  let sql = 'DELETE FROM cotizaciones'
  const params = []
  if (desde && hasta) {
    sql += ' WHERE date(fecha) >= date(?) AND date(fecha) <= date(?)'
    params.push(desde, hasta)
  } else if (desde) {
    sql += ' WHERE date(fecha) >= date(?)'
    params.push(desde)
  } else if (hasta) {
    sql += ' WHERE date(fecha) <= date(?)'
    params.push(hasta)
  }
  const result = getDb().prepare(sql).run(...params)
  return { deleted: result.changes }
})

// ── Analytics ─────────────────────────────────────────────────────────────────
ipcMain.handle('get-analytics', () => {
  const db = getDb()

  // Total quotes and revenue
  const totals = db.prepare(`
    SELECT COUNT(*) as total, COALESCE(SUM(precio_final),0) as ingresos
    FROM cotizaciones
  `).get()

  // By agency: count + revenue
  const porAgencia = db.prepare(`
    SELECT a.nombre, COUNT(*) as total, COALESCE(SUM(c.precio_final),0) as ingresos,
           COALESCE(AVG(c.precio_final),0) as precio_medio
    FROM cotizaciones c
    LEFT JOIN agencias a ON a.id = c.agencia_id
    GROUP BY c.agencia_id
    ORDER BY total DESC
    LIMIT 10
  `).all()

  // Quotes per day (last 30 days)
  const porDia = db.prepare(`
    SELECT date(fecha) as dia, COUNT(*) as total, COALESCE(SUM(precio_final),0) as ingresos
    FROM cotizaciones
    WHERE fecha >= date('now','-30 days')
    GROUP BY dia
    ORDER BY dia ASC
  `).all()

  // Quotes per month (last 12 months)
  const porMes = db.prepare(`
    SELECT strftime('%Y-%m', fecha) as mes, COUNT(*) as total, COALESCE(SUM(precio_final),0) as ingresos
    FROM cotizaciones
    WHERE fecha >= date('now','-12 months')
    GROUP BY mes
    ORDER BY mes ASC
  `).all()

  // Top CPs by volume
  const topCps = db.prepare(`
    SELECT cp_prefix, COUNT(*) as total, COALESCE(SUM(precio_final),0) as ingresos
    FROM cotizaciones
    GROUP BY cp_prefix
    ORDER BY total DESC
    LIMIT 10
  `).all()

  // Weight distribution buckets
  const pesoBuckets = db.prepare(`
    SELECT
      CASE
        WHEN peso < 50   THEN '< 50 kg'
        WHEN peso < 100  THEN '50–100 kg'
        WHEN peso < 250  THEN '100–250 kg'
        WHEN peso < 500  THEN '250–500 kg'
        WHEN peso < 1000 THEN '500–1000 kg'
        ELSE '> 1000 kg'
      END as rango,
      COUNT(*) as total
    FROM cotizaciones
    WHERE peso > 0
    GROUP BY rango
    ORDER BY MIN(peso) ASC
  `).all()

  // Average price per agency
  const precioMedioAgencia = db.prepare(`
    SELECT a.nombre, COALESCE(AVG(c.precio_final),0) as precio_medio, COUNT(*) as total
    FROM cotizaciones c
    LEFT JOIN agencias a ON a.id = c.agencia_id
    WHERE c.precio_final IS NOT NULL
    GROUP BY c.agencia_id
    ORDER BY precio_medio ASC
  `).all()

  // This month vs last month
  const comparativa = db.prepare(`
    SELECT
      SUM(CASE WHEN strftime('%Y-%m', fecha) = strftime('%Y-%m','now') THEN 1 ELSE 0 END) as mes_actual_n,
      SUM(CASE WHEN strftime('%Y-%m', fecha) = strftime('%Y-%m','now','-1 month') THEN 1 ELSE 0 END) as mes_anterior_n,
      SUM(CASE WHEN strftime('%Y-%m', fecha) = strftime('%Y-%m','now') THEN precio_final ELSE 0 END) as mes_actual_ingresos,
      SUM(CASE WHEN strftime('%Y-%m', fecha) = strftime('%Y-%m','now','-1 month') THEN precio_final ELSE 0 END) as mes_anterior_ingresos
    FROM cotizaciones
  `).get()

  // Today vs yesterday
  const comparativaDia = db.prepare(`
    SELECT
      SUM(CASE WHEN date(fecha) = date('now') THEN 1 ELSE 0 END) as hoy_n,
      SUM(CASE WHEN date(fecha) = date('now','-1 day') THEN 1 ELSE 0 END) as ayer_n,
      COALESCE(SUM(CASE WHEN date(fecha) = date('now') THEN precio_final ELSE 0 END),0) as hoy_ingresos,
      COALESCE(SUM(CASE WHEN date(fecha) = date('now','-1 day') THEN precio_final ELSE 0 END),0) as ayer_ingresos
    FROM cotizaciones
  `).get()

  // Last 14 days detail for day-over-day chart (today + previous 13 days and the same 14 days before)
  const ultimos14 = db.prepare(`
    SELECT date(fecha) as dia, COUNT(*) as total, COALESCE(SUM(precio_final),0) as ingresos
    FROM cotizaciones
    WHERE fecha >= date('now','-13 days')
    GROUP BY dia
    ORDER BY dia ASC
  `).all()

  const anteriores14 = db.prepare(`
    SELECT date(fecha) as dia, COUNT(*) as total, COALESCE(SUM(precio_final),0) as ingresos
    FROM cotizaciones
    WHERE fecha >= date('now','-27 days') AND fecha < date('now','-13 days')
    GROUP BY dia
    ORDER BY dia ASC
  `).all()

  return { totals, porAgencia, porDia, porMes, topCps, pesoBuckets, precioMedioAgencia, comparativa, comparativaDia, ultimos14, anteriores14 }
})

// ── XLSX export via save dialog ──────────────────────────────────────────────
ipcMain.handle('export-analytics-xlsx', async (event, { porAgencia, porMes, porDia, topCps }) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Exportar Analíticas a Excel',
    defaultPath: `analiticas_logicompare_${new Date().toISOString().slice(0,10)}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (!filePath) return { ok: false }

  try {
    // Build worksheet XML rows helper
    const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    const numCell = (v, col) => `<c r="${col}" t="n"><v>${v}</v></c>`
    const strCell = (v, col) => `<c r="${col}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`

    function buildSheet(headers, rows) {
      const cols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
      let xml = `<?xml version="1.0" encoding="UTF-8"?>`
      xml += `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
      xml += `<sheetData>`
      // header row
      xml += `<row r="1">`
      headers.forEach((h, i) => { xml += strCell(h, cols[i] + '1') })
      xml += `</row>`
      rows.forEach((row, ri) => {
        const rn = ri + 2
        xml += `<row r="${rn}">`
        row.forEach((cell, ci) => {
          if (typeof cell === 'number') xml += numCell(cell, cols[ci] + rn)
          else xml += strCell(cell, cols[ci] + rn)
        })
        xml += `</row>`
      })
      xml += `</sheetData></worksheet>`
      return xml
    }

    const sheetAgencia = buildSheet(
      ['Agencia', 'Envíos', 'Facturación (€)', 'Precio Medio (€)'],
      (porAgencia || []).map(a => [a.nombre ?? '', a.total, Math.round(a.ingresos*100)/100, Math.round(a.precio_medio*100)/100])
    )
    const sheetMes = buildSheet(
      ['Mes', 'Cotizaciones', 'Facturación (€)'],
      (porMes || []).map(m => [m.mes, m.total, Math.round(m.ingresos*100)/100])
    )
    const sheetDia = buildSheet(
      ['Fecha', 'Cotizaciones', 'Facturación (€)'],
      (porDia || []).map(d => [d.dia, d.total, Math.round(d.ingresos*100)/100])
    )
    const sheetCps = buildSheet(
      ['CP', 'Envíos', 'Facturación (€)'],
      (topCps || []).map(c => [c.cp_prefix, c.total, Math.round(c.ingresos*100)/100])
    )

    const workbook = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Agencias" sheetId="1" r:id="rId1"/><sheet name="Mensual" sheetId="2" r:id="rId2"/><sheet name="Diario" sheetId="3" r:id="rId3"/><sheet name="Top CPs" sheetId="4" r:id="rId4"/></sheets></workbook>`
    const rels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/></Relationships>`
    const contentTypes = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    const topRels = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

    const files = {
      '[Content_Types].xml': contentTypes,
      '_rels/.rels': topRels,
      'xl/workbook.xml': workbook,
      'xl/_rels/workbook.xml.rels': rels,
      'xl/worksheets/sheet1.xml': sheetAgencia,
      'xl/worksheets/sheet2.xml': sheetMes,
      'xl/worksheets/sheet3.xml': sheetDia,
      'xl/worksheets/sheet4.xml': sheetCps,
    }
    const buf = buildZip(files)
    fs.writeFileSync(filePath, buf)
    return { ok: true, filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('export-xlsx', async (event, { filename, files }) => {
  const { filePath } = await dialog.showSaveDialog({
    title: 'Guardar como Excel',
    defaultPath: filename,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  })
  if (!filePath) return { ok: false }

  try {
    const buf = buildZip(files)
    fs.writeFileSync(filePath, buf)
    return { ok: true, filePath }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

function buildZip(files) {
  const entries = []
  let offset = 0

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8')
    const dataBytes = Buffer.from(content, 'utf8')
    const compressed = zlib.deflateRawSync(dataBytes, { level: 6 })

    // Use stored (no compression) for small files to keep it simple & compatible
    const useDeflate = compressed.length < dataBytes.length
    const method = useDeflate ? 8 : 0
    const fileData = useDeflate ? compressed : dataBytes
    const crc = crc32(dataBytes)
    const modTime = dosTime(new Date())

    const localHeader = Buffer.alloc(30 + nameBytes.length)
    localHeader.writeUInt32LE(0x04034b50, 0)   // signature
    localHeader.writeUInt16LE(20, 4)            // version needed
    localHeader.writeUInt16LE(0, 6)             // flags
    localHeader.writeUInt16LE(method, 8)        // compression
    localHeader.writeUInt16LE(modTime.time, 10) // mod time
    localHeader.writeUInt16LE(modTime.date, 12) // mod date
    localHeader.writeUInt32LE(crc, 14)          // crc32
    localHeader.writeUInt32LE(fileData.length, 18) // compressed size
    localHeader.writeUInt32LE(dataBytes.length, 22) // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26) // filename length
    localHeader.writeUInt16LE(0, 28)            // extra field length
    nameBytes.copy(localHeader, 30)

    entries.push({ name: nameBytes, localHeader, fileData, crc, method, modTime,
      compressedSize: fileData.length, uncompressedSize: dataBytes.length, offset })
    offset += localHeader.length + fileData.length
  }

  const cdirParts = []
  for (const e of entries) {
    const cd = Buffer.alloc(46 + e.name.length)
    cd.writeUInt32LE(0x02014b50, 0)   // central dir signature
    cd.writeUInt16LE(20, 4)           // version made by
    cd.writeUInt16LE(20, 6)           // version needed
    cd.writeUInt16LE(0, 8)            // flags
    cd.writeUInt16LE(e.method, 10)    // compression
    cd.writeUInt16LE(e.modTime.time, 12)
    cd.writeUInt16LE(e.modTime.date, 14)
    cd.writeUInt32LE(e.crc, 16)
    cd.writeUInt32LE(e.compressedSize, 20)
    cd.writeUInt32LE(e.uncompressedSize, 24)
    cd.writeUInt16LE(e.name.length, 28)
    cd.writeUInt16LE(0, 30)           // extra length
    cd.writeUInt16LE(0, 32)           // comment length
    cd.writeUInt16LE(0, 34)           // disk start
    cd.writeUInt16LE(0, 36)           // internal attrs
    cd.writeUInt32LE(0, 38)           // external attrs
    cd.writeUInt32LE(e.offset, 42)    // local header offset
    e.name.copy(cd, 46)
    cdirParts.push(cd)
  }

  const cdir = Buffer.concat(cdirParts)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  eocd.writeUInt16LE(0, 20)

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
