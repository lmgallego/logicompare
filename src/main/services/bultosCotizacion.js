// Formato de cotizaciones.bultos_json y sus helpers

// Bultos de la cotización: { bultos, cp5?, pesoBruto?, opcionesDsv?, producto?, zonaId?, zonaNombre? }; solo se guardan los extras con valor
function bultosJson({ bultos, cp5, pesoBruto, opcionesDsv, producto, zonaId, zonaNombre }) {
  if (!Array.isArray(bultos) || bultos.length === 0) return null
  const datos = { bultos }
  if (cp5) datos.cp5 = cp5
  if (pesoBruto) datos.pesoBruto = pesoBruto
  if (opcionesDsv && Object.keys(opcionesDsv).length > 0) datos.opcionesDsv = opcionesDsv
  if (producto && producto !== 'system') datos.producto = producto
  if (zonaId != null) datos.zonaId = zonaId
  if (zonaNombre != null) datos.zonaNombre = zonaNombre
  return JSON.stringify(datos)
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
  datos.bultos[0] = { ...b0, largoCm: row.largo_cm, anchoCm: row.ancho_cm, altoCm: row.alto_cm }
  return { ...row, bultos_json: JSON.stringify(datos) }
}

module.exports = { bultosJson, parseBultosJson, conPrimerBultoDeColumnas }
