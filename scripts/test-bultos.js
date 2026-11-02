/**
 * Pruebas de cotizaciones.bultos_json (todos los bultos de una cotización) y num_bultos.
 * Ejecuta los handlers reales de quoteHandler.js contra una BD temporal con las migraciones.
 *
 * Uso (better-sqlite3 está compilado para Electron):
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/test-bultos.js [ruta.db]
 * Con ruta.db se prueba sobre una COPIA de esa BD (la original no se toca).
 */
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logicompare-bultos-'))
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

// Con BD de origen: copia y recuento previo de cotizaciones (y de las que ya tenían bultos_json)
let previas = null
let previasConBultos = 0
if (process.argv[2]) {
  const copia = path.join(tmpDir, 'logicompare.db')
  fs.copyFileSync(process.argv[2], copia)
  const Database = require('better-sqlite3')
  const d = new Database(copia)
  if (d.prepare("SELECT 1 FROM sqlite_master WHERE name = 'cotizaciones'").get()) {
    previas = d.prepare('SELECT COUNT(*) n FROM cotizaciones').get().n
    if (d.prepare('PRAGMA table_info(cotizaciones)').all().some(c => c.name === 'bultos_json')) {
      previasConBultos = d.prepare('SELECT COUNT(*) n FROM cotizaciones WHERE bultos_json IS NOT NULL').get().n
    }
  }
  d.close()
}

require('../src/main/ipcHandlers/quoteHandler')
const { getDb } = require('../src/main/database/connection')
const { runMigrations } = require('../src/main/database/migrations')
const db = getDb()
const call = (canal, datos) => handlers[canal](null, datos)

const reset = () => { db.prepare('DELETE FROM cotizaciones').run(); db.prepare('DELETE FROM cotizaciones_pendientes').run() }
const filas = () => call('get-history', { sinLimite: true }).rows
const ultima = () => filas().sort((a, b) => b.id - a.id)[0]
const base = { cpPrefix: '08', precioFinal: 10 }
const b2 = [{ largoCm: 120, anchoCm: 80, altoCm: 100 }, { largoCm: 60, anchoCm: 40, altoCm: 40, pesoKg: 12 }]
const extras = { cp5: '08001', pesoBruto: 150, opcionesDsv: { incremento_responsabilidad: true }, producto: 'priority' }
const guardar2 = () => { assert.equal(call('save-quote', { ...base, bultos: b2, ...extras }).ok, true); return ultima() }

let primero = true
function caso(nombre, fn) {
  if (!primero) reset()
  primero = false
  try { fn(); console.log('  ok  ', nombre) } catch (e) { console.log('  FALLO', nombre, '\n', e.message); process.exitCode = 1 }
}

caso('migración: existe bultos_json y es idempotente', () => {
  assert.ok(db.prepare('PRAGMA table_info(cotizaciones)').all().some(c => c.name === 'bultos_json'))
  runMigrations(db)
  runMigrations(db)
  if (previas !== null) {
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizaciones').get().n, previas)
    // La migración no rellena bultos_json en ninguna fila existente
    assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizaciones WHERE bultos_json IS NOT NULL').get().n, previasConBultos)
    assert.ok(filas().filter(r => r.bultos_json === null).every(r => r.num_bultos === 1))
  }
})

caso('save-quote con 2 bultos se lee con los 2', () => {
  const r = guardar2()
  assert.equal(r.num_bultos, 2)
  assert.deepEqual([r.largo_cm, r.ancho_cm, r.alto_cm], [120, 80, 100])
  assert.deepEqual(JSON.parse(r.bultos_json), { bultos: b2, ...extras })
})

caso('save-quote sin extras no guarda claves vacías', () => {
  call('save-quote', { ...base, bultos: [b2[0]], opcionesDsv: {}, pesoBruto: null, cp5: null, producto: 'system' })
  assert.deepEqual(Object.keys(JSON.parse(ultima().bultos_json)), ['bultos'])
})

caso('resolver una pendiente de 3 bultos conserva los 3', () => {
  const b3 = [b2[0], b2[1], { largoCm: 10, anchoCm: 10, altoCm: 10 }]
  call('save-pending-quote', { cpPrefix: '08', bultos: b3, resultados: [] })
  const pendingId = call('get-pending-quotes')[0].id
  assert.equal(call('resolve-pending-quote', { ...base, pendingId, bultos: [b2[0]] }).ok, true)
  assert.equal(ultima().num_bultos, 3)
  assert.equal(call('get-pending-quotes').length, 0)
})

caso('resolve con pendingId inexistente usa los bultos del payload', () => {
  assert.equal(call('resolve-pending-quote', { ...base, pendingId: 99999, bultos: b2 }).ok, true)
  assert.equal(ultima().num_bultos, 2)
})

caso('resolve que falla no guarda nada y deja la pendiente', () => {
  call('save-pending-quote', { cpPrefix: '08', bultos: b2, resultados: [] })
  const pendingId = call('get-pending-quotes')[0].id
  db.prepare("UPDATE cotizaciones_pendientes SET bultos_json = 'xx' WHERE id = ?").run(pendingId)
  const res = call('resolve-pending-quote', { ...base, pendingId, bultos: b2 })
  assert.equal(res.ok, false)
  assert.ok(res.error)
  assert.equal(filas().length, 0)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizaciones_pendientes WHERE id = ?').get(pendingId).n, 1)
})

caso('manual conserva su bulto', () => {
  assert.equal(call('save-quote-manual', { ...base, fecha: '2026-08-15', largoCm: 50, anchoCm: 40, altoCm: 30 }).ok, true)
  const r = ultima()
  assert.deepEqual(JSON.parse(r.bultos_json).bultos, [{ largoCm: 50, anchoCm: 40, altoCm: 30 }])
  assert.equal(r.num_bultos, 1)
})

caso('update conserva los bultos y actualiza el primero', () => {
  const { id } = guardar2()
  assert.equal(call('update-quote', { ...base, id, largoCm: 130, anchoCm: 80, altoCm: 100 }).ok, true)
  const r = ultima()
  const j = JSON.parse(r.bultos_json)
  assert.equal(r.num_bultos, 2)
  assert.equal(j.bultos[0].largoCm, 130)
  assert.deepEqual(j.bultos[1], b2[1])
  assert.equal(j.cp5, '08001')
  assert.equal(r.largo_cm, 130)
})

caso('update con bultos en el payload los reescribe', () => {
  const { id } = guardar2()
  const b3 = [b2[0], b2[1], b2[0]]
  assert.equal(call('update-quote', { ...base, id, largoCm: 120, anchoCm: 80, altoCm: 100, bultos: b3 }).ok, true)
  assert.equal(ultima().num_bultos, 3)
})

caso('update con bultos en el payload conserva cp5, peso bruto, opciones y producto', () => {
  const { id } = guardar2()
  const b3 = [b2[1], b2[0], { largoCm: 10, anchoCm: 10, altoCm: 10 }]
  assert.equal(call('update-quote', { ...base, id, largoCm: 60, anchoCm: 40, altoCm: 40, bultos: b3 }).ok, true)
  assert.deepEqual(JSON.parse(ultima().bultos_json), { bultos: b3, ...extras })
})

caso('editada por una versión antigua: el primer bulto sale de las columnas', () => {
  const { id } = guardar2()
  // La versión antigua solo actualiza largo/ancho/alto, no bultos_json
  db.prepare("UPDATE cotizaciones SET largo_cm = 140, ancho_cm = 90, alto_cm = 110, cliente_codigo = 'T2' WHERE id = ?").run(id)
  for (const r of [ultima(), call('get-quotes-by-cliente', { clienteCodigo: 'T2' })[0]]) {
    const j = JSON.parse(r.bultos_json)
    assert.deepEqual(j.bultos[0], { largoCm: 140, anchoCm: 90, altoCm: 110 })
    assert.deepEqual(j.bultos[1], b2[1])
    assert.equal(j.cp5, '08001')
    assert.equal(r.num_bultos, 2)
  }
})

caso('antigua sin bultos_json se lee como 1 bulto y update no la migra', () => {
  const { lastInsertRowid: id } = db.prepare("INSERT INTO cotizaciones (largo_cm, ancho_cm, alto_cm, cp_prefix, precio_final, cliente_codigo) VALUES (10, 10, 10, '29', 1, 'T1')").run()
  assert.equal(ultima().num_bultos, 1)
  assert.equal(call('get-quotes-by-cliente', { clienteCodigo: 'T1' })[0].num_bultos, 1)
  assert.equal(call('update-quote', { ...base, id, largoCm: 11, anchoCm: 10, altoCm: 10 }).ok, true)
  assert.equal(ultima().bultos_json, null)
})

caso('bultos_json corrupto no rompe update', () => {
  const { id } = guardar2()
  db.prepare("UPDATE cotizaciones SET bultos_json = 'xx'").run()
  assert.equal(call('update-quote', { ...base, id, largoCm: 11, anchoCm: 10, altoCm: 10 }).ok, true)
  assert.equal(ultima().bultos_json, 'xx')
  assert.equal(ultima().num_bultos, 1)
})

db.close()
fs.rmSync(tmpDir, { recursive: true, force: true })
