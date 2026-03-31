const { getDb } = require('../database/connection')

function getRatesByAgency(agenciaId) {
  return getDb()
    .prepare('SELECT * FROM tarifas_agencia WHERE agencia_id = ? ORDER BY zona_id, kilos_desde')
    .all(agenciaId)
}

function getRatesByAgencyAndZone(agenciaId, zonaId) {
  return getDb()
    .prepare(`
      SELECT * FROM tarifas_agencia
      WHERE agencia_id = ? AND zona_id = ?
      ORDER BY kilos_desde
    `)
    .all(agenciaId, zonaId)
}

function getRateForWeight(agenciaId, zonaId, peso) {
  return getDb()
    .prepare(`
      SELECT * FROM tarifas_agencia
      WHERE agencia_id = ? AND zona_id = ?
        AND kilos_desde < ? AND kilos_hasta >= ?
      ORDER BY kilos_desde
      LIMIT 1
    `)
    .get(agenciaId, zonaId, peso, peso)
}

function getRateForWeight15(agenciaId, zonaId) {
  return getDb()
    .prepare(`
      SELECT * FROM tarifas_agencia
      WHERE agencia_id = ? AND zona_id = ?
      ORDER BY kilos_hasta DESC
      LIMIT 1
    `)
    .get(agenciaId, zonaId)
}

function createRate({ agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base }) {
  const result = getDb()
    .prepare('INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)')
    .run(agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base)
  return { id: result.lastInsertRowid, agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base }
}

function updateRate(id, { kilos_desde, kilos_hasta, precio_base }) {
  return getDb()
    .prepare('UPDATE tarifas_agencia SET kilos_desde=?, kilos_hasta=?, precio_base=? WHERE id=?')
    .run(kilos_desde, kilos_hasta, precio_base, id)
}

function updateRatePrecio(id, precioBase) {
  return getDb()
    .prepare('UPDATE tarifas_agencia SET precio_base=? WHERE id=?')
    .run(precioBase, id)
}

function removeRate(id) {
  return getDb().prepare('DELETE FROM tarifas_agencia WHERE id = ?').run(id)
}

module.exports = { getRatesByAgency, getRatesByAgencyAndZone, getRateForWeight, getRateForWeight15, createRate, updateRate, updateRatePrecio, removeRate }
