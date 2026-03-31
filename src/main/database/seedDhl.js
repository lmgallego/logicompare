const { getDb } = require('./connection')

const db = getDb()

const insertAll = db.transaction(() => {
  const existing = db.prepare("SELECT id FROM agencias WHERE nombre = 'DHL'").get()
  if (existing) {
    console.log('[seed] DHL ya existe, omitiendo...')
    return
  }

  db.prepare(
    `INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa)
     VALUES ('DHL', 'Nacional', 200, 0, 0, NULL, 1)`
  ).run()

  console.log('[seed] ✅ DHL restaurada correctamente (solo Debidos/RECA, sin tarifas).')
})

insertAll()
