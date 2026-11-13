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

/** destino = { id, nombre }: el otro camión, al que va el sobrante. */
function construirFila(cot, resultados, { precioOtraFranja, destino }) {
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

  // La alternativa es siempre el camión destino (si es elegible, activo y con precio)
  const alt = elegirAlternativa(resultados.filter(r => r.agencia.id === destino.id), { agenciaId: cot.agencia_id, isla: propia.isla })
  let alternativa = null, sobrecoste = null
  if (!alt) {
    avisos.push(`No se puede pasar a ${destino.nombre}`)
  } else {
    const a = alt.resultado
    alternativa = { agenciaId: a.agencia.id, agencia: a.agencia.nombre, zona: a.zona.nombre_zona, precio: a.precioFinal }
    sobrecoste = r2(a.precioFinal - precioGuardado)
    if (sobrecoste < 0) avisos.push(`Más barato con ${a.agencia.nombre}`)
    for (const av of a.avisos || []) avisos.push(`${a.agencia.nombre}: ${av}`)
  }

  if (alt?.islaSinConfirmar || propia.islaSinConfirmar) avisos.push('Isla sin confirmar')

  return {
    id: cot.id, clienteCodigo: cot.cliente_codigo, cliente: cot.cliente_razon_social, destinatario: cot.destinatario,
    cp: cot.cp_prefix, zona: propia.resultado ? propia.resultado.zona.nombre_zona : null,
    numBultos: cot.bultos.length, m3, precioGuardado, precioRecalculado, tarifaCambiada,
    agenciaDestino: destino.nombre, alternativa, sobrecoste, avisos,
  }
}

/** No pasables primero; luego sobrecoste en euros de mayor a menor; empate: más bultos antes. */
function ordenarFilas(filas) {
  const grupo = f => (f.alternativa ? 1 : 0)
  return [...filas].sort((a, b) =>
    grupo(a) - grupo(b)
    || (grupo(a) ? b.sobrecoste - a.sobrecoste : 0)
    || b.numBultos - a.numBultos)
}

const MAX_EXACTO = 20

/**
 * Qué cotizaciones pasar al otro camión si solo caben capacidadBultos.
 * Se pasan enteras; mínima Σ sobrecoste con Σ bultos ≥ sobran; desempate: menos bultos de más, menos cotizaciones.
 * Devuelve { sobran, opciones: [{ ids, bultos, sobrecoste }] (hasta 3), recomendadas, metodo, avisos }.
 */
function proponerPaso({ filas, capacidadBultos }) {
  const pasables = filas.filter(f => f.alternativa)
  const recomendadas = pasables.filter(f => f.sobrecoste < 0).map(f => f.id)
  const total = filas.reduce((s, f) => s + f.numBultos, 0)
  const sobran = Number.isFinite(capacidadBultos) && capacidadBultos >= 0 ? total - capacidadBultos : 0
  const res = { sobran: Math.max(0, sobran), opciones: [], recomendadas, metodo: null, avisos: [] }
  if (sobran <= 0) return res

  const opcion = sel => ({ ids: sel.map(f => f.id), bultos: sel.reduce((s, f) => s + f.numBultos, 0), sobrecoste: r2(sel.reduce((s, f) => s + f.sobrecoste, 0)) })
  const maxPasable = pasables.reduce((s, f) => s + f.numBultos, 0)
  if (maxPasable < sobran) {
    const destino = filas[0].agenciaDestino
    res.metodo = 'parcial'
    res.opciones = [opcion(pasables)]
    const faltan = sobran - maxPasable
    res.avisos.push(`${faltan === 1 ? 'Falta 1 bulto' : `Faltan ${faltan} bultos`} por mover que no se ${faltan === 1 ? 'puede' : 'pueden'} pasar a ${destino}`)
    return res
  }

  if (pasables.length > MAX_EXACTO) {
    // ponytail: voraz por €/bulto, una sola opción; no garantiza el óptimo
    res.metodo = 'voraz'
    res.avisos.push(`Más de ${MAX_EXACTO} cotizaciones pasables: propuesta aproximada`)
    const orden = [...pasables].sort((a, b) => a.sobrecoste / a.numBultos - b.sobrecoste / b.numBultos || b.numBultos - a.numBultos)
    const sel = []
    let b = 0
    for (const f of orden) { if (b >= sobran) break; sel.push(f); b += f.numBultos }
    res.opciones = [opcion(sel)]
    return res
  }

  // Fuerza bruta: sumas por máscara a partir de la máscara sin su bit más bajo (céntimos enteros para comparar)
  res.metodo = 'exacto'
  const n = pasables.length, N = 1 << n
  const bul = new Int32Array(N), cts = new Float64Array(N), cnt = new Uint8Array(N)
  const mejor = (a, b) => cts[a] - cts[b] || bul[a] - bul[b] || cnt[a] - cnt[b] // bul: menos bultos de más
  const top = []
  for (let m = 1; m < N; m++) {
    const i = 31 - Math.clz32(m & -m), prev = m & (m - 1)
    bul[m] = bul[prev] + pasables[i].numBultos
    cts[m] = cts[prev] + Math.round(pasables[i].sobrecoste * 100)
    cnt[m] = cnt[prev] + 1
    if (bul[m] < sobran) continue
    if (top.length === 3 && mejor(m, top[2]) >= 0) continue
    top.push(m); top.sort(mejor); if (top.length > 3) top.pop()
  }
  res.opciones = top.map(m => opcion(pasables.filter((_, i) => m & (1 << i))))
  return res
}

// Descarta fechas imposibles como 2026-02-31 (Date las desplaza al mes siguiente)
const fechaReal = f => { const d = new Date(f + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f }

/** Cotizaciones de un día local y una agencia, recalculadas y ordenadas. Lanza Error si fecha/agencia no son válidas. */
function obtenerOrdenCarga({ fecha, agenciaId, agenciaDestinoId }) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !fechaReal(fecha)) throw new Error('Fecha no válida')
  if (!Number.isInteger(agenciaId)) throw new Error('Agencia no válida')
  if (!Number.isInteger(agenciaDestinoId) || agenciaDestinoId === agenciaId) throw new Error('Agencia destino no válida')
  const { getDb } = require('../database/connection')
  const db = getDb()
  const destino = db.prepare('SELECT id, nombre FROM agencias WHERE id = ?').get(agenciaDestinoId)
  if (!destino) throw new Error('Agencia destino no válida')
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
    return construirFila(cot, resultados, { precioOtraFranja, destino })
  })
  return ordenarFilas(filas)
}

module.exports = { islaDeZona, motivoNoElegible, recalculoPropio, elegirAlternativa, construirFila, ordenarFilas, proponerPaso, obtenerOrdenCarga }
