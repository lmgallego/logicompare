const { getDb } = require('./connection')

const db = getDb()

const insertAll = db.transaction(() => {
  // Delete all existing SEUR entries (baremo=200, not GLS or Logistica)
  const existingAll = db.prepare(
    "SELECT id, nombre FROM agencias WHERE nombre LIKE 'SEUR' OR nombre LIKE 'Seur'"
  ).all()
  for (const row of existingAll) {
    db.prepare('DELETE FROM agencias WHERE id = ?').run(row.id)
    console.log(`[seed] Eliminada agencia ID ${row.id} ("${row.nombre}").`)
  }

  // Baremo 200: 1 m³ = 200 kg (editable desde UI)
  const agencia = db.prepare(
    `INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa)
     VALUES ('SEUR', 'Nacional', 200, 0, 0, NULL, 1)`
  ).run()
  const agId = agencia.lastInsertRowid
  console.log('[seed] Agencia SEUR creada. ID:', agId)

  // ── Zonas ────────────────────────────────────────────────────────────────
  // 4 zonas de precio, todas visibles en Pagados y Debidos (solo_debidos=0)
  const insertZona = db.prepare(
    'INSERT INTO zonas_agencia (agencia_id, nombre_zona, kg_adicional, solo_debidos) VALUES (?, ?, ?, ?)'
  )

  const zonas = [
    { nombre: 'Medio Peninsular', kgAd: 0.45, soloDebidos: 0 },
    { nombre: 'Largo Peninsular', kgAd: 0.59, soloDebidos: 0 },
    { nombre: 'Baleares',         kgAd: 0.86, soloDebidos: 0 },
    { nombre: 'Portugal',         kgAd: 0.92, soloDebidos: 0 },
  ]

  const zonaIds = {}
  for (const z of zonas) {
    const res = insertZona.run(agId, z.nombre, z.kgAd, z.soloDebidos)
    zonaIds[z.nombre] = res.lastInsertRowid
  }

  // ── CP → Zona ─────────────────────────────────────────────────────────────
  // Medio Peninsular: todos los CPs del JSON excepto 07 (Baleares) y 00 (Portugal)
  const cpMedioPeninsular = [
    '01','02','03','08','09','12','13','16','17','19','20','22','25',
    '26','28','30','31','34','39','40','42','43','44','45','46','48','50',
  ]
  // Largo Peninsular
  const cpLargoPeninsular = [
    '04','05','06','10','11','14','15','18','21','23','24','27','29',
    '32','33','36','37','41','47','49',
  ]
  const cpBaleares = ['07']
  const cpPortugal = ['00']

  const insertCp = db.prepare(
    'INSERT OR REPLACE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)'
  )

  for (const cp of cpMedioPeninsular) insertCp.run(agId, zonaIds['Medio Peninsular'], cp)
  for (const cp of cpLargoPeninsular) insertCp.run(agId, zonaIds['Largo Peninsular'], cp)
  for (const cp of cpBaleares)        insertCp.run(agId, zonaIds['Baleares'],          cp)
  for (const cp of cpPortugal)        insertCp.run(agId, zonaIds['Portugal'],           cp)

  // ── Tarifas ───────────────────────────────────────────────────────────────
  // Tramos: 0-3, 3-5, 5-10, 10-15, 15-20, 20-25, 25-30, 30-40, 40-50 kg
  // Para >50 kg: precio_50kg + ceil(peso-50) × kg_adicional de la zona
  const insertTarifa = db.prepare(
    'INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)'
  )

  const tarifas = {
    'Medio Peninsular': [
      [0,3,6.58],[3,5,7.01],[5,10,8.70],[10,15,9.71],[15,20,11.46],
      [20,25,12.97],[25,30,14.68],[30,40,17.90],[40,50,21.09],
    ],
    'Largo Peninsular': [
      [0,3,7.03],[3,5,7.83],[5,10,10.34],[10,15,12.07],[15,20,14.52],
      [20,25,16.88],[25,30,19.22],[30,40,23.94],[40,50,28.69],
    ],
    'Baleares': [
      [0,3,10.56],[3,5,11.74],[5,10,15.46],[10,15,17.40],[15,20,20.89],
      [20,25,24.29],[25,30,27.69],[30,40,34.51],[40,50,41.28],
    ],
    'Portugal': [
      [0,3,10.52],[3,5,11.69],[5,10,15.44],[10,15,18.01],[15,20,21.73],
      [20,25,25.23],[25,30,28.75],[30,40,35.79],[40,50,42.87],
    ],
  }

  for (const [zonaKey, filas] of Object.entries(tarifas)) {
    for (const [desde, hasta, precio] of filas) {
      insertTarifa.run(agId, zonaIds[zonaKey], desde, hasta, precio)
    }
  }

  console.log('[seed] ✅ SEUR insertada correctamente.')
  console.log('[seed]    Zonas: Medio Peninsular / Largo Peninsular / Baleares / Portugal')
  console.log('[seed]    Sin cobertura: Canarias (35,38), Ceuta (51), Melilla (52)')
  console.log('[seed]    Recargos: 0 (configurar desde Base de datos)')
})

insertAll()
