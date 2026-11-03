const { ipcMain } = require('electron')
const { obtenerOrdenCarga } = require('../services/ordenCargaService')

// Orden de carga: cotizaciones de un día y agencia, ordenadas por lo que cuesta moverlas a otra agencia
ipcMain.removeHandler('get-orden-carga')
ipcMain.handle('get-orden-carga', (event, args) => {
  try {
    const { fecha, agenciaId } = args || {}
    return { ok: true, filas: obtenerOrdenCarga({ fecha, agenciaId }) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
