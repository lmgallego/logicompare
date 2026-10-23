const path = require('path')
const fs = require('fs')
const { app } = require('electron')
const agencyRepo = require('../repositories/agencyRepository')
const zoneRepo = require('../repositories/zoneRepository')
const rateRepo = require('../repositories/rateRepository')
const surchargeRepo = require('../repositories/surchargeRepository')
const { getDb } = require('../database/connection')

function getAllAgencies() {
  return agencyRepo.getAll()
}

function getAgencyDetail(id) {
  const agencia = agencyRepo.getById(id)
  if (!agencia) return null
  const zonas = zoneRepo.getZonesByAgency(id)
  const recargos = surchargeRepo.getSurchargesByAgency(id)
  return { agencia, zonas, recargos }
}

function createAgency(data) {
  return agencyRepo.create(data)
}

function updateAgency(id, data) {
  return agencyRepo.update(id, data)
}

// No se borra una agencia con cotizaciones: se perdería el historial. Se desactiva.
function deleteAgency(id) {
  const n = getDb().prepare('SELECT COUNT(*) AS n FROM cotizaciones WHERE agencia_id = ?').get(id).n
  if (n > 0) return { ok: false, cotizaciones: n, error: `Tiene ${n} cotizaciones; desactívala en su lugar` }
  agencyRepo.remove(id)
  return { ok: true }
}

function saveLogoFile(agenciaId, srcPath, originalName) {
  const logosDir = path.join(app.getPath('userData'), 'logos')
  if (!fs.existsSync(logosDir)) fs.mkdirSync(logosDir, { recursive: true })
  const ext = path.extname(originalName)
  const destName = `agency_${agenciaId}${ext}`
  const destPath = path.join(logosDir, destName)
  fs.copyFileSync(srcPath, destPath)
  return destPath
}

function createZone(agenciaId, nombreZona) {
  return zoneRepo.createZone(agenciaId, nombreZona)
}

function assignCpToZone(agenciaId, zonaId, cpPrefix) {
  return zoneRepo.assignCpToZone(agenciaId, zonaId, cpPrefix)
}

function createRate(data) {
  return rateRepo.createRate(data)
}

function createSurcharge(data) {
  return surchargeRepo.createSurcharge(data)
}

module.exports = {
  getAllAgencies,
  getAgencyDetail,
  createAgency,
  updateAgency,
  deleteAgency,
  saveLogoFile,
  createZone,
  assignCpToZone,
  createRate,
  createSurcharge,
}
