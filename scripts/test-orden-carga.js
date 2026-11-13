/**
 * Pruebas de la orden de carga: funciones puras (sin BD).
 * Uso: ELECTRON_RUN_AS_NODE=1 TZ=Europe/Madrid node_modules/electron/dist/electron.exe scripts/test-orden-carga.js
 */
const assert = require('node:assert/strict')
const { motivoFueraDeNorma } = require('../src/main/services/elegibilidad')
const { islaDeZona, motivoNoElegible, recalculoPropio, elegirAlternativa, construirFila, ordenarFilas, proponerPaso } =
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
// El camión destino de las pruebas puras es la agencia 2
const DEST = { id: 2, nombre: 'Alt' }
const fila = (c, rs, extra = {}) => construirFila(c, rs, { destino: DEST, ...extra })
const zon = (id, nombre) => ({ zona: { id, nombre_zona: nombre, multiple_zones: 1 } })
// Fila mínima para ordenar / proponer: pasable si sobrecoste != null
const f = (id, sobrecoste, numBultos = 1, agenciaDestino = 'Alt') =>
  ({ id, numBultos, sobrecoste, agenciaDestino, alternativa: sobrecoste == null ? null : { precio: 1 } })

caso('motivoFueraDeNorma GLS/Seur', () => {
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'GLS', maxLargoCm: 110, maxSumaDimCm: 0 }), null)
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'GLS', maxLargoCm: 111, maxSumaDimCm: 0 }), 'GLS: largo > 110 cm')
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'Seur', maxLargoCm: 176, maxSumaDimCm: 0 }), 'Seur fuera de norma')
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'SEUR', maxLargoCm: 10, maxSumaDimCm: 301 }), 'Seur fuera de norma')
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'Seur', maxLargoCm: 10, maxSumaDimCm: 300 }), null)
  assert.equal(motivoFueraDeNorma({ nombreAgencia: 'Otra', maxLargoCm: 200, maxSumaDimCm: 900 }), null)
})

caso('orden por sobrecoste en euros, de mayor a menor', () => {
  assert.deepEqual(ordenarFilas([f(1, 5), f(2, 20), f(3, -4), f(4, 10)]).map(x => x.id), [2, 4, 1, 3])
})

caso('no pasables arriba, entre ellas más bultos antes', () => {
  assert.deepEqual(ordenarFilas([f(1, 99), f(2, null, 1), f(3, null, 3)]).map(x => x.id), [3, 2, 1])
})

caso('empate de sobrecoste: más bultos antes; los m³ no cuentan', () => {
  const o = ordenarFilas([{ ...f(1, 10, 1), m3: 9 }, { ...f(2, 10, 3), m3: 0.1 }])
  assert.deepEqual(o.map(x => x.id), [2, 1])
})

caso('la alternativa es siempre el destino aunque otra sea más barata', () => {
  const r = fila(cot(), [res(1, 'Propia', 10), res(2, 'Alt', 30), res(3, 'Barata', 11)])
  assert.equal(r.alternativa.agencia, 'Alt')
  assert.equal(r.sobrecoste, 20)
  assert.equal(r.agenciaDestino, 'Alt')
  assert.ok(!('sobrecostePorM3' in r))
})

caso('destino no elegible, sin precio, inactivo o sin zona: No se puede pasar', () => {
  const base = [res(1, 'Propia', 10), res(3, 'Otra', 11)]
  for (const d of [res(2, 'Seur', 12, { maxSumaDimCm: 999 }), res(2, 'Alt', null),
    res(2, 'Alt', 12, { agencia: { activa: 0 } }), null]) {
    const r = fila(cot(), d ? [...base, d] : base)
    assert.equal(r.alternativa, null)
    assert.ok(r.avisos.includes('No se puede pasar a Alt'))
  }
})

caso('sobrecoste negativo marcado', () => {
  const r = fila(cot({ precio_final: 20 }), [res(1, 'Propia', 20), res(2, 'Barata', 15)])
  assert.equal(r.sobrecoste, -5)
  assert.ok(r.avisos.includes('Más barato con Barata'))
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
  const r = fila(cot(), [res(1, 'Propia', 10), res(2, 'DSV', 40, { avisos: [av] })])
  assert.equal(r.alternativa.agencia, 'DSV')
  assert.ok(r.avisos.includes('DSV: ' + av))
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
  const r = fila(cot(), rs)
  assert.equal(r.alternativa.precio, 30)
  assert.ok(!r.avisos.includes('Isla sin confirmar'))
})

caso('isla por zonaId guardada', () => {
  const rs = [res(1, 'Propia', 10, zon(101, 'Mallorca')), res(1, 'Propia', 10, zon(102, 'Ibiza')),
    res(2, 'Alt', 30, zon(201, 'Baleares-Palma')), res(2, 'Alt', 12, zon(202, 'Baleares-Ibiza'))]
  const r = fila(cot({ zonaId: 102 }), rs)
  assert.equal(r.alternativa.zona, 'Baleares-Ibiza')
  assert.ok(!r.avisos.includes('Isla sin confirmar'))
})

caso('isla sin confirmar', () => {
  const rs = [res(1, 'Propia', 10, zon(101, 'Mallorca')), res(1, 'Propia', 10, zon(102, 'Ibiza')),
    res(2, 'Alt', 30, zon(201, 'Baleares-Palma')), res(2, 'Alt', 12, zon(202, 'Baleares-Ibiza'))]
  const r = fila(cot(), rs)
  assert.equal(r.alternativa.precio, 12)
  assert.ok(r.avisos.includes('Isla sin confirmar'))
})

caso('propia sin resultado', () => {
  const r = fila(cot(), [res(2, 'Alt', 30)])
  assert.equal(r.precioRecalculado, null)
  assert.equal(r.tarifaCambiada, true)
  assert.ok(r.avisos.includes('Sin recalcular: agencia inactiva o sin cobertura'))
})

caso('tarifa cambiada', () => {
  const r = fila(cot(), [res(1, 'Propia', 12)])
  assert.equal(r.tarifaCambiada, true)
  assert.ok(r.avisos.includes('Tarifa cambiada'))
})

caso('franja Logística no es tarifa cambiada', () => {
  const rs = [res(1, 'Logística', 12, { zona: { nombre_zona: 'Tarda-Matí' } })]
  assert.ok(!fila(cot(), rs, { precioOtraFranja: 10 }).avisos.includes('Tarifa cambiada'))
  assert.ok(fila(cot(), rs, { precioOtraFranja: 11 }).avisos.includes('Tarifa cambiada'))
})

caso('m³ sumados de todos los bultos (dato, no decide)', () => {
  const r = fila(cot({ bultos: [bulto(120, 80, 100), bulto(60, 40, 40)] }), [res(1, 'Propia', 10)])
  assert.equal(r.numBultos, 2)
  assert.equal(r.m3, 1.056)
})

caso('isla propia sin confirmar con alternativa de una sola zona', () => {
  const rs = [res(1, 'Propia', 10, zon(101, 'Mallorca')), res(1, 'Propia', 10, zon(102, 'Ibiza')),
    res(2, 'Seur', 20, { zona: { id: 201, nombre_zona: 'Baleares', multiple_zones: 0 } })]
  assert.equal(fila(cot(), rs).avisos.filter(a => a === 'Isla sin confirmar').length, 1)
})

const sinNaN = x => Object.values(x).every(v => typeof v !== 'number' || Number.isFinite(v))

caso('bulto con alto vacío: Medidas incompletas y m³ solo del válido', () => {
  const r = fila(cot({ bultos: [bulto(100, 100, 100), bulto(50, 50, '')] }), [res(1, 'Propia', 10), res(2, 'Alt', 30)])
  assert.ok(r.avisos.includes('Medidas incompletas (1 de 2 bultos)'))
  assert.equal(r.m3, 1)
  assert.equal(r.sobrecoste, 20)
})

caso('medidas no válidas: null, 0, negativa, NaN', () => {
  const malos = [bulto(null, 1, 1), bulto(10, 0, 10), bulto(10, 10, -5), bulto('x', 10, 10), bulto(10, NaN, 10)]
  const r = fila(cot({ bultos: [...malos, bulto(100, 100, 100)] }), [res(1, 'Propia', 10)])
  assert.ok(r.avisos.includes('Medidas incompletas (5 de 6 bultos)'))
  assert.equal(r.m3, 1)
})

caso('sin medidas: no cambia el orden ni da NaN', () => {
  const rs = [res(1, 'Propia', 10), res(2, 'Alt', 30)]
  const vacia = fila(cot({ id: 2, bultos: [bulto('', '', ''), bulto(null, null, null)] }), rs)
  assert.ok(vacia.avisos.includes('Sin medidas'))
  const sinAlt = fila(cot({ id: 1 }), [res(1, 'Propia', 10)])
  const cara = fila(cot({ id: 3 }), [res(1, 'Propia', 10), res(2, 'Alt', 1000)])
  const o = ordenarFilas([vacia, cara, sinAlt])
  assert.deepEqual(o.map(x => x.id), [1, 3, 2])
  assert.ok(o.every(sinNaN))
})

caso('antigua con una medida a 0: los dos avisos', () => {
  const r = fila(cot({ soloPrimerBulto: true, bultos: [bulto(100, 0, 100)] }), [res(1, 'Propia', 10), res(2, 'Alt', 30)])
  assert.ok(r.avisos.includes('Solo medidas del 1er bulto'))
  assert.ok(r.avisos.includes('Sin medidas'))
  assert.ok(sinNaN(r))
})

caso('recalculoPropio con una sola zona', () => {
  const r = recalculoPropio([res(1, 'P', 10)], { agenciaId: 1, precioGuardado: 10, zonaId: null })
  assert.equal(r.resultado.precioFinal, 10)
  assert.equal(r.islaSinConfirmar, false)
})

// ---- proponerPaso ----
const paso = (filas, capacidadBultos) => proponerPaso({ filas, capacidadBultos })

caso('paso: 4 de 1 bulto y caben 3 -> la de menor sobrecoste', () => {
  const p = paso([f(1, 10), f(2, 3), f(3, 7), f(4, 5)], 3)
  assert.equal(p.sobran, 1)
  assert.equal(p.metodo, 'exacto')
  assert.deepEqual(p.opciones[0], { ids: [2], bultos: 1, sobrecoste: 3 })
  assert.deepEqual(p.opciones.map(o => o.ids), [[2], [4], [3]])
})

caso('paso: una de 2 bultos frente a dos de 1, sobran 2 -> la combinación más barata', () => {
  assert.deepEqual(paso([f(1, 9, 2), f(2, 4), f(3, 4), f(4, 50, 1)], 3).opciones[0].ids, [2, 3])
  assert.deepEqual(paso([f(1, 7, 2), f(2, 4), f(3, 4), f(4, 50, 1)], 3).opciones[0].ids, [1])
})

caso('paso: una no pasable nunca se propone', () => {
  const p = paso([f(1, null, 1), f(2, 30), f(3, 40)], 2)
  assert.ok(p.opciones.every(o => !o.ids.includes(1)))
  assert.deepEqual(p.opciones[0].ids, [2])
})

caso('paso: pasables insuficientes -> parcial y aviso', () => {
  const p = paso([f(1, null, 3, 'DSV'), f(2, 5, 1, 'DSV'), f(3, 8, 1, 'DSV')], 1)
  assert.equal(p.sobran, 4)
  assert.equal(p.metodo, 'parcial')
  assert.deepEqual(p.opciones, [{ ids: [2, 3], bultos: 2, sobrecoste: 13 }])
  assert.deepEqual(p.avisos, ['Faltan 2 bultos por mover que no se pueden pasar a DSV'])
  // singular
  assert.deepEqual(paso([f(1, null, 1, 'DSV'), f(2, 5, 1, 'DSV')], 0).avisos, ['Falta 1 bulto por mover que no se puede pasar a DSV'])
})

caso('paso: sobrecoste negativo se recomienda aunque quepa', () => {
  const p = paso([f(1, -2.5), f(2, 3), f(3, -0.01)], 10)
  assert.equal(p.sobran, 0)
  assert.deepEqual(p.opciones, [])
  assert.deepEqual(p.recomendadas, [1, 3])
})

caso('paso: desempate por menos bultos de más y luego menos cotizaciones', () => {
  // Mismo coste 10: [1] pasa 3 bultos (1 de más) y [2,3] pasa 2 (0 de más) -> gana [2,3]
  assert.deepEqual(paso([f(1, 10, 3), f(2, 5), f(3, 5), f(4, 99, 3)], 6).opciones[0].ids, [2, 3])
  // Mismo coste 10 y mismos bultos: [1] (una) gana a [2,3] (dos)
  assert.deepEqual(paso([f(1, 10, 2), f(2, 5), f(3, 5), f(4, 99, 2)], 4).opciones[0].ids, [1])
})

caso('paso: sin sobrante -> nada', () => {
  const p = paso([f(1, 5, 2), f(2, 3)], 3)
  assert.equal(p.sobran, 0)
  assert.deepEqual(p.opciones, [])
  assert.deepEqual(paso([f(1, 5)], NaN).opciones, [])
})

caso('paso: más de 20 pasables -> voraz y aviso', () => {
  const filas = Array.from({ length: 25 }, (_, i) => f(i + 1, 25 - i))
  const p = paso(filas, 22)
  assert.equal(p.metodo, 'voraz')
  assert.ok(p.avisos[0].includes('aproximada'))
  assert.deepEqual(p.opciones[0].ids, [25, 24, 23])
})

caso('paso: 20 pasables exacto en tiempo razonable', () => {
  const filas = Array.from({ length: 20 }, (_, i) => f(i + 1, (i * 37) % 23 + 1, (i % 3) + 1))
  const t = Date.now()
  const p = paso(filas, 20)
  assert.equal(p.metodo, 'exacto')
  assert.ok(p.opciones[0].bultos >= p.sobran)
  assert.ok(Date.now() - t < 3000)
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
const { obtenerOrdenCarga } = require('../src/main/services/ordenCargaService') // proponerPaso ya importada arriba
require('../src/main/ipcHandlers/ordenCargaHandler')
require('../src/main/ipcHandlers/agenciasDelDiaHandler')

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
const C = agencia('AgC', { soloDebidos: 1, precios: [[0, 1000, 1]] })
const cub = { largoCm: 100, anchoCm: 100, altoCm: 100 }
const ins = (agenciaId, fecha, extra = {}) => db.prepare(
  "INSERT INTO cotizaciones (fecha, largo_cm, ancho_cm, alto_cm, cp_prefix, agencia_id, precio_final, bultos_json, destinatario) VALUES (?, 100, 100, 100, '46', ?, ?, ?, ?)")
  .run(fecha, agenciaId, extra.precio ?? 20, extra.json ?? null, extra.dest ?? 'D').lastInsertRowid
const limpiar = () => db.prepare('DELETE FROM cotizaciones').run()
const pedir = (agenciaId = A.id, agenciaDestinoId = B.id) => obtenerOrdenCarga({ fecha: '2026-11-03', agenciaId, agenciaDestinoId })
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
  // AgC solo tiene zona de débidos: como destino no se puede pasar
  const c = pedir(A.id, C.id)[0]
  assert.equal(c.alternativa, null)
  assert.ok(c.avisos.includes('No se puede pasar a AgC'))
})

caso('destino inactivo: No se puede pasar', () => {
  limpiar(); ins(A.id, hoy)
  db.prepare('UPDATE agencias SET activa = 0 WHERE id = ?').run(B.id)
  try {
    const f = pedir()[0]
    assert.equal(f.alternativa, null)
    assert.ok(f.avisos.includes('No se puede pasar a AgB'))
  } finally { db.prepare('UPDATE agencias SET activa = 1 WHERE id = ?').run(B.id) }
})

caso('los dos sentidos: A->B y B->A, con propuesta', () => {
  limpiar()
  const a1 = ins(A.id, hoy, { precio: 20 }), a2 = ins(A.id, hoy, { precio: 20, json: JSON.stringify({ bultos: [cub, cub] }) })
  const b1 = ins(B.id, hoy, { precio: 30 })
  const ab = pedir(A.id, B.id)
  // a1: 30-20 = +10 (1 bulto); a2: 40-20 = +20 (2 bultos) -> a2 arriba, a1 al final
  assert.deepEqual(ab.map(f => [f.id, f.sobrecoste]), [[a2, 20], [a1, 10]])
  assert.deepEqual(proponerPaso({ filas: ab, capacidadBultos: 2 }).opciones[0], { ids: [a1], bultos: 1, sobrecoste: 10 })
  const ba = pedir(B.id, A.id)
  assert.equal(ba[0].alternativa.agencia, 'AgA')
  assert.equal(ba[0].sobrecoste, -10)
  assert.ok(ba[0].avisos.includes('Más barato con AgA'))
  assert.deepEqual(proponerPaso({ filas: ba, capacidadBultos: 5 }).recomendadas, [b1])
})

caso('antigua sin bultos_json: un bulto y aviso', () => {
  limpiar(); ins(A.id, hoy)
  const f = pedir()[0]
  assert.equal(f.numBultos, 1)
  assert.ok(f.avisos.includes('Solo medidas del 1er bulto'))
})

caso('BD: antigua con medida a 0 y JSON con alto vacío', () => {
  limpiar()
  db.prepare("INSERT INTO cotizaciones (fecha, largo_cm, ancho_cm, alto_cm, cp_prefix, agencia_id, precio_final) VALUES (?, 100, 0, 100, '46', ?, 20)").run(hoy, A.id)
  ins(A.id, hoy, { json: JSON.stringify({ bultos: [cub, { largoCm: 50, anchoCm: 50, altoCm: '' }] }) })
  const filas = pedir()
  assert.ok(filas.every(sinNaN))
  const antigua = filas.find(f => f.avisos.includes('Solo medidas del 1er bulto'))
  assert.ok(antigua.avisos.includes('Sin medidas'))
  const nueva = filas.find(f => f !== antigua)
  assert.ok(nueva.avisos.includes('Medidas incompletas (1 de 2 bultos)'))
  assert.equal(nueva.m3, 1)
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
  const filas = obtenerOrdenCarga({ fecha: '2026-11-03', agenciaId: L.id, agenciaDestinoId: B.id })
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
  for (const d of [undefined, 'x', A.id, 99999]) {
    assert.equal(handlers['get-orden-carga'](null, { fecha: '2026-11-03', agenciaId: A.id, agenciaDestinoId: d }).ok, false)
  }
  limpiar(); ins(A.id, hoy)
  const bien = handlers['get-orden-carga'](null, { fecha: '2026-11-03', agenciaId: A.id, agenciaDestinoId: B.id })
  assert.equal(bien.ok, true); assert.equal(bien.filas.length, 1)
  const p = handlers['proponer-paso'](null, { filas: bien.filas, capacidadBultos: 0 })
  assert.equal(p.ok, true); assert.deepEqual(p.propuesta.opciones[0].ids, [bien.filas[0].id])
  assert.equal(handlers['proponer-paso'](null, null).ok, false)
})

caso('agencias del día: solo las de esa fecha local, sin repetir y por nombre', () => {
  limpiar()
  ins(B.id, hoy); ins(A.id, hoy); ins(A.id, '2026-11-02 23:30:00') // 00:30 local del 03
  ins(B.id, '2026-11-02 12:00:00')
  const r = handlers['get-agencias-del-dia'](null, { fecha: '2026-11-03' })
  assert.equal(r.ok, true)
  assert.deepEqual(r.agencias, [{ id: A.id, nombre: 'AgA', activa: 1 }, { id: B.id, nombre: 'AgB', activa: 1 }])
  // Inactiva con cotizaciones ese día: sale, marcada como inactiva
  db.prepare('UPDATE agencias SET activa = 0 WHERE id = ?').run(B.id)
  try {
    assert.equal(handlers['get-agencias-del-dia'](null, { fecha: '2026-11-03' }).agencias[1].activa, 0)
  } finally { db.prepare('UPDATE agencias SET activa = 1 WHERE id = ?').run(B.id) }
  assert.deepEqual(handlers['get-agencias-del-dia'](null, { fecha: '2026-11-04' }).agencias, [])
  assert.equal(handlers['get-agencias-del-dia'](null, { fecha: 'x' }).ok, false)
  assert.equal(handlers['get-agencias-del-dia'](null, null).ok, false)
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizaciones').get().n, 4)
})

console.log(fallos ? `\n${fallos} fallos` : '\nTodo ok')
process.exit(fallos ? 1 : 0)
