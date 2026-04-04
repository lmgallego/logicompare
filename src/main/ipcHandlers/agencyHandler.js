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

ipcMain.handle('get-agencies-tariff-comparison', (event, agenciaIds) => {
  const { getDb } = require('../database/connection')
  const db = getDb()

  const placeholders = agenciaIds.map(() => '?').join(',')

  // Get agencies
  const agencias = db.prepare(
    `SELECT id, nombre FROM agencias WHERE id IN (${placeholders}) ORDER BY nombre`
  ).all(...agenciaIds)

  // Get all distinct weight bands across selected agencies (union of all kilos_desde values)
  const bandas = db.prepare(`
    SELECT DISTINCT kilos_desde, kilos_hasta
    FROM tarifas_agencia
    WHERE agencia_id IN (${placeholders})
    ORDER BY kilos_desde ASC
  `).all(...agenciaIds)

  // For each agency, get the minimum precio_base per weight band (best zone price)
  const precios = db.prepare(`
    SELECT agencia_id, kilos_desde, kilos_hasta,
           MIN(precio_base) as precio_min,
           MAX(precio_base) as precio_max,
           es_por_tonelada
    FROM tarifas_agencia
    WHERE agencia_id IN (${placeholders})
    GROUP BY agencia_id, kilos_desde, kilos_hasta
    ORDER BY agencia_id, kilos_desde
  `).all(...agenciaIds)

  // Index by agencia_id -> kilos_desde -> data
  const preciosIdx = {}
  precios.forEach(p => {
    if (!preciosIdx[p.agencia_id]) preciosIdx[p.agencia_id] = {}
    preciosIdx[p.agencia_id][p.kilos_desde] = p
  })

  return { agencias, bandas, preciosIdx }
})
