/**
 * Motor de recargos por reglas (agencias con motor = 'reglas', hoy solo DSV).
 * Funciones PURAS: sin BD ni electron, para poder probarlas con node (scripts/test-dsv.js).
 * Replica la hoja Calculadora_NAC del Excel DSV System Nacional 2026.
 */

const r2 = n => Math.round(n * 100) / 100

/**
 * Banda de peso DSV (Calculadora_NAC!D43). Lanza error si supera 5.000 kg.
 */
function bandaDsv(pesoTasable) {
  if (pesoTasable <= 30) return 30
  if (pesoTasable <= 50) return 50
  if (pesoTasable <= 70) return 70
  if (pesoTasable <= 100) return 100
  const multiplo = pesoTasable <= 300 ? 50 : pesoTasable <= 1000 ? 100 : pesoTasable <= 3000 ? 250 : pesoTasable <= 5000 ? 500 : null
  if (!multiplo) throw new Error('Excede peso/volumen máximo DSV')
  return Math.ceil(pesoTasable / multiplo) * multiplo
}

/**
 * Clasifica el envío por largos según el bulto más desfavorable.
 * Lados ordenados de mayor a menor (la orientación del bulto no importa).
 * Tipo 1: lado mayor >240 y ≤300, 2º lado ≤120, 3º ≤220, ≤1500 kg/bulto.
 * Tipo 2: lado mayor >300 y ≤600, 2º lado ≤40, 3º ≤40, ≤30 kg/bulto.
 * Si no se conoce el peso del bulto (pesoKg) no se comprueba el límite de peso.
 * @returns {null|'tipo1'|'tipo2'|'excede'}
 */
function clasificarLargo(bultos) {
  const rango = { null: 0, tipo1: 1, tipo2: 2, excede: 3 }
  let peor = null
  for (const b of bultos) {
    const [mayor, segundo, tercero] = [b.largoCm, b.anchoCm, b.altoCm].map(Number).sort((x, y) => y - x)
    const peso = b.pesoKg
    let tipo = null
    if (mayor > 600) tipo = 'excede'
    else if (mayor > 300) tipo = (segundo <= 40 && tercero <= 40 && !(peso > 30)) ? 'tipo2' : 'excede'
    else if (mayor > 240) tipo = (segundo <= 120 && tercero <= 220 && !(peso > 1500)) ? 'tipo1' : 'excede'
    if (rango[tipo] > rango[peor]) peor = tipo
  }
  return peor
}

/** Importe de un recargo sobre una base, con mínimo. */
function importeRecargo(recargo, { base, peso, numBultos }) {
  let v
  if (recargo.tipo === 'porcentaje') v = r2(base * recargo.valor / 100)
  else if (recargo.tipo === 'por_100kg') v = r2(peso / 100 * recargo.valor)
  else if (recargo.tipo === 'por_bulto') v = r2(numBultos * recargo.valor)
  else v = recargo.valor
  if (recargo.minimo_aplicable != null && v < recargo.minimo_aplicable) v = recargo.minimo_aplicable
  return r2(v)
}

/**
 * Calcula flete + opciones + suplementos DSV.
 * @param {object} p
 * @param {number} p.flete         precio de tarifa (banda × zona), sin incremento Priority
 * @param {number} p.pesoTasable   kg tasables, sin redondear
 * @param {object} p.zona          fila de zonas_agencia (usa nombre_zona)
 * @param {Array}  p.bultos        [{ largoCm, anchoCm, altoCm, pesoKg? }]
 * @param {object} [p.opciones]    { [codigo]: boolean }; si falta un código se usa su por_defecto
 * @param {string} [p.cp5]         CP de 5 dígitos (opcional)
 * @param {Array}  p.recargos      filas de recargos_agencia
 * @param {Array}  [p.cpAreas]     tipos de área del cp5: ['remota'] / ['metropolitana'] / []
 * @param {string} [p.producto]    'system' (defecto) | 'priority'
 * @returns {{ flete, opciones, suplementos, total, desglose: Array, avisos: string[], error: string|null }}
 */
function calcularDsv({ flete: fleteTarifa, pesoTasable, zona, bultos, opciones = {}, cp5, recargos, cpAreas = [], producto = 'system' }) {
  const avisos = []
  const esPriority = producto === 'priority'
  const flete = fleteTarifa * (esPriority ? 1.3 : 1)  // el Excel no redondea el flete
  const largo = clasificarLargo(bultos)
  if (largo === 'excede') {
    return { flete, opciones: 0, suplementos: 0, total: null, desglose: [], avisos, error: 'Bulto fuera de medidas DSV (consultar)' }
  }

  const activos = recargos.filter(r => r.activo)
  const elegido = r => opciones[r.codigo] ?? !!r.por_defecto
  const marcados = new Set(activos.filter(r => r.aplica === 'opcional' && elegido(r)).map(r => r.codigo))
  const hayDiaFijo = ['dia_fijo', 'dia_fijo_13', 'dia_fijo_10'].some(c => marcados.has(c))

  // Incompatibilidades: se avisa y la opción no se aplica
  const quitar = (codigos, aviso) => {
    if (codigos.some(c => marcados.has(c))) { codigos.forEach(c => marcados.delete(c)); avisos.push(aviso) }
  }
  if (!esPriority) quitar(['priority_12', 'priority_10'], 'Priority 10/12 solo con System Priority: no aplicado')
  if (largo) quitar(['dia_fijo', 'dia_fijo_13', 'dia_fijo_10'], 'Día fijo no compatible con Largos: no aplicado')
  if (esPriority || hayDiaFijo) quitar(['adr'], 'ADR no compatible con Priority ni Día fijo: no aplicado')

  const areas = new Set(cpAreas)
  if (!cp5) avisos.push('Área remota/metropolitana sin verificar (CP incompleto)')

  const aplica = r => {
    if (r.aplica === 'siempre') return true
    if (r.aplica === 'opcional') return marcados.has(r.codigo)
    if (r.aplica === 'cp_remota') return areas.has('remota')
    if (r.aplica === 'cp_metropolitana') return areas.has('metropolitana')
    if (r.aplica === 'largo_tipo1' || r.aplica === 'largo_tipo2') return r.aplica === `largo_${largo}`
    if (r.aplica?.startsWith('zonas:')) return r.aplica.slice(6).split(',').map(s => s.trim()).includes(zona?.nombre_zona)
    return false  // 'manual' y desconocidos
  }

  const ctx = { base: flete, peso: pesoTasable, numBultos: bultos.length }
  const lineas = []
  const aplicables = activos.filter(aplica)
  // Primero todo lo que no depende de otros recargos; el fuel va sobre flete + Priority 10/12
  for (const r of aplicables.filter(r => r.base !== 'flete_mas_priority')) {
    lineas.push({ r, valor: importeRecargo(r, ctx) })
  }
  const priority = lineas.filter(l => l.r.codigo === 'priority_10' || l.r.codigo === 'priority_12').reduce((s, l) => s + l.valor, 0)
  for (const r of aplicables.filter(r => r.base === 'flete_mas_priority')) {
    lineas.push({ r, valor: importeRecargo(r, { ...ctx, base: flete + priority }) })
  }
  lineas.sort((a, b) => (a.r.orden ?? 0) - (b.r.orden ?? 0))

  const grupo = r => r.aplica === 'opcional' ? 'opciones' : 'suplementos'
  const suma = g => r2(lineas.filter(l => grupo(l.r) === g).reduce((s, l) => s + l.valor, 0))
  const totalOpciones = suma('opciones')
  const totalSuplementos = suma('suplementos')

  const desglose = [
    { nombre: esPriority ? 'Flete System Priority (+30%)' : 'Flete System', valor: r2(flete), grupo: 'flete' },
    ...lineas.map(l => ({ nombre: l.r.nombre, valor: l.valor, grupo: grupo(l.r), codigo: l.r.codigo })),
  ]

  return {
    flete,
    opciones: totalOpciones,
    suplementos: totalSuplementos,
    total: r2(flete + totalOpciones + totalSuplementos),
    desglose,
    avisos,
    error: null,
  }
}

module.exports = { bandaDsv, clasificarLargo, calcularDsv, importeRecargo }
