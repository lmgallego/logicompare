const Database = require('better-sqlite3')
const path = require('path')
const { app } = require('electron')
const { runMigrations } = require('./migrations')

let db

function getDb() {
  if (!db) {
    const dbPath = path.join(app.getPath('userData'), 'logicompare.db')
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    runMigrations(db)
  }
  return db
}

module.exports = { getDb }
