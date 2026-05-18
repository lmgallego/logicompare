const { ipcMain } = require('electron')
const { getDb } = require('../database/connection')
const { calcularTarifas } = require('../services/calculationService')

// Restricciones conocidas por agencia
const RESTRICCIONES = [
  { match: 'gls', maxLargo: 110, msg: 'GLS: máx. 110 cm de largo' },
  { match: 'dhl', maxLargo: 0, msg: 'DHL: no disponible para cajas' },
]

// Get all cajas ordered by largo
ipcMain.handle('get-cajas', () => {
  return getDb().prepare('SELECT * FROM cajas ORDER BY largo_cm ASC').all()
})

// Get distinct largos for the selector
ipcMain.handle('get-cajas-largos', () => {
  return getDb()
    .prepare('SELECT DISTINCT largo_cm FROM cajas ORDER BY largo_cm ASC')
    .all()
    .map(r => r.largo_cm)
})

// Get cajas matching a specific largo
ipcMain.handle('get-cajas-by-largo', (event, { largo }) => {
  const l = parseInt(largo)
  if (!l) return []
  return getDb().prepare('SELECT * FROM cajas WHERE largo_cm = ? ORDER BY ancho_cm ASC, alto_cm ASC').all(l)
})

// Calculate shipping for a caja + CP across all agencies
ipcMain.handle('calcular-caja', (event, { cajaId, cpPrefix }) => {
  const cp = String(cpPrefix || '').trim().padStart(2, '0').slice(0, 2)
  if (!/^\d{2}$/.test(cp)) return { ok: false, error: 'CP inválido (se esperan 2 dígitos).' }

  const db = getDb()
  const caja = db.prepare('SELECT * FROM cajas WHERE id = ?').get(cajaId)
  if (!caja) return { ok: false, error: 'Caja no encontrada.' }

  // Obtener nombre de provincia
  const prov = db.prepare('SELECT nombre FROM provincias WHERE cp_prefix = ?').get(cp)
  const provinciaNombre = prov ? prov.nombre : null

  const resultados = calcularTarifas({
    largoCm: caja.largo_cm,
    anchoCm: caja.ancho_cm,
    altoCm: caja.alto_cm,
    cpPrefix: cp,
    bultos: [{ largoCm: caja.largo_cm, anchoCm: caja.ancho_cm, altoCm: caja.alto_cm }],
  })

  // Marcar agencias con restricciones (pero no filtrarlas)
  const conAvisos = resultados.map(r => {
    const nombre = (r.agencia?.nombre || '').toLowerCase()
    let advertencia = null
    for (const rest of RESTRICCIONES) {
      if (nombre.includes(rest.match)) {
        if (rest.maxLargo === 0 || caja.largo_cm > rest.maxLargo) {
          advertencia = rest.msg
        }
      }
    }
    return { ...r, advertencia }
  })

  return {
    ok: true,
    caja,
    cpPrefix: cp,
    provinciaNombre,
    resultados: conAvisos,
  }
})

// Add a new caja
ipcMain.handle('add-caja', (event, { largoCm, anchoCm, altoCm }) => {
  const l = parseInt(largoCm), a = parseInt(anchoCm), h = parseInt(altoCm)
  if (!l || !a || !h || l <= 0 || a <= 0 || h <= 0) {
    return { ok: false, error: 'Las tres medidas deben ser números positivos.' }
  }
  try {
    getDb().prepare('INSERT INTO cajas (largo_cm, ancho_cm, alto_cm) VALUES (?, ?, ?)').run(l, a, h)
    return { ok: true }
  } catch (e) {
    if (e.message.includes('UNIQUE')) {
      return { ok: false, error: 'Ya existe una caja con esas medidas.' }
    }
    return { ok: false, error: e.message }
  }
})


// Count cajas
ipcMain.handle('count-cajas', () => {
  return getDb().prepare('SELECT COUNT(*) as c FROM cajas').get().c
})
