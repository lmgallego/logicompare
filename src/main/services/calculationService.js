const { getActive } = require('../repositories/agencyRepository')
const { getZoneForCp, getZonesForCp } = require('../repositories/zoneRepository')
const { getRateForWeight, getRateForWeight15 } = require('../repositories/rateRepository')
const { getDb } = require('../database/connection')
const { getActiveRulesByAgency, getCpAreas } = require('../repositories/surchargeRepository')
const { bandaDsv, calcularDsv } = require('./recargosService')

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
function aplicarPrecioTarifa(tarifa, peso) {
  if (tarifa.es_por_tonelada) {
    return Math.round(tarifa.precio_base * (peso / 1000) * 100) / 100
  }
  return tarifa.precio_base
}

function calcularTarifaBase(agenciaId, zona, peso) {
  // Try direct rate lookup first
  const tarifa = getRateForWeight(agenciaId, zona.id, peso)
  if (tarifa) return { precioBase: aplicarPrecioTarifa(tarifa, peso), error: null }

  // No exact match — find first available band with kilos_hasta >= peso (skip gaps)
  const tarifaSuperior = getDb()
    .prepare('SELECT * FROM tarifas_agencia WHERE agencia_id=? AND zona_id=? AND kilos_hasta >= ? ORDER BY kilos_hasta ASC LIMIT 1')
    .get(agenciaId, zona.id, peso)
  if (tarifaSuperior) return { precioBase: aplicarPrecioTarifa(tarifaSuperior, peso), error: null }

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
    let precioExtra = 0
    let pesoRestante = kgsExtra

    for (const banda of bandas) {
      if (pesoRestante <= 0) break
      const bandaHasta = banda.kg_hasta !== null ? banda.kg_hasta : Infinity
      const bandaTamanio = bandaHasta - banda.kg_desde
      const kgsEnBanda = Math.min(pesoRestante, bandaTamanio)
      precioExtra += kgsEnBanda * banda.precio_kg
      pesoRestante -= kgsEnBanda
    }

    if (pesoRestante > 0) {
      const ultimaBanda = bandas[bandas.length - 1]
      precioExtra += pesoRestante * ultimaBanda.precio_kg
    }

    const precioBase = aplicarPrecioTarifa(tarifaMax, peso) + precioExtra
    return { precioBase: Math.round(precioBase * 100) / 100, error: null }
  }

  // Fallback: use zona.kg_adicional (simple single rate)
  const precioBase = aplicarPrecioTarifa(tarifaMax, peso) + kgsExtra * zona.kg_adicional
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

/**
 * Calcula el precio para UNA agencia/zona dado un array de bultos.
 * Suma todos los m³ → obtiene UN peso total → busca UN precio para ese peso.
 * @returns {{ precioFinal: number|null, precioBase: number|null, desglose: [], peso: number, metrosCubicos: number, error: string|null }}
 */
function calcularPrecioBultos(agencia, zona, bultos, extra = {}) {
  if (agencia.motor === 'reglas') return calcularPrecioReglas(agencia, zona, bultos, extra)

  let m3Total = 0
  for (const bulto of bultos) {
    m3Total += calcularMetrosCubicos(bulto.largoCm, bulto.anchoCm, bulto.altoCm)
  }
  m3Total = Math.round(m3Total * 1000) / 1000

  const pesoTotal = calcularPeso(m3Total, agencia.baremo)

  const { precioBase, error } = calcularTarifaBase(agencia.id, zona, pesoTotal)
  if (error) return { precioFinal: null, precioBase: null, desglose: [], peso: pesoTotal, metrosCubicos: m3Total, error }

  const { precioFinal, desglose } = aplicarRecargos(precioBase, agencia)
  return { precioFinal, precioBase, desglose, peso: pesoTotal, metrosCubicos: m3Total, error: null }
}

/**
 * Flujo para agencias con motor = 'reglas' (DSV). No usa redondeos intermedios ni
 * banda máxima + kg_adicional: fuera de límites devuelve error.
 */
const DSV_PESO_MAX_KG = 5000
const DSV_VOLUMEN_MAX_M3 = 20

function calcularPrecioReglas(agencia, zona, bultos, { cp5, pesoBruto, opcionesDsv, producto } = {}) {
  const m3 = bultos.reduce((s, b) => s + b.largoCm * b.anchoCm * b.altoCm * 0.000001, 0)
  const peso = Math.max(m3 * agencia.baremo, Number(pesoBruto) || 0)
  const base = { precioFinal: null, precioBase: null, desglose: [], avisos: [],
    peso: Math.round(peso * 100) / 100, metrosCubicos: Math.round(m3 * 1000) / 1000 }

  if (peso > DSV_PESO_MAX_KG || m3 > DSV_VOLUMEN_MAX_M3) return { ...base, error: 'Excede peso/volumen máximo DSV' }

  const tarifa = getRateForWeight(agencia.id, zona.id, bandaDsv(peso))
  if (!tarifa) return { ...base, error: 'Sin tarifa para este peso' }

  // Peso por bulto para la regla de Largos: solo se conoce si hay peso bruto
  const pesoBulto = pesoBruto ? Number(pesoBruto) / bultos.length : undefined
  const r = calcularDsv({
    flete: tarifa.precio_base,
    pesoTasable: peso,
    zona,
    bultos: bultos.map(b => ({ ...b, pesoKg: pesoBulto })),
    opciones: opcionesDsv || {},
    cp5,
    recargos: getActiveRulesByAgency(agencia.id),
    cpAreas: cp5 ? getCpAreas(agencia.id, cp5) : [],
    producto,
  })
  if (r.error) return { ...base, avisos: r.avisos, error: r.error }
  return { ...base, precioFinal: r.total, precioBase: Math.round(r.flete * 100) / 100, desglose: r.desglose, avisos: r.avisos, error: null }
}

function calcularTarifas({ largoCm, anchoCm, altoCm, cpPrefix, agenciaIds, bultos, cp5, pesoBruto, opcionesDsv, producto }) {
  // Parámetros solo para agencias con motor 'reglas'; el resto los ignora
  const extra = { cp5, pesoBruto, opcionesDsv, producto }
  // Normalizar bultos: si no viene array, usar las dimensiones simples
  const listaBultos = (bultos && bultos.length > 0)
    ? bultos
    : [{ largoCm, anchoCm, altoCm }]

  // Para compatibilidad con lógica de oversize (GLS largo > 110), exponer el max largo
  const maxLargoCm = Math.max(...listaBultos.map(b => b.largoCm || 0))
  // Para la norma Seur (largo+ancho+alto ≤ 300), exponer la suma máxima de dimensiones
  const maxSumaDimCm = Math.max(...listaBultos.map(b => (b.largoCm || 0) + (b.anchoCm || 0) + (b.altoCm || 0)))

  let agencias = getActive()
  if (agenciaIds && agenciaIds.length > 0) {
    const idSet = new Set(agenciaIds)
    agencias = agencias.filter(a => idSet.has(a.id))
  }
  const resultados = []

  for (const agencia of agencias) {
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
        const res = calcularPrecioBultos(agencia, mZona, listaBultos, extra)
        resultados.push({ agencia, zona: mZona, ...res, numeroBultos: listaBultos.length, maxLargoCm, maxSumaDimCm })
      }
      continue
    }

    if (!zona) {
      resultados.push({
        agencia, zona: null,
        metrosCubicos: 0, peso: 0,
        precioBase: null, precioFinal: null, desglose: [],
        error: 'Sin cobertura para este CP',
        numeroBultos: listaBultos.length, maxLargoCm, maxSumaDimCm,
      })
      continue
    }

    const res = calcularPrecioBultos(agencia, zona, listaBultos, extra)
    resultados.push({ agencia, zona, ...res, numeroBultos: listaBultos.length, maxLargoCm, maxSumaDimCm })
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
function calcularPesosDebidos({ largoCm, anchoCm, altoCm, agenciaIds, bultos }) {
  const listaBultos = (bultos && bultos.length > 0)
    ? bultos
    : [{ largoCm, anchoCm, altoCm }]

  let agencias = getActive()
  if (agenciaIds && agenciaIds.length > 0) {
    const idSet = new Set(agenciaIds)
    agencias = agencias.filter(a => idSet.has(a.id))
  }
  return agencias.map(agencia => {
    let m3Total = 0
    for (const bulto of listaBultos) {
      m3Total += calcularMetrosCubicos(bulto.largoCm, bulto.anchoCm, bulto.altoCm)
    }
    m3Total = Math.round(m3Total * 1000) / 1000
    return {
      agencia,
      metrosCubicos: m3Total,
      peso: calcularPeso(m3Total, agencia.baremo),
      numeroBultos: listaBultos.length,
      error: null,
      zona: null,
      precioFinal: null,
    }
  })
}

module.exports = { calcularTarifas, calcularMetrosCubicos, calcularPeso, calcularPesosDebidos }
