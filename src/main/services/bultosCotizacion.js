// Formato de cotizaciones.bultos_json y sus helpers

// Bultos de la cotización: { bultos, cp5?, pesoBruto?, opcionesDsv?, producto?, zonaId?, zonaNombre?, baremoKgM3? }; solo se guardan los extras con valor
function bultosJson({ bultos, cp5, pesoBruto, opcionesDsv, producto, zonaId, zonaNombre, baremoKgM3 }) {
  if (!Array.isArray(bultos) || bultos.length === 0) return null
  const datos = { bultos }
  if (cp5) datos.cp5 = cp5
  if (pesoBruto) datos.pesoBruto = pesoBruto
  if (opcionesDsv && Object.keys(opcionesDsv).length > 0) datos.opcionesDsv = opcionesDsv
  if (producto && producto !== 'system') datos.producto = producto
  if (zonaId != null) datos.zonaId = zonaId
  if (zonaNombre != null) datos.zonaNombre = zonaNombre
  if (baremoKgM3 != null) datos.baremoKgM3 = baremoKgM3
  return JSON.stringify(datos)
}

// Peso volumétrico de un bulto: m³ (3 decimales, como el motor) × baremo, en kg enteros hacia arriba.
// Gemelo en el renderer: utils/pesoBulto.js. Medidas no numéricas: null.
function pesoBulto(b, baremo) {
  const m3 = Math.round(b.largoCm * b.anchoCm * b.altoCm * 1e-6 * 1000) / 1000
  const kg = Math.ceil(Math.round(m3 * baremo * 1e6) / 1e6) // quita el ruido de coma flotante antes del ceil
  return Number.isFinite(kg) ? kg : null
}

// Baremo (kg/m³) con el que el motor pesa esa agencia: DSV (motor 'reglas') usa el de su zona si lo tiene
function baremoDe(db, agenciaId, zonaId) {
  const a = agenciaId != null && db.prepare('SELECT baremo, motor FROM agencias WHERE id = ?').get(agenciaId)
  if (!a) return null
  const z = a.motor === 'reglas' && zonaId != null
    && db.prepare('SELECT baremo FROM zonas_agencia WHERE id = ? AND agencia_id = ?').get(zonaId, agenciaId)
  return z?.baremo ?? a.baremo
}

// pesoKg en cada bulto. Se conserva el de previos[i] si ese bulto no cambió de medidas; sin baremo no se toca nada
function conPesos(bultos, baremo, previos = []) {
  if (baremo == null || !Array.isArray(bultos)) return bultos
  return bultos.map((b, i) => {
    const p = previos[i]
    const igual = p?.pesoKg != null && p.largoCm === b.largoCm && p.anchoCm === b.anchoCm && p.altoCm === b.altoCm
    return { ...b, pesoKg: igual ? p.pesoKg : pesoBulto(b, baremo) }
  })
}

// Pesos por bulto para mostrar (solo con 2 o más): los guardados o, si faltan, al vuelo con el baremo actual
function pesosDeFila(db, row) {
  const datos = parseBultosJson(row.bultos_json)
  if (!datos || datos.bultos.length < 2) return null
  const baremo = datos.bultos.some(b => b.pesoKg == null) ? baremoDe(db, row.agencia_id, datos.zonaId) : null
  return datos.bultos.map(b => b.pesoKg ?? (baremo == null ? null : pesoBulto(b, baremo)))
}

// bultos_json leído como objeto; null si es NULL, corrupto o no tiene el array bultos
function parseBultosJson(texto) {
  try {
    const datos = JSON.parse(texto)
    return Array.isArray(datos?.bultos) ? datos : null
  } catch { return null }
}

// Una versión antigua puede editar largo/ancho/alto sin tocar bultos_json: para el primer bulto mandan las columnas
function conPrimerBultoDeColumnas(row) {
  const datos = parseBultosJson(row.bultos_json)
  const b0 = datos?.bultos[0]
  if (!b0 || (b0.largoCm === row.largo_cm && b0.anchoCm === row.ancho_cm && b0.altoCm === row.alto_cm)) return row
  // pesoKg se descarta: era de las medidas viejas (se recalcula al mostrar)
  datos.bultos[0] = { ...b0, largoCm: row.largo_cm, anchoCm: row.ancho_cm, altoCm: row.alto_cm, pesoKg: undefined }
  return { ...row, bultos_json: JSON.stringify(datos) }
}

module.exports = { bultosJson, parseBultosJson, conPrimerBultoDeColumnas, pesoBulto, baremoDe, conPesos, pesosDeFila }
