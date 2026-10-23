/**
 * Pruebas del motor DSV (recargosService, funciones puras). Sin BD.
 * Uso: node scripts/test-dsv.js
 * Recargos con los valores por defecto de csv/dsv_system_2026.json (como los siembra seedDsv).
 */
const assert = require('node:assert/strict')
const { bandaDsv, clasificarLargo, calcularDsv } = require('../src/main/services/recargosService')
const datos = require('../csv/dsv_system_2026.json')

const nombrePorPosicion = Object.fromEntries(datos.zonas.map(z => [String(z.posicion), z.nombre]))
const RECARGOS = datos.recargos.map((r, i) => ({
  ...r,
  minimo_aplicable: r.minimo,
  aplica: r.aplica.startsWith('zonas:')
    ? 'zonas:' + r.aplica.slice(6).split(',').map(p => nombrePorPosicion[p]).join(',')
    : r.aplica,
  activo: r.aplica === 'manual' ? 0 : r.activo,
  por_defecto: r.codigo === 'incremento_responsabilidad' ? 1 : 0,
  orden: i,
}))

const tarifa = (zona, kg) => datos.tarifa_salidas[zona][datos.tramos_kg_hasta.indexOf(bandaDsv(kg))]
const zona = n => ({ nombre_zona: nombrePorPosicion[n] })
const pesoTasable = (bultos, bruto) => Math.max(bultos.reduce((s, b) => s + b.largoCm * b.anchoCm * b.altoCm * 1e-6, 0) * 220, bruto)

function caso(nombre, fn) {
  try { fn(); console.log('  ok  ', nombre) } catch (e) { console.log('  FALLO', nombre, '\n', e.message); process.exitCode = 1 }
}

console.log('Bandas')
caso('bandaDsv', () => {
  for (const [kg, banda] of [[29.9, 30], [30.1, 50], [100.1, 150], [300.1, 400], [1000.5, 1250], [3000.1, 3500], [5000, 5000]]) {
    assert.equal(bandaDsv(kg), banda, `${kg} kg`)
  }
  assert.throws(() => bandaDsv(5000.1), /Excede peso\/volumen máximo DSV/)
})

console.log('Casos de la especificación')
caso('V1 zona 7, 215×35×54, 100 kg, System, responsabilidad Sí, sin CP5 → 41,04 (Excel)', () => {
  const bultos = [{ largoCm: 215, anchoCm: 35, altoCm: 54, pesoKg: 100 }]
  const peso = pesoTasable(bultos, 100)
  const r = calcularDsv({ flete: tarifa('7', peso), pesoTasable: peso, zona: zona('7'), bultos, recargos: RECARGOS,
    opciones: { incremento_responsabilidad: true } })
  assert.equal(r.flete, 33.57)
  assert.equal(r.opciones, 2.69)
  assert.equal(r.suplementos, 4.78)
  assert.equal(r.total, 41.04)
  assert.ok(r.avisos.includes('Área remota/metropolitana sin verificar (CP incompleto)'))
})

caso('V2 V1 con System Priority y sin responsabilidad → 49,70', () => {
  const bultos = [{ largoCm: 215, anchoCm: 35, altoCm: 54, pesoKg: 100 }]
  const peso = pesoTasable(bultos, 100)
  const r = calcularDsv({ flete: tarifa('7', peso), pesoTasable: peso, zona: zona('7'), bultos, recargos: RECARGOS,
    opciones: { incremento_responsabilidad: false }, producto: 'priority' })
  assert.ok(Math.abs(r.flete - 43.641) < 1e-9, `flete ${r.flete}`)
  assert.equal(r.opciones, 0)
  assert.equal(r.suplementos, 6.06)
  assert.equal(r.total, 49.70)
})

caso('V4 zona 4, 120×80×100, 180 kg, CP5 08001 metropolitana, sin responsabilidad → 71,03', () => {
  const bultos = [{ largoCm: 120, anchoCm: 80, altoCm: 100, pesoKg: 180 }]
  const peso = pesoTasable(bultos, 180)
  const r = calcularDsv({ flete: tarifa('4', peso), pesoTasable: peso, zona: zona('4'), bultos, recargos: RECARGOS,
    opciones: { incremento_responsabilidad: false }, cp5: '08001', cpAreas: ['metropolitana'] })
  assert.equal(r.flete, 51.20)
  assert.equal(r.suplementos, 19.83)
  assert.equal(r.total, 71.03)
  assert.equal(r.avisos.length, 0)
})

console.log('Largos')
caso('250 cm → tipo1, mínimo 40 €', () => {
  const bultos = [{ largoCm: 250, anchoCm: 40, altoCm: 40 }]
  assert.equal(clasificarLargo(bultos), 'tipo1')
  const r = calcularDsv({ flete: 20, pesoTasable: 88, zona: zona('1'), bultos, recargos: RECARGOS })
  assert.equal(r.desglose.find(l => l.codigo === 'largo_tipo1').valor, 40)
})
caso('350×30×30, 20 kg → tipo2, mínimo 75 €', () => {
  const bultos = [{ largoCm: 350, anchoCm: 30, altoCm: 30, pesoKg: 20 }]
  assert.equal(clasificarLargo(bultos), 'tipo2')
  const r = calcularDsv({ flete: 20, pesoTasable: 69.3, zona: zona('1'), bultos, recargos: RECARGOS })
  assert.equal(r.desglose.find(l => l.codigo === 'largo_tipo2').valor, 75)
})
caso('350×30×30 con 40 kg → excede (error)', () => {
  const bultos = [{ largoCm: 350, anchoCm: 30, altoCm: 30, pesoKg: 40 }]
  assert.equal(clasificarLargo(bultos), 'excede')
  assert.ok(calcularDsv({ flete: 20, pesoTasable: 69.3, zona: zona('1'), bultos, recargos: RECARGOS }).error)
})

console.log('Reglas')
caso('Día fijo no se aplica con Largos; ADR no con Priority', () => {
  const bultos = [{ largoCm: 250, anchoCm: 40, altoCm: 40 }]
  const r = calcularDsv({ flete: 20, pesoTasable: 88, zona: zona('1'), bultos, recargos: RECARGOS,
    opciones: { dia_fijo: true, adr: true, priority_12: true }, producto: 'priority' })
  const codigos = r.desglose.map(l => l.codigo)
  assert.ok(!codigos.includes('dia_fijo') && !codigos.includes('adr'))
  assert.ok(codigos.includes('priority_12'))
  assert.equal(r.avisos.length, 3)  // día fijo, ADR, CP incompleto
})
caso('Fuel sobre flete + Priority 12', () => {
  const bultos = [{ largoCm: 50, anchoCm: 50, altoCm: 50 }]
  const r = calcularDsv({ flete: 100, pesoTasable: 27.5, zona: zona('1'), bultos, recargos: RECARGOS,
    opciones: { incremento_responsabilidad: false, priority_12: true }, producto: 'priority' })
  // flete 130 + priority 10 → fuel 12,75 % de 140 = 17,85
  assert.equal(r.desglose.find(l => l.codigo === 'combustible').valor, 17.85)
})
caso('MFR Baleares solo en zonas de islas, mínimo 0,60 €', () => {
  const bultos = [{ largoCm: 50, anchoCm: 50, altoCm: 50 }]
  const isla = calcularDsv({ flete: 40, pesoTasable: 27.5, zona: { nombre_zona: 'Ibiza' }, bultos, recargos: RECARGOS })
  assert.equal(isla.desglose.find(l => l.codigo === 'mfr_baleares').valor, 0.6)
  const peninsula = calcularDsv({ flete: 40, pesoTasable: 27.5, zona: zona('3'), bultos, recargos: RECARGOS })
  assert.ok(!peninsula.desglose.some(l => l.codigo === 'mfr_baleares'))
})

if (!process.exitCode) console.log('\nTodo OK')
