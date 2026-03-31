/**
 * Formatea un número como precio en euros.
 * @param {number} value
 * @returns {string}
 */
export function formatPrice(value) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/**
 * Formatea un peso en kg.
 * @param {number} value
 * @returns {string}
 */
export function formatWeight(value) {
  if (value === null || value === undefined) return '—'
  return `${Number(value)} kg`
}

export function formatVolume(value) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value) + ' m³'
}

/**
 * Formatea una fecha ISO a formato local español.
 * @param {string} isoString
 * @returns {string}
 */
export function formatDate(isoString) {
  if (!isoString) return '—'
  const d = new Date(isoString.replace(' ', 'T') + 'Z')
  return d.toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/**
 * Formatea dimensiones como cadena legible.
 * @param {number} l @param {number} a @param {number} h
 * @returns {string}
 */
export function formatDimensions(l, a, h) {
  return `${l}×${a}×${h}`
}
