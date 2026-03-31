const { getDb } = require('../database/connection')

function getAll() {
  return getDb().prepare('SELECT * FROM agencias ORDER BY nombre').all()
}

function getActive() {
  return getDb().prepare('SELECT * FROM agencias WHERE activa = 1 ORDER BY nombre').all()
}

function getById(id) {
  return getDb().prepare('SELECT * FROM agencias WHERE id = ?').get(id)
}

function create({ nombre, ambito = 'Nacional', baremo = 1, recargo_combustible = 0, recargo_seguro = 0, logo_path = null, activa = 1 }) {
  const result = getDb()
    .prepare('INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa)
  return getById(result.lastInsertRowid)
}

function update(id, { nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa }) {
  getDb()
    .prepare('UPDATE agencias SET nombre=?, ambito=?, baremo=?, recargo_combustible=?, recargo_seguro=?, logo_path=?, activa=? WHERE id=?')
    .run(nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa, id)
  return getById(id)
}

function remove(id) {
  return getDb().prepare('DELETE FROM agencias WHERE id = ?').run(id)
}

module.exports = { getAll, getActive, getById, create, update, remove }
