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

// Parse xlsx → array of { codeCospel, referenciaElmer, largoCm, anchoCm, altoCm }
function parseCospelXlsx(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const firstSheet = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheet]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (rows.length < 2) {
    return { rows: [], warnings: ['El archivo no contiene datos.'] }
  }

  const headers = rows[0].map(h => String(h || ''))
  const iCode  = findColIndex(headers, ['code', 'codigo cospel', 'cod'])
  const iRef   = findColIndex(headers, ['referencia elmer', 'referencia', 'ref elmer'])
  const iLargo = findColIndex(headers, ['largo'])
  const iAncho = findColIndex(headers, ['ancho'])
  const iAlto  = findColIndex(headers, ['alto', 'altura'])

  if (iCode < 0 || iRef < 0 || iLargo < 0 || iAncho < 0 || iAlto < 0) {
    throw new Error(
      'Cabeceras no reconocidas. Se esperan columnas: CODE, REFERENCIA ELMER, LARGO, ANCHO, ALTO. ' +
      'Detectadas: ' + headers.join(', ')
    )
  }

  const out = []
  const warnings = []
  const seen = new Set()

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const code = String(r[iCode] ?? '').trim()
    if (!code) continue
    const ref = String(r[iRef] ?? '').trim()

    const largoRaw = toInt(r[iLargo])
    const anchoRaw = toInt(r[iAncho])
    const altoRaw  = toInt(r[iAlto])
    if (largoRaw == null || anchoRaw == null || altoRaw == null) {
      warnings.push(`Fila ${i + 1} (${code}): medida vacía o no numérica — omitida.`)
      continue
    }

    if (seen.has(code)) {
      warnings.push(`Code duplicado "${code}" en el Excel — se conserva la última.`)
    }
    seen.add(code)

    out.push({
      codeCospel: code,
      referenciaElmer: ref || code,
      largoCm: largoRaw + 5,
      anchoCm: anchoRaw + 5,
      altoCm:  altoRaw  + 5,
    })
  }

  return { rows: out, warnings }
}

// ── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('import-cospel-xlsx', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Selecciona el Excel de medidas Cospel',
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }

  const filePath = result.filePaths[0]

  try {
    const { rows, warnings } = parseCospelXlsx(filePath)
    if (rows.length === 0) {
      return { ok: false, error: 'No se encontraron filas válidas en el Excel.', warnings }
    }

    const db = getDb()
    const keepCodes = new Set(rows.map(r => r.codeCospel))
    const before = db.prepare('SELECT COUNT(*) as c FROM cospel').get().c

    const upsert = db.prepare(`
      INSERT INTO cospel (code_cospel, referencia_elmer, largo_cm, ancho_cm, alto_cm, actualizado)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(code_cospel) DO UPDATE SET
        referencia_elmer = excluded.referencia_elmer,
        largo_cm         = excluded.largo_cm,
        ancho_cm         = excluded.ancho_cm,
        alto_cm          = excluded.alto_cm,
        actualizado      = excluded.actualizado
    `)

    let inserted = 0
    let updated  = 0
    const existingCodes = new Set(db.prepare('SELECT code_cospel FROM cospel').all().map(r => r.code_cospel))

    const tx = db.transaction(() => {
      for (const r of rows) {
        if (existingCodes.has(r.codeCospel)) updated++
        else inserted++
        upsert.run(r.codeCospel, r.referenciaElmer, r.largoCm, r.anchoCm, r.altoCm)
      }

      const all = db.prepare('SELECT code_cospel FROM cospel').all()
      const toDelete = all.filter(x => !keepCodes.has(x.code_cospel)).map(x => x.code_cospel)
      const delStmt = db.prepare('DELETE FROM cospel WHERE code_cospel = ?')
      for (const code of toDelete) delStmt.run(code)

      return { deleted: toDelete.length }
    })

    const { deleted } = tx()
    const after = db.prepare('SELECT COUNT(*) as c FROM cospel').get().c

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

ipcMain.handle('search-cospel', (event, { query, limit }) => {
  const q = String(query || '').trim()
  const lim = Math.min(parseInt(limit) || 20, 50)
  if (!q) return []
  return getDb()
    .prepare('SELECT * FROM cospel WHERE referencia_elmer LIKE ? OR code_cospel LIKE ? ORDER BY referencia_elmer ASC LIMIT ?')
    .all(q + '%', q + '%', lim)
})

ipcMain.handle('count-cospel', () => {
  return getDb().prepare('SELECT COUNT(*) as c FROM cospel').get().c
})

ipcMain.handle('calcular-cospel', (event, { referencia, cpPrefix }) => {
  const ref = String(referencia || '').trim()
  const cp  = String(cpPrefix || '').trim().padStart(2, '0').slice(0, 2)
  if (!ref) return { ok: false, error: 'Falta la referencia.' }
  if (!/^\d{2}$/.test(cp)) return { ok: false, error: 'CP inválido (se esperan 2 dígitos).' }

  const db = getDb()
  const row = db.prepare('SELECT * FROM cospel WHERE referencia_elmer = ? OR code_cospel = ?').get(ref, ref)
  if (!row) return { ok: false, error: 'Referencia no encontrada en la base de datos.' }

  // Obtener nombre de provincia
  const prov = db.prepare('SELECT nombre FROM provincias WHERE cp_prefix = ?').get(cp)
  const provinciaNombre = prov ? prov.nombre : null

  // Las medidas ya tienen +5 aplicado desde la importación
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

  // Mismas restricciones que parachoques: DHL nunca, GLS solo si largo <= 110
  const filtrados = resultados.filter(r => {
    const nombre = (r.agencia?.nombre || '').toLowerCase()
    if (nombre.includes('dhl')) return false
    if (nombre.includes('gls') && largoCm > 110) return false
    return true
  })

  return {
    ok: true,
    cospel: row,
    cpPrefix: cp,
    provinciaNombre,
    resultados: filtrados,
  }
})
