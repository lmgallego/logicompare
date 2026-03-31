const { getDb } = require('../database/connection')

function getZonesByAgency(agenciaId) {
  return getDb()
    .prepare('SELECT * FROM zonas_agencia WHERE agencia_id = ? ORDER BY nombre_zona')
    .all(agenciaId)
}

function getZoneForCp(agenciaId, cpPrefix) {
  return getDb()
    .prepare(`
      SELECT za.* FROM zonas_agencia za
      INNER JOIN zonas_provincias zp ON zp.zona_id = za.id
      WHERE zp.agencia_id = ? AND zp.cp_prefix = ?
    `)
    .get(agenciaId, cpPrefix)
}

function createZone(agenciaId, nombreZona, kgAdicional = 0) {
  const result = getDb()
    .prepare('INSERT INTO zonas_agencia (agencia_id, nombre_zona, kg_adicional) VALUES (?, ?, ?)')
    .run(agenciaId, nombreZona, kgAdicional)
  return { id: result.lastInsertRowid, agencia_id: agenciaId, nombre_zona: nombreZona, kg_adicional: kgAdicional }
}

function assignCpToZone(agenciaId, zonaId, cpPrefix) {
  return getDb()
    .prepare('INSERT OR REPLACE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)')
    .run(agenciaId, zonaId, cpPrefix)
}

function updateZoneKgAdicional(zonaId, kgAdicional) {
  return getDb()
    .prepare('UPDATE zonas_agencia SET kg_adicional=? WHERE id=?')
    .run(kgAdicional, zonaId)
}

function removeZone(zonaId) {
  return getDb().prepare('DELETE FROM zonas_agencia WHERE id = ?').run(zonaId)
}

module.exports = { getZonesByAgency, getZoneForCp, createZone, updateZoneKgAdicional, assignCpToZone, removeZone }
