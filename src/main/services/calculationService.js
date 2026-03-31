const { getActive } = require('../repositories/agencyRepository')
const { getZoneForCp } = require('../repositories/zoneRepository')
const { getRateForWeight, getRateForWeight15 } = require('../repositories/rateRepository')

/**
 * Calcula los metros cúbicos a partir de las dimensiones en cm.
 * @returns {number} m³ con 3 decimales
 */
function calcularMetrosCubicos(largoCm, anchoCm, altoCm) {
  return Math.round(largoCm * anchoCm * altoCm * 0.000001 * 1000) / 1000
}

/**
 * Calcula el peso tasable a partir de m³ y baremo de la agencia.
 * Redondeo al alza (Math.ceil), sin decimales, mínimo 1 kg.
 * @returns {number} peso en kg (entero)
 */
function calcularPeso(metrosCubicos, baremo) {
  return Math.max(1, Math.ceil(metrosCubicos * baremo))
}

/**
 * Calcula la tarifa base para un peso dado en una zona.
 * Si peso ≤ 15: busca en tarifas_agencia.
 * Si peso > 15: tarifa_15kg + ceil(peso - 15) × zona.kg_adicional
 * @returns {{ precioBase: number|null, error: string|null }}
 */
function calcularTarifaBase(agenciaId, zona, peso) {
  if (peso <= 15) {
    const tarifa = getRateForWeight(agenciaId, zona.id, peso)
    if (!tarifa) return { precioBase: null, error: 'Sin tarifa para este peso' }
    return { precioBase: tarifa.precio_base, error: null }
  }

  // Peso > 15 kg: base del tramo 15 kg + exceso × kg_adicional
  const tarifa15 = getRateForWeight15(agenciaId, zona.id)
  if (!tarifa15) return { precioBase: null, error: 'Sin tarifa base para >15 kg' }

  const kgsExtra = Math.ceil(peso - 15)
  const precioBase = tarifa15.precio_base + kgsExtra * zona.kg_adicional
  return { precioBase: Math.round(precioBase * 100) / 100, error: null }
}

/**
 * Aplica recargo combustible y seguro desde los campos de la agencia.
 * Seguro tiene mínimo de 0,90 €.
 */
function aplicarRecargos(precioBase, agencia) {
  const desglose = [{ nombre: 'Tarifa base', valor: precioBase }]

  const combustible = Math.round(precioBase * (agencia.recargo_combustible / 100) * 100) / 100
  desglose.push({ nombre: `Recargo combustible (${agencia.recargo_combustible}%)`, valor: combustible })

  let seguro = Math.round(precioBase * (agencia.recargo_seguro / 100) * 100) / 100
  if (seguro < 0.90) seguro = 0.90
  desglose.push({ nombre: `Recargo seguro (${agencia.recargo_seguro}%, mín. 0,90€)`, valor: seguro })

  const precioFinal = Math.round((precioBase + combustible + seguro) * 100) / 100
  return { precioFinal, desglose }
}

/**
 * Realiza el cálculo completo de cotización para todas las agencias activas.
 * @param {{ largoCm, anchoCm, altoCm, cpPrefix }} params
 * @returns {Array}
 */
function calcularTarifas({ largoCm, anchoCm, altoCm, cpPrefix }) {
  const metrosCubicos = calcularMetrosCubicos(largoCm, anchoCm, altoCm)
  const agencias = getActive()
  const resultados = []

  for (const agencia of agencias) {
    const peso = calcularPeso(metrosCubicos, agencia.baremo)

    const zona = getZoneForCp(agencia.id, cpPrefix)
    if (!zona) {
      resultados.push({
        agencia, zona: null, metrosCubicos, peso,
        precioBase: null, precioFinal: null, desglose: [],
        error: 'Sin cobertura para este CP',
      })
      continue
    }

    const { precioBase, error } = calcularTarifaBase(agencia.id, zona, peso)
    if (error) {
      resultados.push({
        agencia, zona, metrosCubicos, peso,
        precioBase: null, precioFinal: null, desglose: [],
        error,
      })
      continue
    }

    const { precioFinal, desglose } = aplicarRecargos(precioBase, agencia)

    resultados.push({
      agencia, zona, metrosCubicos, peso,
      precioBase, precioFinal, desglose,
      error: null,
    })
  }

  resultados.sort((a, b) => {
    if (a.precioFinal === null) return 1
    if (b.precioFinal === null) return -1
    return a.precioFinal - b.precioFinal
  })

  return resultados
}

module.exports = { calcularTarifas, calcularMetrosCubicos, calcularPeso }
