const { ipcMain } = require('electron')
const { getDb } = require('../database/connection')

// Agencias con alguna cotización en un día local (YYYY-MM-DD). Solo lectura; para el desplegable de Orden de carga.
function agenciasDelDia(fecha) {
  if (typeof fecha !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('Fecha no válida')
  return getDb().prepare(`SELECT DISTINCT a.id, a.nombre, a.activa FROM cotizaciones c
    JOIN agencias a ON a.id = c.agencia_id
    WHERE date(c.fecha, 'localtime') = date(?)
    ORDER BY a.nombre`).all(fecha)
}

ipcMain.removeHandler('get-agencias-del-dia')
ipcMain.handle('get-agencias-del-dia', (event, args) => {
  try {
    return { ok: true, agencias: agenciasDelDia((args || {}).fecha) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

module.exports = { agenciasDelDia }
