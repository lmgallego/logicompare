/**
 * Las vistas pintan las fechas de la BD (UTC, 'YYYY-MM-DD HH:MM:SS') en hora local.
 * Comprueba formatDate de formatters.js y que ninguna vista lleve su propio formateador de fechas.
 *
 * Uso: TZ=Europe/Madrid node --no-warnings scripts/test-fechas-vistas.mjs
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatDate } from '../src/renderer/js/utils/formatters.js'

if (new Date('2026-08-01T00:00:00Z').getTimezoneOffset() !== -120 || new Date('2026-01-15T00:00:00Z').getTimezoneOffset() !== -60) {
  console.error('Zona horaria distinta de Europe/Madrid: ejecuta con TZ=Europe/Madrid')
  process.exit(2)
}

function caso(nombre, fn) {
  try { fn(); console.log('  ok  ', nombre) } catch (e) { console.log('  FALLO', nombre, '\n', e.message); process.exitCode = 1 }
}

caso('formatDate pasa de UTC a hora local (invierno y verano)', () => {
  assert.equal(formatDate('2026-11-02 14:04:00'), '02/11/2026, 15:04')
  assert.equal(formatDate('2026-08-15 10:00:00'), '15/08/2026, 12:00')
})

caso('formatDate: las 00:30 local caen en el día siguiente al UTC', () => {
  assert.equal(formatDate('2026-11-02 23:30:00'), '03/11/2026, 00:30')
})

// Un formateador propio con new Date(fecha) sin 'Z' interpreta la fecha UTC como local (bug de Pendientes)
caso('ninguna vista define su propio formatDate', () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/renderer/js/components')
  const conPropio = fs.readdirSync(dir).filter(f => /function formatDate\s*\(/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
  assert.deepEqual(conPropio, [])
})
