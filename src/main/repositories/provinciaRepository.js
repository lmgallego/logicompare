const { getDb } = require('../database/connection')

function getAll() {
  return getDb().prepare('SELECT * FROM provincias ORDER BY cp_prefix').all()
}

function getByPrefix(cpPrefix) {
  return getDb().prepare('SELECT * FROM provincias WHERE cp_prefix = ?').get(cpPrefix)
}

module.exports = { getAll, getByPrefix }
