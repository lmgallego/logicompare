const { ipcMain, dialog } = require('electron')
const XLSX = require('xlsx')
const { getDb } = require('../database/connection')

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

function parseClientesXlsx(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false })
  const firstSheet = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstSheet]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

  if (rows.length < 2) {
    return { rows: [], warnings: ['El archivo no contiene datos.'] }
  }

  const headers = rows[0].map(h => String(h || ''))
  const iCod = findColIndex(headers, ['cliente', 'codigo', 'código', 'cod'])
  const iRaz = findColIndex(headers, ['razon social', 'razón social', 'razon', 'nombre', 'apellidos'])

  if (iCod < 0 || iRaz < 0) {
    throw new Error(
      'Cabeceras no reconocidas. Se esperan columnas como "Cliente" (código) y "Razón social". ' +
      'Detectadas: ' + headers.join(', ')
    )
  }

  const out = []
  const warnings = []
  const seen = new Set()

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r || r.length === 0) continue
    const codigo = String(r[iCod] ?? '').trim()
    const razon  = String(r[iRaz] ?? '').trim()
    if (!codigo) continue
    if (!razon) {
      warnings.push(`Fila ${i + 1} (${codigo}): razón social vacía — omitida.`)
      continue
    }
    if (seen.has(codigo)) {
      warnings.push(`Cliente duplicado "${codigo}" en el Excel — se conserva la última fila.`)
    }
    seen.add(codigo)
    out.push({ codigo, razon })
  }

  return { rows: out, warnings }
}

// ── IPC handlers ────────────────────────────────────────────────────────────
ipcMain.handle('import-clientes-xlsx', async (event, options) => {
  const replaceAll = !!(options && options.replaceAll)
  const result = await dialog.showOpenDialog({
    title: 'Selecciona el Excel de clientes',
    filters: [{ name: 'Excel', extensions: ['xlsx', 'xls'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }

  const filePath = result.filePaths[0]

  try {
    const { rows, warnings } = parseClientesXlsx(filePath)
    if (rows.length === 0) {
      return { ok: false, error: 'No se encontraron filas válidas en el Excel.', warnings }
    }

    const db = getDb()
    const before = db.prepare('SELECT COUNT(*) as c FROM clientes').get().c

    const upsert = db.prepare(`
      INSERT INTO clientes (codigo, razon_social, actualizado)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(codigo) DO UPDATE SET
        razon_social = excluded.razon_social,
        actualizado  = excluded.actualizado
    `)

    const existingRefs = new Set(db.prepare('SELECT codigo FROM clientes').all().map(r => r.codigo))
    let inserted = 0, updated = 0, deleted = 0

    const tx = db.transaction(() => {
      for (const r of rows) {
        if (existingRefs.has(r.codigo)) updated++
        else inserted++
        upsert.run(r.codigo, r.razon)
      }
      // Por defecto: comportamiento "merge" (solo añade nuevos y actualiza existentes; no borra).
      // Si replaceAll=true, eliminamos los códigos que ya no estén en el Excel.
      if (replaceAll) {
        const keep = new Set(rows.map(r => r.codigo))
        const all = db.prepare('SELECT codigo FROM clientes').all()
        const toDelete = all.filter(x => !keep.has(x.codigo)).map(x => x.codigo)
        const delStmt = db.prepare('DELETE FROM clientes WHERE codigo = ?')
        for (const c of toDelete) delStmt.run(c)
        deleted = toDelete.length
      }
    })

    tx()
    const after = db.prepare('SELECT COUNT(*) as c FROM clientes').get().c

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
        modo: replaceAll ? 'reemplazar' : 'añadir/actualizar',
      },
      warnings,
    }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('get-cliente-by-codigo', (event, { codigo }) => {
  const c = String(codigo || '').trim()
  if (!c) return null
  return getDb().prepare('SELECT * FROM clientes WHERE codigo = ?').get(c)
})

ipcMain.handle('search-clientes', (event, { query, limit }) => {
  const q = String(query || '').trim()
  const lim = Math.min(parseInt(limit) || 20, 50)
  if (!q) return []
  // Match by code prefix OR by name substring (case-insensitive)
  return getDb().prepare(`
    SELECT * FROM clientes
     WHERE codigo LIKE ? OR LOWER(razon_social) LIKE ?
     ORDER BY
       CASE WHEN codigo LIKE ? THEN 0 ELSE 1 END,
       codigo ASC
     LIMIT ?
  `).all(q + '%', '%' + q.toLowerCase() + '%', q + '%', lim)
})

ipcMain.handle('count-clientes', () => {
  return getDb().prepare('SELECT COUNT(*) as c FROM clientes').get().c
})
