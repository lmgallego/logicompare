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

// ── Motor por reglas (DSV) ────────────────────────────────────────────────
function getActiveRulesByAgency(agenciaId) {
  return getDb()
    .prepare('SELECT * FROM recargos_agencia WHERE agencia_id = ? AND activo = 1 AND codigo IS NOT NULL ORDER BY orden')
    .all(agenciaId)
}

function getRulesByAgency(agenciaId) {
  return getDb()
    .prepare('SELECT * FROM recargos_agencia WHERE agencia_id = ? AND codigo IS NOT NULL ORDER BY orden')
    .all(agenciaId)
}

function updateRule(id, { valor, minimo_aplicable, activo, por_defecto, nota }) {
  return getDb()
    .prepare("UPDATE recargos_agencia SET valor=?, minimo_aplicable=?, activo=?, por_defecto=?, nota=?, actualizado=datetime('now') WHERE id=?")
    .run(valor, minimo_aplicable, activo, por_defecto, nota, id)
}

function getCpAreas(agenciaId, cp5) {
  return getDb()
    .prepare('SELECT tipo FROM cp_areas WHERE agencia_id = ? AND cp5 = ?')
    .all(agenciaId, cp5)
    .map(r => r.tipo)
}

module.exports = { getSurchargesByAgency, createSurcharge, updateSurcharge, removeSurcharge, getActiveRulesByAgency, getRulesByAgency, updateRule, getCpAreas }
