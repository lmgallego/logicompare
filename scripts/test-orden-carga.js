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

caso('recalculoPropio con una sola zona', () => {
  const r = recalculoPropio([res(1, 'P', 10)], { agenciaId: 1, precioGuardado: 10, zonaId: null })
  assert.equal(r.resultado.precioFinal, 10)
  assert.equal(r.islaSinConfirmar, false)
})

console.log(fallos ? `\n${fallos} fallos` : '\nTodo ok')
process.exit(fallos ? 1 : 0)
