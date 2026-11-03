/**
 * Pruebas de la orden de carga: funciones puras (sin BD).
 * Uso: ELECTRON_RUN_AS_NODE=1 TZ=Europe/Madrid node_modules/electron/dist/electron.exe scripts/test-orden-carga.js
 */
const assert = require('node:assert/strict')
const { motivoFueraDeNorma } = require('../src/main/services/elegibilidad')
const { islaDeZona, motivoNoElegible, recalculoPropio, elegirAlternativa, construirFila, ordenarFilas } =
  require('../src/main/services/ordenCargaService')

let fallos = 0
function caso(nombre, fn) {
  try { fn(); console.log('ok   ' + nombre) }
  catch (e) { fallos++; console.log('FAIL ' + nombre + '\n     ' + String(e.message).split('\n')[0]) }
}

// Resultado con la forma de calcularTarifas; extra.agencia / extra.zona se fusionan con los valores por defecto
const res = (id, nombre, precio, extra = {}) => ({
  precioFinal: precio, error: null, avisos: [], maxLargoCm: 50, maxSumaDimCm: 100,
  ...extra,
  agencia: { id, nombre, activa: 1, ...extra.agencia },
  zona: { id: id * 100, nombre_zona: 'Zona', multiple_zones: 0, ...extra.zona },
})
const bulto = (l, a, h) => ({ largo_cm: l, ancho_cm: a, alto_cm: h })
const cot = (extra = {}) => ({
  id: 1, cliente_codigo: 'C1', cliente_razon_social: 'Cli', destinatario: 'Dest', cp_prefix: '08',
  agencia_id: 1, precio_final: 10, bultos: [bulto(100, 100, 100)], soloPrimerBulto: false, zonaId: null, ...extra,
})
const filaPorM3 = (id, m3, porM3) => ({ id, m3, sobrecostePorM3: porM3, alternativa: { precio: 1 } })
const zon = (id, nombre) => ({ zona: { id, nombre_zona: nombre, multiple_zones: 1 } })

caso('motivoFueraDeNorma GLS/Seur', () => {
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'GLS', maxLargoCm: 110, maxSumaDimCm: 0 }), null)
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'GLS', maxLargoCm: 111, maxSumaDimCm: 0 }), 'GLS: largo > 110 cm')
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'Seur', maxLargoCm: 176, maxSumaDimCm: 0 }), 'Seur fuera de norma')
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'SEUR', maxLargoCm: 10, maxSumaDimCm: 301 }), 'Seur fuera de norma')
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'Seur', maxLargoCm: 10, maxSumaDimCm: 300 }), null)
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'Otra', maxLargoCm: 200, maxSumaDimCm: 900 }), null)
})

caso('orden por sobrecoste/m³', () => {
  const o = ordenarFilas([filaPorM3(1, 1, 5), filaPorM3(2, 1, 20), filaPorM3(3, 1, 10)])
  assert.deepEqual(o.map(f => f.id), [2, 3, 1])
})

caso('sin alternativa arriba, entre ellas m³ descendente', () => {
  const sin = (id, m3) => ({ id, m3, sobrecostePorM3: null, alternativa: null })
  const o = ordenarFilas([filaPorM3(1, 1, 99), sin(2, 1), sin(3, 3)])
  assert.deepEqual(o.map(f => f.id), [3, 2, 1])
})

caso('empate por m³', () => {
  const o = ordenarFilas([filaPorM3(1, 1, 10), filaPorM3(2, 3, 10)])
  assert.deepEqual(o.map(f => f.id), [2, 1])
})

caso('porM3 null va tras las que tienen valor', () => {
  const o = ordenarFilas([filaPorM3(1, 0, null), filaPorM3(2, 1, 1)])
  assert.deepEqual(o.map(f => f.id), [2, 1])
})

caso('sobrecoste negativo marcado', () => {
  const f = construirFila(cot({ precio_final: 20 }), [res(1, 'Propia', 20), res(2, 'Barata', 15)])
  assert.equal(f.sobrecoste, -5)
  assert.ok(f.avisos.includes('Más barato con Barata'))
})

caso('excluye propia, inactivas y no elegibles', () => {
  const rs = [
    res(1, 'Propia', 5),
    res(2, 'Inactiva', 6, { agencia: { activa: 0 } }),
    res(3, 'SinPrecio', null, { error: 'x' }),
    res(4, 'GLS', 7, { maxLargoCm: 120 }),
    res(5, 'Seur', 8, { maxSumaDimCm: 310 }),
    res(6, 'Valida', 30),
  ]
  assert.equal(motivoNoElegible(rs[2]), 'x')
  assert.equal(motivoNoElegible(res(7, 'Z', null)), 'Sin precio')
  assert.equal(motivoNoElegible(rs[3]), 'GLS: largo > 110 cm')
  const a = elegirAlternativa(rs, { agenciaId: 1, isla: null })
  assert.equal(a.resultado.agencia.id, 6)
})

caso('DSV con aviso >2.500 kg vale y pasa con prefijo', () => {
  const av = 'Más de 2.500 kg: solicite cotización a su comercial DSV'
  const f = construirFila(cot(), [res(1, 'Propia', 10), res(2, 'DSV', 40, { avisos: [av] })])
  assert.equal(f.alternativa.agencia, 'DSV')
  assert.ok(f.avisos.includes('DSV: ' + av))
})

caso('islaDeZona', () => {
  assert.equal(islaDeZona('Baleares-Palma'), 'Mallorca')
  assert.equal(islaDeZona('Ibiza'), 'Ibiza')
  assert.equal(islaDeZona('Baleares'), null)
  assert.equal(islaDeZona('Zona 11'), null)
})

caso('misma isla deducida por precio', () => {
  const rs = [res(1, 'Propia', 10, zon(101, 'Mallorca')), res(1, 'Propia', 20, zon(102, 'Ibiza')),
    res(2, 'Alt', 30, zon(201, 'Baleares-Palma')), res(2, 'Alt', 10, zon(202, 'Baleares-Ibiza'))]
  const f = construirFila(cot(), rs)
  assert.equal(f.alternativa.precio, 30)
  assert.ok(!f.avisos.includes('Isla sin confirmar'))
})

caso('isla por zonaId guardada', () => {
  const rs = [res(1, 'Propia', 10, zon(101, 'Mallorca')), res(1, 'Propia', 10, zon(102, 'Ibiza')),
    res(2, 'Alt', 30, zon(201, 'Baleares-Palma')), res(2, 'Alt', 12, zon(202, 'Baleares-Ibiza'))]
  const f = construirFila(cot({ zonaId: 102 }), rs)
  assert.equal(f.alternativa.zona, 'Baleares-Ibiza')
  assert.ok(!f.avisos.includes('Isla sin confirmar'))
})

caso('isla sin confirmar', () => {
  const rs = [res(1, 'Propia', 10, zon(101, 'Mallorca')), res(1, 'Propia', 10, zon(102, 'Ibiza')),
    res(2, 'Alt', 30, zon(201, 'Baleares-Palma')), res(2, 'Alt', 12, zon(202, 'Baleares-Ibiza'))]
  const f = construirFila(cot(), rs)
  assert.equal(f.alternativa.precio, 12)
  assert.ok(f.avisos.includes('Isla sin confirmar'))
})

caso('propia sin resultado', () => {
  const f = construirFila(cot(), [res(2, 'Alt', 30)])
  assert.equal(f.precioRecalculado, null)
  assert.equal(f.tarifaCambiada, true)
  assert.ok(f.avisos.includes('Sin recalcular: agencia inactiva o sin cobertura'))
})

caso('tarifa cambiada', () => {
  const f = construirFila(cot(), [res(1, 'Propia', 12)])
  assert.equal(f.tarifaCambiada, true)
  assert.ok(f.avisos.includes('Tarifa cambiada'))
})

caso('franja Logística no es tarifa cambiada', () => {
  const rs = [res(1, 'Logística', 12, { zona: { nombre_zona: 'Tarda-Matí' } })]
  assert.ok(!construirFila(cot(), rs, { precioOtraFranja: 10 }).avisos.includes('Tarifa cambiada'))
  assert.ok(construirFila(cot(), rs, { precioOtraFranja: 11 }).avisos.includes('Tarifa cambiada'))
})

caso('sin cobertura en ninguna', () => {
  const f = construirFila(cot(), [res(1, 'Propia', null), res(2, 'Alt', null)])
  assert.equal(f.alternativa, null)
  assert.ok(f.avisos.includes('Sin alternativa: cargar sí o sí'))
})

caso('m³ sumados de todos los bultos', () => {
  const f = construirFila(cot({ bultos: [bulto(120, 80, 100), bulto(60, 40, 40)] }), [res(1, 'Propia', 10)])
  assert.equal(f.numBultos, 2)
  assert.equal(f.m3, 1.056)
})

caso('isla propia sin confirmar con alternativa de una sola zona', () => {
  const rs = [res(1, 'Propia', 10, zon(101, 'Mallorca')), res(1, 'Propia', 10, zon(102, 'Ibiza')),
    res(2, 'Seur', 20, { zona: { id: 201, nombre_zona: 'Baleares', multiple_zones: 0 } })]
  const f = construirFila(cot(), rs)
  assert.equal(f.avisos.filter(a => a === 'Isla sin confirmar').length, 1)
})

caso('bulto con medida null no da NaN', () => {
  const f = construirFila(cot({ bultos: [bulto(100, 100, null)] }), [res(1, 'Propia', 10)])
  assert.equal(f.m3, 0)
  assert.equal(ordenarFilas([f, filaPorM3(2, 1, 1)]).length, 2)
})

caso('recalculoPropio con una sola zona', () => {
  const r = recalculoPropio([res(1, 'P', 10)], { agenciaId: 1, precioGuardado: 10, zonaId: null })
  assert.equal(r.resultado.precioFinal, 10)
  assert.equal(r.islaSinConfirmar, false)
})

// ---- Sección con BD temporal (obtenerOrdenCarga + handler) ----
const fs = require('fs'), os = require('os'), path = require('path'), Module = require('module')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logicompare-orden-'))
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
const { getDb } = require('../src/main/database/connection')
const db = getDb()
const calc = require('../src/main/services/calculationService')
const { obtenerOrdenCarga } = require('../src/main/services/ordenCargaService')
require('../src/main/ipcHandlers/ordenCargaHandler')

db.prepare('UPDATE agencias SET activa = 0').run()
function agencia(nombre, { admiteDebidos = 1, soloDebidos = 0, cp = '46', zona = 'Z', precios = [[0, 1000, 10]] } = {}) {
  const id = db.prepare("INSERT INTO agencias (nombre, baremo, recargo_combustible, recargo_seguro, activa, motor, admite_debidos) VALUES (?, 250, 0, 0, 1, 'estandar', ?)").run(nombre, admiteDebidos).lastInsertRowid
  const zonaId = db.prepare('INSERT INTO zonas_agencia (agencia_id, nombre_zona, solo_debidos) VALUES (?, ?, ?)').run(id, zona, soloDebidos).lastInsertRowid
  db.prepare('INSERT INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)').run(id, zonaId, cp)
  for (const [d, h, p] of precios) db.prepare('INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)').run(id, zonaId, d, h, p)
  return { id, zonaId }
}
// Peso tasable: 1 bulto 100x100x100 = 1 m3 -> 250 kg; 2 bultos = 2 m3 -> 500 kg
const A = agencia('AgA', { precios: [[0, 300, 20], [300, 1000, 50]] })
const B = agencia('AgB', { admiteDebidos: 0, precios: [[0, 300, 30], [300, 1000, 40]] })
agencia('AgC', { soloDebidos: 1, precios: [[0, 1000, 1]] })
const cub = { largoCm: 100, anchoCm: 100, altoCm: 100 }
const ins = (agenciaId, fecha, extra = {}) => db.prepare(
  "INSERT INTO cotizaciones (fecha, largo_cm, ancho_cm, alto_cm, cp_prefix, agencia_id, precio_final, bultos_json, destinatario) VALUES (?, 100, 100, 100, '46', ?, ?, ?, ?)")
  .run(fecha, agenciaId, extra.precio ?? 20, extra.json ?? null, extra.dest ?? 'D').lastInsertRowid
const limpiar = () => db.prepare('DELETE FROM cotizaciones').run()
const pedir = () => obtenerOrdenCarga({ fecha: '2026-11-03', agenciaId: A.id })
const hoy = '2026-11-03 10:00:00'

caso('solo trae esa fecha local y esa agencia', () => {
  limpiar()
  const i1 = ins(A.id, '2026-11-02 23:30:00'), i2 = ins(A.id, hoy)
  ins(A.id, '2026-11-02 12:00:00'); ins(B.id, hoy)
  assert.deepEqual(pedir().map(f => f.id).sort(), [i1, i2].sort())
})

caso('2 bultos = UNA fila con m3 sumados y alternativa con los dos', () => {
  limpiar()
  ins(A.id, hoy, { precio: 50, json: JSON.stringify({ bultos: [cub, cub] }) })
  const f = pedir()
  assert.equal(f.length, 1)
  assert.equal(f[0].numBultos, 2)
  assert.equal(f[0].m3, 2)
  const b2 = calc.calcularTarifas({ cpPrefix: '46', bultos: [cub, cub] }).find(r => r.agencia.id === B.id).precioFinal
  const b1 = calc.calcularTarifas({ cpPrefix: '46', bultos: [cub] }).find(r => r.agencia.id === B.id).precioFinal
  assert.equal(f[0].alternativa.precio, b2)
  assert.notEqual(b2, b1)
})

caso('respeta admite_debidos y solo_debidos como Pagados', () => {
  limpiar(); ins(A.id, hoy)
  const f = pedir()[0]
  assert.equal(f.alternativa.agencia, 'AgB')
  assert.equal(f.alternativa.precio, 30)
})

caso('antigua sin bultos_json: un bulto y aviso', () => {
  limpiar(); ins(A.id, hoy)
  const f = pedir()[0]
  assert.equal(f.numBultos, 1)
  assert.ok(f.avisos.includes('Solo medidas del 1er bulto'))
})

caso('bultos_json corrupto no rompe la lista', () => {
  limpiar(); ins(A.id, hoy, { json: '{no' })
  assert.equal(pedir().length, 1)
})

caso('usa cp5, peso bruto, opciones y producto del JSON', () => {
  limpiar()
  const extras = { cp5: '46001', pesoBruto: 120, opcionesDsv: { x: true }, producto: 'priority', zonaId: A.zonaId }
  ins(A.id, hoy, { json: JSON.stringify({ bultos: [cub], ...extras }) })
  const orig = calc.calcularTarifas
  let args
  calc.calcularTarifas = a => { args = a; return orig(a) }
  try { pedir() } finally { calc.calcularTarifas = orig }
  assert.equal(args.cpPrefix, '46')
  assert.equal(args.cp5, '46001')
  assert.equal(args.pesoBruto, 120)
  assert.deepEqual(args.opcionesDsv, { x: true })
  assert.equal(args.producto, 'priority')
})

caso('CP sin cobertura: fila sin alternativa ni recalculo, sin lanzar', () => {
  limpiar()
  db.prepare("INSERT INTO cotizaciones (fecha, largo_cm, ancho_cm, alto_cm, cp_prefix, agencia_id, precio_final) VALUES (?, 10, 10, 10, '99', ?, 5)").run(hoy, A.id)
  const f = pedir()[0]
  assert.equal(f.alternativa, null)
  assert.equal(f.precioRecalculado, null)
})

caso('Logística: precio de la otra franja no marca Tarifa cambiada', () => {
  limpiar()
  const L = agencia('Logística', { cp: '08', zona: 'Matí-Tarda', precios: [[0, 1000, 12]] })
  const z2 = db.prepare("INSERT INTO zonas_agencia (agencia_id, nombre_zona) VALUES (?, 'Tarda-Matí')").run(L.id).lastInsertRowid
  db.prepare("INSERT INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, '08')").run(L.id, z2)
  db.prepare('INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, 0, 1000, 15)').run(L.id, z2)
  const insL = p => db.prepare("INSERT INTO cotizaciones (fecha, largo_cm, ancho_cm, alto_cm, cp_prefix, agencia_id, precio_final) VALUES (?, 100, 100, 100, '08', ?, ?)").run(hoy, L.id, p)
  insL(12); insL(15); insL(13)
  const filas = obtenerOrdenCarga({ fecha: '2026-11-03', agenciaId: L.id })
  const cambiada = Object.fromEntries(filas.map(f => [f.precioGuardado, f.tarifaCambiada]))
  assert.deepEqual(cambiada, { 12: false, 15: false, 13: true })
  db.prepare('UPDATE agencias SET activa = 0 WHERE id = ?').run(L.id)
})

caso('handler: validación y resultado', () => {
  const mal = handlers['get-orden-carga'](null, { fecha: 'xx', agenciaId: A.id })
  assert.equal(mal.ok, false); assert.ok(mal.error)
  assert.equal(handlers['get-orden-carga'](null, { fecha: '2026-11-03', agenciaId: 'a' }).ok, false)
  const nulo = handlers['get-orden-carga'](null, null)
  assert.equal(nulo.ok, false); assert.ok(nulo.error)
  assert.equal(handlers['get-orden-carga'](null, { fecha: '2026-02-31', agenciaId: A.id }).ok, false)
  limpiar(); ins(A.id, hoy)
  const bien = handlers['get-orden-carga'](null, { fecha: '2026-11-03', agenciaId: A.id })
  assert.equal(bien.ok, true); assert.equal(bien.filas.length, 1)
})

console.log(fallos ? `\n${fallos} fallos` : '\nTodo ok')
process.exit(fallos ? 1 : 0)
