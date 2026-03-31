const { getDb } = require('../database/connection')

function getSurchargesByAgency(agenciaId) {
  return getDb()
    .prepare('SELECT * FROM recargos_agencia WHERE agencia_id = ? ORDER BY nombre')
    .all(agenciaId)
}

function createSurcharge({ agencia_id, nombre, es_porcentaje, valor, minimo_aplicable = null, sobre_total = 0 }) {
  const result = getDb()
    .prepare('INSERT INTO recargos_agencia (agencia_id, nombre, es_porcentaje, valor, minimo_aplicable, sobre_total) VALUES (?, ?, ?, ?, ?, ?)')
    .run(agencia_id, nombre, es_porcentaje, valor, minimo_aplicable, sobre_total)
  return { id: result.lastInsertRowid, agencia_id, nombre, es_porcentaje, valor, minimo_aplicable, sobre_total }
}

function updateSurcharge(id, { nombre, es_porcentaje, valor, minimo_aplicable, sobre_total }) {
  return getDb()
    .prepare('UPDATE recargos_agencia SET nombre=?, es_porcentaje=?, valor=?, minimo_aplicable=?, sobre_total=? WHERE id=?')
    .run(nombre, es_porcentaje, valor, minimo_aplicable, sobre_total, id)
}

function removeSurcharge(id) {
  return getDb().prepare('DELETE FROM recargos_agencia WHERE id = ?').run(id)
}

module.exports = { getSurchargesByAgency, createSurcharge, updateSurcharge, removeSurcharge }
