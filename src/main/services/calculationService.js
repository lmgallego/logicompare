const { getActive } = require('../repositories/agencyRepository')
const { getZoneForCp, getZonesForCp } = require('../repositories/zoneRepository')
const { getRateForWeight, getRateForWeight15 } = require('../repositories/rateRepository')
const { getDb } = require('../database/connection')

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
  // Try direct rate lookup first
  const tarifa = getRateForWeight(agenciaId, zona.id, peso)
  if (tarifa) return { precioBase: tarifa.precio_base, error: null }

  // Peso exceeds all defined tariff bands → get the highest band's tariff
  const tarifaMax = getDb()
    .prepare('SELECT * FROM tarifas_agencia WHERE agencia_id=? AND zona_id=? ORDER BY kilos_hasta DESC LIMIT 1')
    .get(agenciaId, zona.id)
  if (!tarifaMax) return { precioBase: null, error: 'Sin tarifa para este peso' }

  const kgsExtra = Math.ceil(peso - tarifaMax.kilos_hasta)

  // Check for banded kg_adicional table (Transhaer-style)
  const bandas = getDb()
    .prepare('SELECT * FROM tarifas_kg_adicional WHERE zona_id=? ORDER BY kg_desde')
    .all(zona.id)

  if (bandas.length > 0) {
    // Price = tarifa_max + sum of each band's contribution
    let precioExtra = 0
    let pesoRestante = kgsExtra
    let pesoActual = tarifaMax.kilos_hasta

    for (const banda of bandas) {
      if (pesoRestante <= 0) break
      const bandaHasta = banda.kg_hasta !== null ? banda.kg_hasta : Infinity
      const bandaTamanio = bandaHasta - banda.kg_desde
      const kgsEnBanda = Math.min(pesoRestante, bandaTamanio)
      precioExtra += kgsEnBanda * banda.precio_kg
      pesoRestante -= kgsEnBanda
    }

    // If still weight remaining beyond last band, use last band's rate
    if (pesoRestante > 0) {
      const ultimaBanda = bandas[bandas.length - 1]
      precioExtra += pesoRestante * ultimaBanda.precio_kg
    }

    const precioBase = tarifaMax.precio_base + precioExtra
    return { precioBase: Math.round(precioBase * 100) / 100, error: null }
  }

  // Fallback: use zona.kg_adicional (simple single rate)
  const precioBase = tarifaMax.precio_base + kgsExtra * zona.kg_adicional
  return { precioBase: Math.round(precioBase * 100) / 100, error: null }
}

/**
 * Aplica recargo combustible y seguro desde los campos de la agencia.
 * Seguro tiene mínimo de 0,90 €.
 */
function aplicarRecargos(precioBase, agencia) {
  const desglose = [{ nombre: 'Tarifa base', valor: precioBase }]

  const combustible = Math.round(precioBase * (agencia.recargo_combustible / 100) * 100) / 100
  if (combustible > 0) desglose.push({ nombre: `Recargo combustible (${agencia.recargo_combustible}%)`, valor: combustible })

  let seguro = Math.round(precioBase * (agencia.recargo_seguro / 100) * 100) / 100
  if (agencia.recargo_seguro > 0 && seguro < 0.90) seguro = 0.90
  if (seguro > 0) desglose.push({ nombre: `Recargo seguro (${agencia.recargo_seguro}%, mín. 0,90€)`, valor: seguro })

  const precioFinal = Math.round((precioBase + combustible + seguro) * 100) / 100
  return { precioFinal, desglose }
}

/**
 * Realiza el cálculo completo de cotización para todas las agencias activas.
 * @param {{ largoCm, anchoCm, altoCm, cpPrefix }} params
 * @returns {Array}
 */
// CPs de Cataluña (para lógica horaria de Logística)
const CP_CATALUNYA = new Set(['08', '17', '25', '43'])

/**
 * Para la agencia Logística, los CPs catalanes tienen dos zonas horarias:
 * - Matí-Tarda  → antes de las 11:00
 * - Tarda-Matí  → entre 11:00 y 19:00
 * La zona registrada en zonas_provincias para Cataluña es siempre 'Matí-Tarda'.
 * Aquí la intercambiamos según la hora del sistema.
 */
function resolveZonaLogistica(agenciaId, zonaBase) {
  if (!zonaBase) return zonaBase
  const hora = new Date().getHours()
  const esMatutino = hora < 11  // <11h → Matí-Tarda
  const esTarde    = hora >= 11 && hora < 19 // 11-19h → Tarda-Matí

  if (zonaBase.nombre_zona === 'Matí-Tarda' && !esMatutino && esTarde) {
    // Cambiar a Tarda-Matí
    const db = require('../database/connection').getDb()
    const zona = db.prepare(
      "SELECT * FROM zonas_agencia WHERE agencia_id=? AND nombre_zona='Tarda-Matí'"
    ).get(agenciaId)
    return zona || zonaBase
  }
  return zonaBase
}

function calcularTarifas({ largoCm, anchoCm, altoCm, cpPrefix }) {
  const metrosCubicos = calcularMetrosCubicos(largoCm, anchoCm, altoCm)
  const agencias = getActive()
  const resultados = []

  for (const agencia of agencias) {
    const peso = calcularPeso(metrosCubicos, agencia.baremo)

    let zona = getZoneForCp(agencia.id, cpPrefix)

    // Lógica horaria Logística para Cataluña
    if (zona && CP_CATALUNYA.has(cpPrefix) && agencia.nombre === 'Logística') {
      zona = resolveZonaLogistica(agencia.id, zona)
    }

    // Excluir zonas solo_debidos de Pagados/Cargar Portes
    if (zona && zona.solo_debidos) {
      continue
    }

    // Handle multiple_zones (e.g. Transhaer Baleares sub-islands on CP 07)
    const multiZonas = getZonesForCp(agencia.id, cpPrefix)
    if (multiZonas.length > 0) {
      for (const mZona of multiZonas) {
        const { precioBase, error } = calcularTarifaBase(agencia.id, mZona, peso)
        if (error) {
          resultados.push({ agencia, zona: mZona, metrosCubicos, peso, precioBase: null, precioFinal: null, desglose: [], error })
          continue
        }
        const { precioFinal, desglose } = aplicarRecargos(precioBase, agencia)
        resultados.push({ agencia, zona: mZona, metrosCubicos, peso, precioBase, precioFinal, desglose, error: null })
      }
      continue
    }

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

/**
 * Calcula únicamente el peso por baremo de cada agencia activa.
 * No requiere CP ni zona. Usado en pantalla Debidos.
 * @param {{ largoCm, anchoCm, altoCm }} params
 * @returns {Array<{ agencia, metrosCubicos, peso }>}
 */
function calcularPesosDebidos({ largoCm, anchoCm, altoCm }) {
  const metrosCubicos = calcularMetrosCubicos(largoCm, anchoCm, altoCm)
  const agencias = getActive()
  return agencias.map(agencia => ({
    agencia,
    metrosCubicos,
    peso: calcularPeso(metrosCubicos, agencia.baremo),
    error: null,
    zona: null,
    precioFinal: null,
  }))
}

module.exports = { calcularTarifas, calcularMetrosCubicos, calcularPeso, calcularPesosDebidos }
