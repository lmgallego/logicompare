// Orden de carga: dadas las cotizaciones de una agencia en un día, ordena de "más caro de mover
// a otra agencia" a "más barato". Aquí solo hay funciones puras; obtenerOrdenCarga (BD) llega después.
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

function construirFila(cot, resultados, { precioOtraFranja } = {}) {
  const avisos = []
  const precioGuardado = cot.precio_final
  const m3 = Math.round(cot.bultos.reduce((s, b) => s + (Number(b.largo_cm) || 0) * (Number(b.ancho_cm) || 0) * (Number(b.alto_cm) || 0) * 1e-6, 0) * 1000) / 1000
  if (cot.soloPrimerBulto) avisos.push('Solo medidas del 1er bulto')

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

/** Sin alternativa primero (m³ desc); luego sobrecoste/m³ desc (null al final); empate por m³ desc. */
function ordenarFilas(filas) {
  const grupo = f => (!f.alternativa ? 0 : f.sobrecostePorM3 == null ? 2 : 1)
  return [...filas].sort((a, b) =>
    grupo(a) - grupo(b)
    || (grupo(a) === 1 ? b.sobrecostePorM3 - a.sobrecostePorM3 : 0)
    || b.m3 - a.m3)
}

function obtenerOrdenCarga() { throw new Error('Pendiente') }

module.exports = { islaDeZona, motivoNoElegible, recalculoPropio, elegirAlternativa, construirFila, ordenarFilas, obtenerOrdenCarga }
