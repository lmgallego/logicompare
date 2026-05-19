const { ipcMain, dialog } = require('electron')
const XLSX = require('xlsx')
const { getDb } = require('../database/connection')
const { calcularTarifas } = require('../services/calculationService')

// ── Helpers ─────────────────────────────────────────────────────────────────
function normalizeHeader(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function findColIndex(headers, candidates) {
  const norm = headers.map(normalizeHeader)
  for (const cand of candidates) {
    const idx = norm.findIndex(h => h.includes(cand))
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

const VALID_PROVEEDORES = ['COSPEL', 'POLIPLAST']

// Parse Medidas.xlsx → array of { referenciaElmer, descripcion, proveedor, largoCm, anchoCm, altoCm }
function parseMedidasElmerXlsx(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false })

  // Buscar hoja "Medidas" específicamente
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().trim() === 'medidas')
  if (!sheetName) {
    throw new Error(
      'No se encontró la hoja "Medidas" en el Excel. Hojas disponibles: ' +
      workbook.SheetNames.join(', ')
    )
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (rows.length < 2) {
    return { rows: [], warnings: ['El archivo no contiene datos.'] }
  }

  const headers = rows[0].map(h => String(h || ''))
  const iRef   = findColIndex(headers, ['referencia elmer', 'referencia'])
  const iDesc  = findColIndex(headers, ['descripcion'])
  const iProv  = findColIndex(headers, ['proveedor'])
  const iLargo = findColIndex(headers, ['largo'])
  const iAncho = findColIndex(headers, ['ancho'])
  const iAlto  = findColIndex(headers, ['alto', 'altura'])

  if (iRef < 0 || iProv < 0 || iLargo < 0 || iAncho < 0 || iAlto < 0) {
    throw new Error(
      'Cabeceras no reconocidas. Se esperan columnas: REFERENCIA ELMER, PROVEEDOR, LARGO, ANCHO, ALTO. ' +
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
    if (!ref) {
      warnings.push(`Fila ${i + 1}: referencia_elmer vacía — omitida.`)
      continue
    }

    const desc = iDesc >= 0 ? String(r[iDesc] ?? '').trim() : ''
    let prov = String(r[iProv] ?? '').trim().toUpperCase()

    if (!VALID_PROVEEDORES.includes(prov)) {
      warnings.push(`Fila ${i + 1} (${ref}): proveedor "${prov}" no reconocido (se espera COSPEL o POLIPLAST) — omitida.`)
      continue
    }

    const largo = toInt(r[iLargo])
    const ancho = toInt(r[iAncho])
    const alto  = toInt(r[iAlto])
    if (largo == null || ancho == null || alto == null) {
      warnings.push(`Fila ${i + 1} (${ref}): medida vacía o no numérica — omitida.`)
      continue
    }

    if (seen.has(ref)) {
      warnings.push(`Referencia duplicada "${ref}" en el Excel — se conserva la última.`)
    }
    seen.add(ref)

    out.push({
      referenciaElmer: ref,
      descripcion: desc,
      proveedor: prov,
      largoCm: largo,
      anchoCm: ancho,
      altoCm: alto,
    })
  }

  return { rows: out, warnings }
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('import-medidas-elmer-xlsx', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecciona el archivo Medidas.xlsx',
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }

  const filePath = result.filePaths[0]

  try {
    const { rows, warnings } = parseMedidasElmerXlsx(filePath)
    if (rows.length === 0) {
      return { ok: false, error: 'No se encontraron filas válidas en el Excel.', warnings }
    }

    const db = getDb()
    const keepRefs = new Set(rows.map(r => r.referenciaElmer))
    const before = db.prepare('SELECT COUNT(*) as c FROM medidas_elmer').get().c

    const upsert = db.prepare(`
      INSERT INTO medidas_elmer (referencia_elmer, descripcion, proveedor, largo_cm, ancho_cm, alto_cm, actualizado)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(referencia_elmer) DO UPDATE SET
        descripcion = excluded.descripcion,
        proveedor   = excluded.proveedor,
        largo_cm    = excluded.largo_cm,
        ancho_cm    = excluded.ancho_cm,
        alto_cm     = excluded.alto_cm,
        actualizado = excluded.actualizado
    `)

    let inserted = 0
    let updated  = 0
    const existingRefs = new Set(
      db.prepare('SELECT referencia_elmer FROM medidas_elmer').all().map(r => r.referencia_elmer)
    )

    const tx = db.transaction(() => {
      for (const r of rows) {
        if (existingRefs.has(r.referenciaElmer)) updated++
        else inserted++
        upsert.run(r.referenciaElmer, r.descripcion, r.proveedor, r.largoCm, r.anchoCm, r.altoCm)
      }

      // Delete refs no longer present in the new Excel
      const all = db.prepare('SELECT referencia_elmer FROM medidas_elmer').all()
      const toDelete = all.filter(x => !keepRefs.has(x.referencia_elmer)).map(x => x.referencia_elmer)
      const delStmt = db.prepare('DELETE FROM medidas_elmer WHERE referencia_elmer = ?')
      for (const ref of toDelete) delStmt.run(ref)

      return { deleted: toDelete.length }
    })

    const { deleted } = tx()
    const after = db.prepare('SELECT COUNT(*) as c FROM medidas_elmer').get().c

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

ipcMain.handle('search-medidas-elmer', (event, { query, limit }) => {
  const q = String(query || '').trim()
  const lim = Math.min(parseInt(limit) || 15, 50)
  if (!q) return []
  return getDb()
    .prepare('SELECT * FROM medidas_elmer WHERE referencia_elmer LIKE ? ORDER BY referencia_elmer ASC LIMIT ?')
    .all(q + '%', lim)
})

ipcMain.handle('count-medidas-elmer', () => {
  return getDb().prepare('SELECT COUNT(*) as c FROM medidas_elmer').get().c
})

ipcMain.handle('get-medidas-elmer-by-ref', (event, { referencia }) => {
  const ref = String(referencia || '').trim()
  if (!ref) return null
  return getDb().prepare('SELECT * FROM medidas_elmer WHERE referencia_elmer = ?').get(ref) || null
})

ipcMain.handle('calcular-medidas-elmer', (event, { referencia, cpPrefix }) => {
  const ref = String(referencia || '').trim()
  const cp  = String(cpPrefix || '').trim().padStart(2, '0').slice(0, 2)
  if (!ref) return { ok: false, error: 'Falta la referencia.' }
  if (!/^\d{2}$/.test(cp)) return { ok: false, error: 'CP inválido (se esperan 2 dígitos).' }

  const db = getDb()
  const row = db.prepare('SELECT * FROM medidas_elmer WHERE referencia_elmer = ?').get(ref)
  if (!row) return { ok: false, error: 'Referencia no encontrada en la base de datos.' }

  // Obtener nombre de provincia
  const prov = db.prepare('SELECT nombre FROM provincias WHERE cp_prefix = ?').get(cp)
  const provinciaNombre = prov ? prov.nombre : null

  // Las medidas ya vienen con +5 aplicado desde el Excel — NO sumar nada
  const largoCm = row.largo_cm
  const anchoCm = row.ancho_cm
  const altoCm  = row.alto_cm

  const resultados = calcularTarifas({
    largoCm,
    anchoCm,
    altoCm,
    cpPrefix: cp,
    bultos: [{ largoCm, anchoCm, altoCm }],
  })

  // Restricciones: DHL nunca, GLS solo si largo <= 110
  const filtrados = resultados.filter(r => {
    const nombre = (r.agencia?.nombre || '').toLowerCase()
    if (nombre.includes('dhl')) return false
    if (nombre.includes('gls') && largoCm > 110) return false
    return true
  })

  return {
    ok: true,
    medida: row,
    cpPrefix: cp,
    provinciaNombre,
    resultados: filtrados,
  }
})
