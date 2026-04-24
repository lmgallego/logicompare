const { ipcMain, dialog, app } = require('electron')
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx')
const { getDb } = require('../database/connection')
const { calcularTarifas } = require('../services/calculationService')

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalizeHeader(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .trim()
}

function findColIndex(headers, candidates) {
  const norm = headers.map(normalizeHeader)
  for (const cand of candidates) {
    const idx = norm.findIndex(h => h === cand || h.includes(cand))
    if (idx >= 0) return idx
  }
  return -1
}

function toInt(val) {
  if (val == null || val === '') return null
  const n = parseFloat(String(val).replace(',', '.'))
  if (!isFinite(n)) return null
  return Math.round(n)
}

// Parse xlsx buffer → array of { referencia, largoCm, anchoCm, altoCm }
// Applies rounding + adds 5 cm to each dimension.
function parseParachoquesXlsx(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const firstSheet = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheet]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (rows.length < 2) {
    return { rows: [], warnings: ['El archivo no contiene datos.'] }
  }

  const headers = rows[0].map(h => String(h || ''))
  const iRef   = findColIndex(headers, ['referencia', 'ref', 'codigo', 'cod'])
  const iLargo = findColIndex(headers, ['largo'])
  const iAncho = findColIndex(headers, ['ancho'])
  const iAlto  = findColIndex(headers, ['altura', 'alto'])

  if (iRef < 0 || iLargo < 0 || iAncho < 0 || iAlto < 0) {
    throw new Error(
      'Cabeceras no reconocidas. Se esperan columnas: REFERENCIA, LARGO, ANCHO, ALTURA. ' +
      'Detectadas: ' + headers.join(', ')
    )
  }

  const out = []
  const warnings = []
  const seen = new Set()

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const ref = String(r[iRef] ?? '').trim()
    if (!ref) continue

    const largoRaw = toInt(r[iLargo])
    const anchoRaw = toInt(r[iAncho])
    const altoRaw  = toInt(r[iAlto])
    if (largoRaw == null || anchoRaw == null || altoRaw == null) {
      warnings.push(`Fila ${i + 1} (${ref}): medida vacía o no numérica — omitida.`)
      continue
    }

    if (seen.has(ref)) {
      warnings.push(`Referencia duplicada "${ref}" en el Excel — se conserva la última.`)
    }
    seen.add(ref)

    out.push({
      referencia: ref,
      largoCm: largoRaw + 5,
      anchoCm: anchoRaw + 5,
      altoCm:  altoRaw  + 5,
    })
  }

  return { rows: out, warnings }
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('import-parachoques-xlsx', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecciona el Excel de medidas de parachoques',
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }

  const filePath = result.filePaths[0]

  try {
    const { rows, warnings } = parseParachoquesXlsx(filePath)
    if (rows.length === 0) {
      return { ok: false, error: 'No se encontraron filas válidas en el Excel.', warnings }
    }

    const db = getDb()
    const keepRefs = new Set(rows.map(r => r.referencia))

    // Count current state for the report
    const before = db.prepare('SELECT COUNT(*) as c FROM parachoques').get().c

    // Upsert all rows + delete those not present, atomically
    const upsert = db.prepare(`
      INSERT INTO parachoques (referencia, largo_cm, ancho_cm, alto_cm, actualizado)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(referencia) DO UPDATE SET
        largo_cm    = excluded.largo_cm,
        ancho_cm    = excluded.ancho_cm,
        alto_cm     = excluded.alto_cm,
        actualizado = excluded.actualizado
    `)

    let inserted = 0
    let updated  = 0
    const existingRefs = new Set(db.prepare('SELECT referencia FROM parachoques').all().map(r => r.referencia))

    const tx = db.transaction(() => {
      for (const r of rows) {
        if (existingRefs.has(r.referencia)) updated++
        else inserted++
        upsert.run(r.referencia, r.largoCm, r.anchoCm, r.altoCm)
      }

      // Delete refs no longer present in the new Excel
      const all = db.prepare('SELECT referencia FROM parachoques').all()
      const toDelete = all.filter(x => !keepRefs.has(x.referencia)).map(x => x.referencia)
      const delStmt = db.prepare('DELETE FROM parachoques WHERE referencia = ?')
      for (const ref of toDelete) delStmt.run(ref)

      return { deleted: toDelete.length }
    })

    const { deleted } = tx()
    const after = db.prepare('SELECT COUNT(*) as c FROM parachoques').get().c

    return {
      ok: true,
      filePath,
      summary: {
        filasLeidas: rows.length,
        insertadas: inserted,
        actualizadas: updated,
        eliminadas: deleted,
        antesTotal: before,
        ahoraTotal: after,
      },
      warnings,
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('get-parachoques-by-ref', (event, { referencia }) => {
  const ref = String(referencia || '').trim()
  if (!ref) return null
  return getDb().prepare('SELECT * FROM parachoques WHERE referencia = ?').get(ref)
})

ipcMain.handle('search-parachoques', (event, { query, limit }) => {
  const q = String(query || '').trim()
  const lim = Math.min(parseInt(limit) || 20, 50)
  if (!q) return []
  return getDb()
    .prepare('SELECT * FROM parachoques WHERE referencia LIKE ? ORDER BY referencia ASC LIMIT ?')
    .all(q + '%', lim)
})

ipcMain.handle('count-parachoques', () => {
  return getDb().prepare('SELECT COUNT(*) as c FROM parachoques').get().c
})

// Calculate shipping prices for a parachoque by referencia + CP
ipcMain.handle('calcular-parachoques', (event, { referencia, cpPrefix }) => {
  const ref = String(referencia || '').trim()
  const cp  = String(cpPrefix  || '').trim().padStart(2, '0').slice(0, 2)
  if (!ref) return { ok: false, error: 'Falta la referencia.' }
  if (!/^\d{2}$/.test(cp)) return { ok: false, error: 'CP inválido (se esperan 2 dígitos).' }

  const row = getDb().prepare('SELECT * FROM parachoques WHERE referencia = ?').get(ref)
  if (!row) return { ok: false, error: 'Referencia no encontrada en la base de datos.' }

  const resultados = calcularTarifas({
    largoCm: row.largo_cm,
    anchoCm: row.ancho_cm,
    altoCm:  row.alto_cm,
    cpPrefix: cp,
    bultos: [{ largoCm: row.largo_cm, anchoCm: row.ancho_cm, altoCm: row.alto_cm }],
  })

  // Reglas específicas de parachoques:
  //   - DHL nunca debe aparecer
  //   - GLS solo aparece si el largo ≤ 110 cm
  const filtrados = resultados.filter(r => {
    const nombre = (r.agencia?.nombre || '').toLowerCase()
    if (nombre.includes('dhl')) return false
    if (nombre.includes('gls') && row.largo_cm > 110) return false
    return true
  })

  return {
    ok: true,
    parachoque: row,
    cpPrefix: cp,
    resultados: filtrados,
  }
})

// ── DB stats and backup ─────────────────────────────────────────────────────
ipcMain.handle('db-stats', () => {
  const dbPath = path.join(app.getPath('userData'), 'logicompare.db')
  let sizeBytes = 0
  let mtime = null
  try {
    const st = fs.statSync(dbPath)
    sizeBytes = st.size
    mtime = st.mtime.toISOString()
  } catch (_) {}

  const db = getDb()
  const tables = [
    'agencias', 'zonas_agencia', 'zonas_provincias', 'tarifas_agencia',
    'tarifas_kg_adicional', 'recargos_agencia', 'provincias',
    'cotizaciones', 'cotizaciones_pendientes', 'parachoques',
  ]
  const counts = {}
  for (const t of tables) {
    try {
      counts[t] = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get().c
    } catch (_) {
      counts[t] = null
    }
  }

  // SQLite internal stats
  let pageCount = 0, pageSize = 0, freelistCount = 0
  try {
    pageCount     = db.prepare('PRAGMA page_count').get().page_count
    pageSize      = db.prepare('PRAGMA page_size').get().page_size
    freelistCount = db.prepare('PRAGMA freelist_count').get().freelist_count
  } catch (_) {}

  return {
    dbPath,
    sizeBytes,
    modified: mtime,
    counts,
    pageCount,
    pageSize,
    freelistCount,
    totalRows: Object.values(counts).reduce((a, b) => a + (b || 0), 0),
  }
})

// Quick backup — saves a timestamped copy of the DB
ipcMain.handle('db-backup', async () => {
  const srcPath = path.join(app.getPath('userData'), 'logicompare.db')
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const { filePath } = await dialog.showSaveDialog({
    title: 'Guardar copia de seguridad de la base de datos',
    defaultPath: `logicompare_backup_${ts}.db`,
    filters: [{ name: 'Base de datos SQLite', extensions: ['db'] }],
  })
  if (!filePath) return { ok: false, cancelled: true }
  try {
    fs.copyFileSync(srcPath, filePath)
    const st = fs.statSync(filePath)
    return { ok: true, filePath, sizeBytes: st.size }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})
