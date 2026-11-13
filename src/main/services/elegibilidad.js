// Reglas de "fuera de norma" por agencia. Duplican las de la pantalla
// (src/renderer/js/components/formHandler.js:430-438); ver docs/elegibilidad-agencias.md.

/** Devuelve el motivo por el que la agencia no admite la mercancía, o null si la admite. */
function motivoFueraDeNorma({ nombreAgencia, maxLargoCm, maxSumaDimCm }) {
  const nombre = (nombreAgencia || '').toLowerCase()
  if (nombre.includes('gls') && maxLargoCm > 110) return 'GLS: largo > 110 cm'
  if (nombre.includes('seur') && (maxLargoCm > 175 || maxSumaDimCm > 300)) return 'Seur fuera de norma'
  return null
}

module.exports = { motivoFueraDeNorma }
