const { ipcMain } = require('electron')
const { obtenerOrdenCarga, proponerPaso } = require('../services/ordenCargaService')

// Orden de carga: cotizaciones de un día y agencia, ordenadas por lo que cuesta moverlas a otra agencia
ipcMain.removeHandler('get-orden-carga')
ipcMain.handle('get-orden-carga', (event, args) => {
  try {
    const { fecha, agenciaId, agenciaDestinoId } = args || {}
    return { ok: true, filas: obtenerOrdenCarga({ fecha, agenciaId, agenciaDestinoId }) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Propuesta de qué pasar al otro camión; cálculo puro sobre las filas ya obtenidas
ipcMain.removeHandler('proponer-paso')
ipcMain.handle('proponer-paso', (event, args) => {
  try {
    const { filas, capacidadBultos } = args || {}
    if (!Array.isArray(filas)) throw new Error('Filas no válidas')
    return { ok: true, propuesta: proponerPaso({ filas, capacidadBultos }) }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
