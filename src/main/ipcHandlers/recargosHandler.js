const { ipcMain } = require('electron')
const { getDb } = require('../database/connection')
const { getRulesByAgency, updateRule } = require('../repositories/surchargeRepository')

// Recargos editables de agencias con motor 'reglas' (DSV)

ipcMain.removeHandler('get-recargos')
ipcMain.handle('get-recargos', (event, agenciaId) => getRulesByAgency(agenciaId))

ipcMain.removeHandler('update-recargos')
ipcMain.handle('update-recargos', (event, filas) => {
  try {
    getDb().transaction(() => {
      for (const f of filas || []) {
        updateRule(f.id, {
          valor: Number(f.valor) || 0,
          minimo_aplicable: f.minimo_aplicable === '' || f.minimo_aplicable == null ? null : Number(f.minimo_aplicable),
          activo: f.activo ? 1 : 0,
          por_defecto: f.por_defecto ? 1 : 0,
          nota: f.nota || null,
        })
      }
    })()
    return { ok: true, actualizados: (filas || []).length }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})
