/**
 * Snapshot de cálculo de todas las agencias activas sobre una COPIA de la BD.
 * Sirve para demostrar que un cambio no altera el cálculo de las agencias existentes.
 *
 * Uso (better-sqlite3 está compilado para Electron, por eso se ejecuta con su binario):
 *   set ELECTRON_RUN_AS_NODE=1
 *   node_modules\electron\dist\electron.exe scripts/snapshot-agencias.js <bd.db> <salida.json> [--comparar base.json]
 *
 * Con --comparar, falla (exit 1) si alguna agencia presente en la base da otro resultado.
 * Las agencias que no estén en la base (p. ej. DSV recién añadida) se ignoran en la comparación.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const [dbOrigen, salida] = process.argv.slice(2)
const iComparar = process.argv.indexOf('--comparar')
const basePath = iComparar > 0 ? process.argv[iComparar + 1] : null
if (!dbOrigen || !salida) {
  console.error('Uso: snapshot-agencias.js <bd.db> <salida.json> [--comparar base.json]')
  process.exit(2)
}

// Copia de la BD en un directorio temporal: nunca se toca la original
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'logicompare-snap-'))
fs.copyFileSync(dbOrigen, path.join(tmpDir, 'logicompare.db'))

// Sustituto mínimo de electron: connection.js solo usa app.getPath('userData')
const loadOriginal = Module._load
Module._load = function (request, ...rest) {
  if (request === 'electron') return { app: { getPath: () => tmpDir } }
  return loadOriginal.call(this, request, ...rest)
}

// Hora fija (09:00) para que la regla horaria de Logística sea determinista
Date.prototype.getHours = () => 9

const { calcularTarifas } = require('../src/main/services/calculationService')

const CPS = ['07', '08', '17', '28', '29', '35', '43', '46', '15', '51', '00']
const ENVIOS = [
  { id: 'pequeno', bultos: [{ largoCm: 30, anchoCm: 20, altoCm: 20 }] },
  { id: 'caja-110', bultos: [{ largoCm: 110, anchoCm: 35, altoCm: 82 }] },
  { id: 'palet', bultos: [{ largoCm: 120, anchoCm: 80, altoCm: 100 }] },
  { id: 'largo-250', bultos: [{ largoCm: 250, anchoCm: 40, altoCm: 40 }] },
  { id: 'v1-dsv', bultos: [{ largoCm: 215, anchoCm: 35, altoCm: 54 }] },
  { id: 'multi-3', bultos: [
    { largoCm: 60, anchoCm: 40, altoCm: 40 },
    { largoCm: 121, anchoCm: 42, altoCm: 88 },
    { largoCm: 244, anchoCm: 27, altoCm: 37 },
  ] },
  { id: 'pesado-2500', bultos: [
    { largoCm: 200, anchoCm: 120, altoCm: 200 },
    { largoCm: 200, anchoCm: 120, altoCm: 200 },
  ] },
  { id: 'muy-pesado', bultos: Array(4).fill({ largoCm: 240, anchoCm: 120, altoCm: 200 }) },
]

const snapshot = {}
for (const envio of ENVIOS) {
  for (const cp of CPS) {
    const res = calcularTarifas({ cpPrefix: cp, bultos: envio.bultos })
    snapshot[`${envio.id}@${cp}`] = res.map(r => ({
      agencia: r.agencia.nombre,
      zona: r.zona ? r.zona.nombre_zona : null,
      metrosCubicos: r.metrosCubicos,
      peso: r.peso,
      precioBase: r.precioBase,
      precioFinal: r.precioFinal,
      desglose: r.desglose,
      error: r.error,
      maxLargoCm: r.maxLargoCm,
      maxSumaDimCm: r.maxSumaDimCm,
    }))
  }
}

fs.writeFileSync(salida, JSON.stringify(snapshot, null, 2))
const nRes = Object.values(snapshot).reduce((n, v) => n + v.length, 0)
console.log(`Snapshot: ${Object.keys(snapshot).length} envíos, ${nRes} resultados → ${salida}`)

if (basePath) {
  const base = JSON.parse(fs.readFileSync(basePath, 'utf8'))
  const agenciasBase = new Set(Object.values(base).flat().map(r => r.agencia))
  // Clave por agencia+zona: el orden global puede cambiar al intercalarse una agencia nueva
  const porClave = lista => Object.fromEntries(
    lista.filter(r => agenciasBase.has(r.agencia)).map(r => [`${r.agencia}|${r.zona}`, JSON.stringify(r)])
  )
  let diferencias = 0
  for (const clave of Object.keys(base)) {
    const a = porClave(base[clave])
    const b = porClave(snapshot[clave] || [])
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (a[k] !== b[k]) {
        diferencias++
        console.log(`DIFERENCIA ${clave} ${k}\n  antes:   ${a[k]}\n  después: ${b[k]}`)
      }
    }
  }
  console.log(diferencias === 0
    ? `OK: resultados idénticos para ${agenciasBase.size} agencias (${[...agenciasBase].join(', ')})`
    : `FALLO: ${diferencias} diferencias`)
  process.exit(diferencias === 0 ? 0 : 1)
}
