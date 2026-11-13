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

caso('save-quote guarda la zona', () => {
  call('save-quote', { ...base, bultos: b2, zonaId: 127, zonaNombre: 'Mallorca' })
  const j = JSON.parse(ultima().bultos_json)
  assert.equal(j.zonaId, 127)
  assert.equal(j.zonaNombre, 'Mallorca')
})

caso('sin zona no hay claves zonaId/zonaNombre', () => {
  call('save-quote', { ...base, bultos: b2, zonaId: null, zonaNombre: null })
  assert.deepEqual(Object.keys(JSON.parse(ultima().bultos_json)), ['bultos'])
})

caso('resolve guarda la zona del resultado elegido', () => {
  call('save-pending-quote', { cpPrefix: '07', bultos: b2, resultados: [] })
  const pendingId = call('get-pending-quotes')[0].id
  assert.equal(call('resolve-pending-quote', { ...base, pendingId, zonaId: 5, zonaNombre: 'Menorca' }).ok, true)
  const j = JSON.parse(ultima().bultos_json)
  assert.equal(j.zonaId, 5)
  assert.equal(j.zonaNombre, 'Menorca')
  assert.equal(j.bultos.length, 2)
})

caso('update con bultos conserva la zona', () => {
  call('save-quote', { ...base, bultos: b2, zonaId: 127, zonaNombre: 'Mallorca' })
  const { id } = ultima()
  assert.equal(call('update-quote', { ...base, id, largoCm: 120, anchoCm: 80, altoCm: 100, bultos: [b2[0]] }).ok, true)
  const j = JSON.parse(ultima().bultos_json)
  assert.equal(j.zonaId, 127)
  assert.equal(j.zonaNombre, 'Mallorca')
  assert.equal(j.bultos.length, 1)
})

caso('update de 3 bultos con zona: solo cambia el primero', () => {
  const b3 = [b2[0], b2[1], { largoCm: 10, anchoCm: 20, altoCm: 30, pesoKg: 2 }]
  call('save-quote', { ...base, bultos: b3, ...extras, zonaId: 127, zonaNombre: 'Mallorca' })
  const { id } = ultima()
  assert.equal(call('update-quote', { ...base, id, largoCm: 77, anchoCm: 66, altoCm: 55 }).ok, true)
  const r = ultima()
  const j = JSON.parse(r.bultos_json)
  assert.deepEqual(j.bultos[0], { ...b3[0], largoCm: 77, anchoCm: 66, altoCm: 55 })
  assert.deepEqual(j.bultos.slice(1), b3.slice(1))
  assert.deepEqual({ ...j, bultos: undefined }, { ...extras, zonaId: 127, zonaNombre: 'Mallorca', bultos: undefined })
  assert.deepEqual([r.largo_cm, r.ancho_cm, r.alto_cm], [77, 66, 55])
  assert.equal(r.num_bultos, 3)
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
  assert.equal(ultima().largo_cm, 11)
})

caso('bultos_json corrupto no rompe update', () => {
  const { id } = guardar2()
  db.prepare("UPDATE cotizaciones SET bultos_json = 'xx'").run()
  assert.equal(call('update-quote', { ...base, id, largoCm: 11, anchoCm: 10, altoCm: 10 }).ok, true)
  assert.equal(ultima().bultos_json, 'xx')
  assert.equal(ultima().num_bultos, 1)
})

// ---- Peso por bulto (volumétrico: m³ × baremo de la agencia, kg enteros hacia arriba) ----
const { pesoBulto } = require('../src/main/services/bultosCotizacion')
const nuevaAgencia = (nombre, baremo, motor = 'estandar') => db.prepare(
  "INSERT INTO agencias (nombre, baremo, recargo_combustible, recargo_seguro, activa, motor) VALUES (?, ?, 0, 0, 1, ?)").run(nombre, baremo, motor).lastInsertRowid
const dsvId = nuevaAgencia('DSV prueba', 220, 'reglas')
const otraId = nuevaAgencia('Otra prueba', 270)
const zonaIslas = db.prepare("INSERT INTO zonas_agencia (agencia_id, nombre_zona, baremo) VALUES (?, 'Baleares prueba', 333)").run(dsvId).lastInsertRowid
// 0,96 m³ · 0,096 m³ · 0,006 m³
const b3p = [{ largoCm: 120, anchoCm: 80, altoCm: 100 }, { largoCm: 60, anchoCm: 40, altoCm: 40 }, { largoCm: 10, anchoCm: 20, altoCm: 30 }]
const pesos = r => JSON.parse(r.bultos_json).bultos.map(b => b.pesoKg)

caso('peso por bulto: 3 bultos con DSV (220)', () => {
  call('save-quote', { ...base, agenciaId: dsvId, bultos: b3p, zonaId: null })
  const j = JSON.parse(ultima().bultos_json)
  assert.deepEqual(pesos(ultima()), [212, 22, 2]) // 211,2 · 21,12 · 1,32 hacia arriba
  assert.equal(j.baremoKgM3, 220)
  assert.deepEqual(j.bultos.map(({ pesoKg, ...b }) => b), b3p)
})

caso('peso por bulto: la misma con otra agencia usa su baremo (270)', () => {
  call('save-quote', { ...base, agenciaId: otraId, bultos: b3p })
  assert.deepEqual(pesos(ultima()), [260, 26, 2])
  assert.equal(JSON.parse(ultima().bultos_json).baremoKgM3, 270)
})

caso('peso por bulto: DSV en zona con baremo propio (islas 333)', () => {
  call('save-quote', { ...base, agenciaId: dsvId, bultos: b3p, zonaId: zonaIslas })
  assert.deepEqual(pesos(ultima()), [320, 32, 2])
})

caso('peso por bulto: manual y resolve-pending también lo guardan', () => {
  call('save-quote-manual', { ...base, agenciaId: otraId, largoCm: 60, anchoCm: 40, altoCm: 40 })
  assert.deepEqual(pesos(ultima()), [26])
  call('save-pending-quote', { cpPrefix: '08', bultos: b3p, resultados: [] })
  const pendingId = call('get-pending-quotes')[0].id
  call('resolve-pending-quote', { ...base, pendingId, agenciaId: dsvId })
  assert.deepEqual(pesos(ultima()), [212, 22, 2])
})

caso('peso por bulto: update del bulto 1 recalcula solo ese peso', () => {
  call('save-quote', { ...base, agenciaId: dsvId, bultos: b3p })
  const { id } = ultima()
  // Peso del bulto 2 alterado a mano: si se conserva, no se ha recalculado
  const j = JSON.parse(ultima().bultos_json); j.bultos[1].pesoKg = 999
  db.prepare('UPDATE cotizaciones SET bultos_json = ? WHERE id = ?').run(JSON.stringify(j), id)
  assert.equal(call('update-quote', { ...base, id, agenciaId: dsvId, largoCm: 130, anchoCm: 80, altoCm: 100 }).ok, true)
  assert.deepEqual(pesos(ultima()), [229, 999, 2]) // 1,04 m³ × 220 = 228,8
  // Mismas medidas: el peso del bulto 1 se conserva tal cual
  assert.equal(call('update-quote', { ...base, id, agenciaId: dsvId, largoCm: 130, anchoCm: 80, altoCm: 100 }).ok, true)
  assert.deepEqual(pesos(ultima()), [229, 999, 2])
  // Otra agencia (otro baremo): se recalculan todos
  assert.equal(call('update-quote', { ...base, id, agenciaId: otraId, largoCm: 130, anchoCm: 80, altoCm: 100 }).ok, true)
  assert.deepEqual(pesos(ultima()), [281, 26, 2])
})

caso('peso por bulto: antigua sin pesoKg se calcula al vuelo, sin migrar', () => {
  const json = JSON.stringify({ bultos: b3p })
  const { lastInsertRowid: id } = db.prepare("INSERT INTO cotizaciones (largo_cm, ancho_cm, alto_cm, cp_prefix, precio_final, agencia_id, bultos_json, cliente_codigo) VALUES (120, 80, 100, '08', 1, ?, ?, 'T3')").run(dsvId, json)
  assert.deepEqual(ultima().pesos_bultos, [212, 22, 2])
  assert.deepEqual(call('get-quotes-by-cliente', { clienteCodigo: 'T3' })[0].pesos_bultos, [212, 22, 2])
  assert.equal(db.prepare('SELECT bultos_json FROM cotizaciones WHERE id = ?').get(id).bultos_json, json)
  // Editada por una versión antigua (columnas distintas al JSON): el peso guardado del bulto 1 ya no vale
  call('save-quote', { ...base, agenciaId: dsvId, bultos: b3p })
  db.prepare('UPDATE cotizaciones SET largo_cm = 130 WHERE id = ?').run(ultima().id)
  assert.deepEqual(ultima().pesos_bultos, [229, 22, 2])
})

caso('peso por bulto: con 1 bulto no hay pesos (columna vacía)', () => {
  call('save-quote', { ...base, agenciaId: dsvId, bultos: [b3p[0]] })
  assert.equal(ultima().pesos_bultos, null)
  db.prepare("INSERT INTO cotizaciones (largo_cm, ancho_cm, alto_cm, cp_prefix, precio_final, agencia_id) VALUES (10, 10, 10, '08', 1, ?)").run(dsvId)
  assert.equal(ultima().pesos_bultos, null)
})

caso('peso por bulto: sin agencia no se guarda peso', () => {
  call('save-quote', { ...base, bultos: b3p })
  const j = JSON.parse(ultima().bultos_json)
  assert.ok(j.bultos.every(b => b.pesoKg === undefined))
  assert.equal(j.baremoKgM3, undefined)
})

caso('Excel consolidado: columna final "Pesos por bulto", vacía con 1 bulto o si el origen no la trae', () => {
  const { parseXlsxBuffer, buildMergedXlsx } = require('../src/main/ipcHandlers/supportHandler')
  const fila = extra => ({ fecha: '12/11/2026, 14:45', medidas: '120x80x100', cp_prefix: '08', metros_cubicos: 1.156, peso: 255, agencia_nombre: 'DSV', precio_final: 46.13, precio_redondeado: 46.15, ...extra })
  const filas = [fila({ pesos_bultos: '212 + 22 + 22 kg' }), fila({ fecha: '11/11/2026, 10:00', pesos_bultos: '' }), fila({ fecha: '10/11/2026, 10:00' })]
  for (const simplificada of [false, true]) {
    const leidas = parseXlsxBuffer(buildMergedXlsx(filas, simplificada))
    assert.deepEqual(leidas.map(r => r.pesos_bultos).sort(), ['', '', '212 + 22 + 22 kg'])
    // "Pesos por bulto" no se confunde con la columna "Peso (kg)"
    assert.ok(leidas.every(r => r.peso === (simplificada ? 0 : 255)))
  }
})

caso('Excel consolidado: un duplicado de un Excel antiguo (sin pesos) no pierde "Pesos por bulto"', () => {
  const { deduplicar } = require('../src/main/ipcHandlers/supportHandler')
  const fila = extra => ({ fecha: '12/11/2026, 14:45', medidas: '120x80x100', cp_prefix: '08', agencia_nombre: 'DSV', precio_final: 46.13, pesos_bultos: '', ...extra })
  const nueva = { pesos_bultos: '212 + 22 kg' }
  for (const filas of [[fila(), fila(nueva)], [fila(nueva), fila()]]) {
    const r = deduplicar(filas)
    assert.equal(r.length, 1)
    assert.equal(r[0].pesos_bultos, '212 + 22 kg')
  }
  // Otra hora u otro precio: no es duplicado
  assert.equal(deduplicar([fila(), fila({ fecha: '12/11/2026, 14:46' }), fila({ precio_final: 50 })]).length, 3)
})

caso('Excel consolidado: el simplificado toma la agencia del nombre real de la hoja y avisa', () => {
  const { parseXlsxBuffer, buildMergedXlsx, avisoConsolidado } = require('../src/main/ipcHandlers/supportHandler')
  const fila = (agencia_nombre, extra) => ({ fecha: '12/11/2026, 14:45', medidas: '60x40x40', cp_prefix: '08', metros_cubicos: 0.096, peso: 22, agencia_nombre, precio_final: 24, precio_redondeado: 24, ...extra })
  const filas = [fila('DSV'), fila('Transabadell', { precio_final: 9.8 }), fila('A & B <prueba>')]
  const simple = parseXlsxBuffer(buildMergedXlsx(filas, true))
  assert.deepEqual(simple.map(r => r.agencia_nombre).sort(), ['A & B <prueba>', 'DSV', 'Transabadell'])
  assert.equal(simple.simplificado, true)
  const completo = parseXlsxBuffer(buildMergedXlsx(filas, false))
  assert.ok(!completo.simplificado)
  assert.equal(avisoConsolidado([completo]), null)
  assert.equal(avisoConsolidado([completo, simple]), 'Los Excel simplificados no se pueden cruzar con los completos: puede haber cotizaciones repetidas y sin peso. Para un consolidado exacto, usa solo exportaciones completas.')
})

// El renderer (ESM) tiene su gemelo de pesoBulto y el texto de la columna del informe
async function pruebasRenderer() {
  // Node de Electron trata los .js como CommonJS: se importa como módulo data: (siempre ESM)
  const src = fs.readFileSync(path.join(__dirname, '../src/renderer/js/utils/pesoBulto.js'), 'utf8')
  const r = await import('data:text/javascript,' + encodeURIComponent(src))
  caso('renderer: pesoBulto igual que en main', () => {
    for (const b of [...b3p, { largoCm: 50, anchoCm: 50, altoCm: 40 }, { largoCm: 33.3, anchoCm: 21, altoCm: 7 }])
      for (const baremo of [220, 270, 333, 167]) assert.equal(r.pesoBulto(b, baremo), pesoBulto(b, baremo))
  })
  caso('renderer: texto "Pesos por bulto" (vacío con 1 bulto)', () => {
    assert.equal(r.pesosTexto([21, 21, 35]), '21 + 21 + 35 kg')
    assert.equal(r.pesosTexto([21]), '')
    assert.equal(r.pesosTexto(null), '')
    assert.equal(r.pesosTexto([21, null]), '')
  })
  caso('renderer: baremo del resultado (DSV usa el de la zona)', () => {
    assert.equal(r.baremoDeResultado({ agencia: { motor: 'reglas', baremo: 220 }, zona: { baremo: 333 } }), 333)
    assert.equal(r.baremoDeResultado({ agencia: { motor: 'reglas', baremo: 220 }, zona: { baremo: null } }), 220)
    assert.equal(r.baremoDeResultado({ agencia: { motor: 'estandar', baremo: 270 }, zona: { baremo: 333 } }), 270)
  })
}

pruebasRenderer().finally(() => {
  db.close()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})
