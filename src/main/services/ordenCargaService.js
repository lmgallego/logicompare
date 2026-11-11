// Orden de carga: dadas las cotizaciones de una agencia en un día, ordena de "más caro de mover
// a otra agencia" a "más barato". Las funciones puras no tocan la BD; obtenerOrdenCarga sí.
const { motivoFueraDeNorma } = require('./elegibilidad')
const EPS = 0.005
const r2 = n => Math.round(n * 100) / 100

function islaDeZona(nombreZona) {
  const n = (nombreZona || '').toLowerCase()
  if (n.includes('mallorca') || n.includes('palma')) return 'Mallorca'
  if (n.includes('menorca')) return 'Menorca'
  if (n.includes('ibiza') || n.includes('eivissa')) return 'Ibiza'
  if (n.includes('formentera')) return 'Formentera'
  return null
}

function motivoNoElegible(r) {
  if (r.precioFinal == null) return r.error || 'Sin precio'
  return motivoFueraDeNorma({ nombreAgencia: r.agencia?.nombre, maxLargoCm: r.maxLargoCm, maxSumaDimCm: r.maxSumaDimCm })
}

/** Resultado de la propia agencia: por zona guardada o deduciendo la isla por el precio guardado. */
function recalculoPropio(resultados, { agenciaId, precioGuardado, zonaId }) {
  const propios = resultados.filter(r => r.agencia.id === agenciaId && r.agencia.activa && r.precioFinal != null)
  if (!propios.length) return { resultado: null, isla: null, islaSinConfirmar: false }
  const conIsla = r => ({ resultado: r, isla: islaDeZona(r.zona.nombre_zona), islaSinConfirmar: false })
  const porZona = zonaId != null && propios.find(r => r.zona.id === zonaId)
  if (porZona) return conIsla(porZona)
  if (propios.length === 1) return conIsla(propios[0])
  const iguales = propios.filter(r => Math.abs(r.precioFinal - precioGuardado) <= EPS)
  if (iguales.length === 1 && islaDeZona(iguales[0].zona.nombre_zona)) return conIsla(iguales[0])
  // Varias zonas posibles: no se elige al azar; se toma la más barata solo para mostrar un precio
  const elegida = [...(iguales.length ? iguales : propios)].sort((a, b) => a.precioFinal - b.precioFinal)[0]
  return { resultado: elegida, isla: null, islaSinConfirmar: true }
}

/** Alternativa más barata de otra agencia. Empate de precio: gana la primera en el orden recibido. */
function elegirAlternativa(resultados, { agenciaId, isla }) {
  const porAgencia = new Map()
  for (const r of resultados) {
    if (r.agencia.id === agenciaId || !r.agencia.activa || motivoNoElegible(r)) continue
    if (!porAgencia.has(r.agencia.id)) porAgencia.set(r.agencia.id, [])
    porAgencia.get(r.agencia.id).push(r)
  }
  let mejor = null
  for (const lista of porAgencia.values()) {
    const deLaIsla = isla ? lista.filter(r => islaDeZona(r.zona.nombre_zona) === isla) : []
    const candidatas = deLaIsla.length ? deLaIsla : lista
    const resultado = candidatas.reduce((a, b) => (b.precioFinal < a.precioFinal ? b : a))
    const islaSinConfirmar = !deLaIsla.length && lista.length > 1
    if (!mejor || resultado.precioFinal < mejor.resultado.precioFinal) mejor = { resultado, islaSinConfirmar }
  }
  return mejor
}

const medidaValida = v => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) > 0
const bultoConMedidas = b => medidaValida(b.largo_cm) && medidaValida(b.ancho_cm) && medidaValida(b.alto_cm)

function construirFila(cot, resultados, { precioOtraFranja } = {}) {
  const avisos = []
  const precioGuardado = cot.precio_final
  // Bulto con alguna medida vacía, null, 0, negativa o no numérica: cuenta 0 m³ (no se inventan medidas)
  const validos = cot.bultos.filter(bultoConMedidas)
  const m3 = Math.round(validos.reduce((s, b) => s + b.largo_cm * b.ancho_cm * b.alto_cm * 1e-6, 0) * 1000) / 1000
  if (cot.soloPrimerBulto) avisos.push('Solo medidas del 1er bulto')
  const invalidos = cot.bultos.length - validos.length
  if (invalidos === cot.bultos.length) avisos.push('Sin medidas')
  else if (invalidos) avisos.push(`Medidas incompletas (${invalidos} de ${cot.bultos.length} bultos)`)

  const propia = recalculoPropio(resultados, { agenciaId: cot.agencia_id, precioGuardado, zonaId: cot.zonaId })
  const precioRecalculado = propia.resultado ? propia.resultado.precioFinal : null
  let tarifaCambiada
  if (precioRecalculado == null) {
    tarifaCambiada = true
    avisos.push('Sin recalcular: agencia inactiva o sin cobertura')
  } else {
    tarifaCambiada = Math.abs(precioRecalculado - precioGuardado) > EPS
      && !(precioOtraFranja != null && Math.abs(precioOtraFranja - precioGuardado) <= EPS)
    if (tarifaCambiada) avisos.push('Tarifa cambiada')
  }

  const alt = elegirAlternativa(resultados, { agenciaId: cot.agencia_id, isla: propia.isla })
  let alternativa = null, sobrecoste = null, sobrecostePorM3 = null
  if (!alt) {
    avisos.push('Sin alternativa: cargar sí o sí')
  } else {
    const a = alt.resultado
    alternativa = { agenciaId: a.agencia.id, agencia: a.agencia.nombre, zona: a.zona.nombre_zona, precio: a.precioFinal }
    sobrecoste = r2(a.precioFinal - precioGuardado)
    sobrecostePorM3 = m3 > 0 ? r2(sobrecoste / m3) : null
    if (sobrecoste < 0) avisos.push(`Más barato con ${a.agencia.nombre}`)
    for (const av of a.avisos || []) avisos.push(`${a.agencia.nombre}: ${av}`)
  }

  if (alt?.islaSinConfirmar || propia.islaSinConfirmar) avisos.push('Isla sin confirmar')

  return {
    id: cot.id, clienteCodigo: cot.cliente_codigo, cliente: cot.cliente_razon_social, destinatario: cot.destinatario,
    cp: cot.cp_prefix, zona: propia.resultado ? propia.resultado.zona.nombre_zona : null,
    numBultos: cot.bultos.length, m3, precioGuardado, precioRecalculado, tarifaCambiada,
    alternativa, sobrecoste, sobrecostePorM3, avisos,
  }
}

/** Sin alternativa primero (m³ desc); luego sin sobrecoste/m³ (0 m³); luego sobrecoste/m³ desc; empate por m³ desc. */
function ordenarFilas(filas) {
  const grupo = f => (!f.alternativa ? 0 : f.sobrecostePorM3 == null ? 1 : 2)
  return [...filas].sort((a, b) =>
    grupo(a) - grupo(b)
    || (grupo(a) === 2 ? b.sobrecostePorM3 - a.sobrecostePorM3 : 0)
    || b.m3 - a.m3)
}

// Descarta fechas imposibles como 2026-02-31 (Date las desplaza al mes siguiente)
const fechaReal = f => { const d = new Date(f + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f }

/** Cotizaciones de un día local y una agencia, recalculadas y ordenadas. Lanza Error si fecha/agencia no son válidas. */
function obtenerOrdenCarga({ fecha, agenciaId }) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !fechaReal(fecha)) throw new Error('Fecha no válida')
  if (!Number.isInteger(agenciaId)) throw new Error('Agencia no válida')
  const { getDb } = require('../database/connection')
  const db = getDb()
  const calculo = require('./calculationService') // al llamar, para respetar un espía en los tests
  const { parseBultosJson, conPrimerBultoDeColumnas } = require('./bultosCotizacion')

  const rows = db.prepare(`SELECT c.*, cl.razon_social AS cliente_razon_social FROM cotizaciones c
    LEFT JOIN clientes cl ON cl.codigo = c.cliente_codigo
    WHERE date(c.fecha, 'localtime') = date(?) AND c.agencia_id = ?`).all(fecha, agenciaId)

  const filas = rows.map(r => {
    const row = conPrimerBultoDeColumnas(r)
    const datos = parseBultosJson(row.bultos_json)
    const soloPrimerBulto = !datos
    const bultos = datos ? datos.bultos : [{ largoCm: row.largo_cm, anchoCm: row.ancho_cm, altoCm: row.alto_cm }]
    const extras = { cp5: datos?.cp5, pesoBruto: datos?.pesoBruto, opcionesDsv: datos?.opcionesDsv, producto: datos?.producto }
    const resultados = calculo.calcularTarifas({ cpPrefix: row.cp_prefix, bultos, ...extras })
    const cot = {
      ...row, soloPrimerBulto, zonaId: datos?.zonaId ?? null,
      bultos: bultos.map(b => ({ largo_cm: b.largoCm, ancho_cm: b.anchoCm, alto_cm: b.altoCm })),
    }

    // Logística en Cataluña: la zona depende de la hora; se calcula también la otra franja
    let precioOtraFranja
    const propia = recalculoPropio(resultados, { agenciaId, precioGuardado: row.precio_final, zonaId: cot.zonaId }).resultado
    const otraFranja = { 'Matí-Tarda': 'Tarda-Matí', 'Tarda-Matí': 'Matí-Tarda' }[propia?.zona.nombre_zona]
    if (otraFranja) {
      const otra = db.prepare('SELECT * FROM zonas_agencia WHERE agencia_id = ? AND nombre_zona = ?').get(agenciaId, otraFranja)
      if (otra) precioOtraFranja = calculo.calcularPrecioBultos(propia.agencia, otra, bultos, extras).precioFinal
    }
    return construirFila(cot, resultados, { precioOtraFranja })
  })
  return ordenarFilas(filas)
}

module.exports = { islaDeZona, motivoNoElegible, recalculoPropio, elegirAlternativa, construirFila, ordenarFilas, obtenerOrdenCarga }
