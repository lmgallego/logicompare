/**
 * Pruebas del filtro por fechas del historial (hora local vs UTC) y del límite de 500.
 * Ejecuta los handlers reales de quoteHandler.js contra una BD temporal con las migraciones.
 *
 * Uso (better-sqlite3 está compilado para Electron):
 *   set ELECTRON_RUN_AS_NODE=1& set TZ=Europe/Madrid
 *   node_modules\electron\dist\electron.exe scripts/test-fechas.js
 */
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

// Las fechas esperadas asumen España (UTC+2 en verano, UTC+1 en invierno)
if (new Date('2026-08-01T00:00:00Z').getTimezoneOffset() !== -120 || new Date('2026-01-15T00:00:00Z').getTimezoneOffset() !== -60) {
  console.error('Zona horaria distinta de Europe/Madrid: ejecuta con TZ=Europe/Madrid')
  process.exit(2)
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logicompare-fechas-'))
const handlers = {}
const loadOriginal = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return {
    app: { getPath: () => tmpDir },
    ipcMain: { handle: (canal, fn) => { handlers[canal] = fn }, removeHandler: () => {} },
    dialog: {},
  }
  return loadOriginal.call(this, request, ...rest)
}

require('../src/main/ipcHandlers/quoteHandler')
const { getDb } = require('../src/main/database/connection')
const db = getDb()
const call = (canal, datos) => handlers[canal](null, datos)

const insertUtc = db.prepare("INSERT INTO cotizaciones (fecha, largo_cm, ancho_cm, alto_cm, cp_prefix, precio_final) VALUES (?, 10, 10, 10, '29', 1)")
const reset = () => db.prepare('DELETE FROM cotizaciones').run()
const agosto = { desde: '2026-08-01', hasta: '2026-08-31' }
const fechasAgosto = () => call('get-history', agosto).rows.map(r => r.fecha).sort()

function caso(nombre, fn) {
  reset()
  try { fn(); console.log('  ok  ', nombre) } catch (e) { console.log('  FALLO', nombre, '\n', e.message); process.exitCode = 1 }
}

caso('00:30 local del día 1 (22:30 UTC del día anterior) entra en el mes', () => {
  insertUtc.run('2026-07-31 22:30:00')
  assert.deepEqual(fechasAgosto(), ['2026-07-31 22:30:00'])
})

caso('23:30 local del último día entra', () => {
  insertUtc.run('2026-08-31 21:30:00')
  assert.deepEqual(fechasAgosto(), ['2026-08-31 21:30:00'])
})

caso('00:30 local del día siguiente al rango no entra', () => {
  insertUtc.run('2026-08-31 22:30:00')
  assert.deepEqual(fechasAgosto(), [])
})

caso('manual guardada para el día X sale el día X (12:00 local, en UTC)', () => {
  assert.equal(call('save-quote-manual', { fecha: '2026-08-15', largoCm: 1, anchoCm: 1, altoCm: 1, cpPrefix: '29', precioFinal: 1 }).ok, true)
  assert.equal(call('save-quote-manual', { fecha: '2026-01-15', largoCm: 1, anchoCm: 1, altoCm: 1, cpPrefix: '29', precioFinal: 1 }).ok, true)
  assert.deepEqual(call('get-history', { desde: '2026-08-15', hasta: '2026-08-15' }).rows.map(r => r.fecha), ['2026-08-15 10:00:00'])
  assert.deepEqual(call('get-history', { desde: '2026-01-15', hasta: '2026-01-15' }).rows.map(r => r.fecha), ['2026-01-15 11:00:00'])
})

caso('editar con fecha local la guarda en UTC', () => {
  const { lastInsertRowid: id } = insertUtc.run('2026-08-10 08:00:00')
  call('update-quote', { id, fecha: '2026-08-01 00:30:00', largoCm: 10, anchoCm: 10, altoCm: 10, cpPrefix: '29', precioFinal: 1 })
  assert.deepEqual(fechasAgosto(), ['2026-07-31 22:30:00'])
})

caso('más de 500 en el rango: se devuelven todas; sin filtro se avisa del límite', () => {
  db.transaction(() => { for (let i = 0; i < 600; i++) insertUtc.run('2026-08-10 08:00:00') })()
  insertUtc.run('2026-07-31 22:30:00')
  const r = call('get-history', agosto)
  assert.equal(r.rows.length, 601)
  assert.equal(r.truncado, false)
  const sinFiltro = call('get-history', {})
  assert.equal(sinFiltro.rows.length, 500)
  assert.equal(sinFiltro.truncado, true)
  assert.equal(call('get-history', { sinLimite: true }).rows.length, 601)
})

caso('delete-history borra el mismo rango que muestra el filtro', () => {
  ;['2026-07-31 21:30:00', '2026-07-31 22:30:00', '2026-08-31 21:30:00', '2026-08-31 22:30:00'].forEach(f => insertUtc.run(f))
  assert.equal(call('delete-history', agosto).deleted, 2)
  assert.deepEqual(db.prepare('SELECT fecha FROM cotizaciones ORDER BY fecha').all().map(r => r.fecha), ['2026-07-31 21:30:00', '2026-08-31 22:30:00'])
})

caso('analytics: las 00:30 local de ayer cuentan como ayer', () => {
  const ayer = db.prepare("SELECT datetime('now','localtime','-1 day','start of day','+30 minutes','utc') f").get().f
  insertUtc.run(ayer)
  assert.equal(call('get-analytics').comparativaDia.ayer_n, 1)
})

db.close()
fs.rmSync(tmpDir, { recursive: true, force: true })
