const { ipcMain, dialog } = require('electron')
const agencyService = require('../services/agencyService')
const { getRatesByAgency, updateRatePrecio } = require('../repositories/rateRepository')
const { updateZoneKgAdicional } = require('../repositories/zoneRepository')

ipcMain.handle('get-agencies', () => agencyService.getAllAgencies())

ipcMain.handle('get-agency-detail', (event, id) => agencyService.getAgencyDetail(id))

ipcMain.handle('create-agency', (event, data) => agencyService.createAgency(data))

ipcMain.handle('update-agency', (event, { id, data }) => agencyService.updateAgency(id, data))

ipcMain.handle('delete-agency', (event, id) => agencyService.deleteAgency(id))

ipcMain.handle('select-logo-file', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Seleccionar logo de agencia',
    filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

ipcMain.handle('save-agency-logo', (event, { agenciaId, srcPath, originalName }) => {
  return agencyService.saveLogoFile(agenciaId, srcPath, originalName)
})

ipcMain.handle('create-zone', (event, { agenciaId, nombreZona }) =>
  agencyService.createZone(agenciaId, nombreZona)
)

ipcMain.handle('assign-cp-to-zone', (event, { agenciaId, zonaId, cpPrefix }) =>
  agencyService.assignCpToZone(agenciaId, zonaId, cpPrefix)
)

ipcMain.handle('create-rate', (event, data) => agencyService.createRate(data))

ipcMain.handle('create-surcharge', (event, data) => agencyService.createSurcharge(data))

ipcMain.handle('get-tarifas-by-agency', (event, agenciaId) => getRatesByAgency(agenciaId))

ipcMain.handle('update-rate', (event, { id, precio_base }) => updateRatePrecio(id, precio_base))

ipcMain.handle('update-zona-kg-adicional', (event, { zonaId, kgAdicional }) => updateZoneKgAdicional(zonaId, kgAdicional))
