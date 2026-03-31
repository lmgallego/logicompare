const { getDb } = require('./connection')

const db = getDb()

const insertAll = db.transaction(() => {
  // Delete Logistica entries: identified by baremo=200 and not being GLS Express
  const existingAll = db.prepare(
    "SELECT id, nombre FROM agencias WHERE baremo = 200 AND nombre != 'GLS Express'"
  ).all()
  for (const row of existingAll) {
    db.prepare('DELETE FROM agencias WHERE id = ?').run(row.id)
    console.log(`[seed] Eliminada agencia ID ${row.id} ("${row.nombre}").`)
  }
  console.log(`[seed] Limpieza completada. ${existingAll.length} entrada(s) eliminada(s).`)

  // Baremo 200: 1 m³ = 200 kg (valor editable desde UI)
  const agencia = db.prepare(
    `INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa)
     VALUES ('Logística', 'Nacional', 200, 0, 0, NULL, 1)`
  ).run()
  const agId = agencia.lastInsertRowid
  console.log('[seed] Agencia Logística creada. ID:', agId)

  // ── Zonas ────────────────────────────────────────────────────────────────
  // solo_debidos=1 → Mallorca, IBZ-Menorca, Formentera (no aparecen en Pagados)
  // Las zonas horarias Cataluña (Matí-Tarda / Tarda-Matí) comparten los mismos CP:
  //   08 Barcelona, 17 Girona, 25 Lleida, 43 Tarragona
  // La elección entre ambas se hace en calculationService según hora del sistema.
  const insertZona = db.prepare(
    'INSERT INTO zonas_agencia (agencia_id, nombre_zona, kg_adicional, solo_debidos) VALUES (?, ?, ?, ?)'
  )

  const zonas = [
    { nombre: 'Matí-Tarda',   kgAd: 0.243, soloDebidos: 0 }, // Cataluña <11h
    { nombre: 'Tarda-Matí',   kgAd: 0.223, soloDebidos: 0 }, // Cataluña 11-19h
    { nombre: 'Nacional',     kgAd: 0.580, soloDebidos: 0 }, // Resto península
    { nombre: 'Mallorca',     kgAd: 0.415, soloDebidos: 1 }, // solo Debidos
    { nombre: 'IBZ-Menorca',  kgAd: 0.478, soloDebidos: 1 }, // solo Debidos
    { nombre: 'Formentera',   kgAd: 0.570, soloDebidos: 1 }, // solo Debidos
  ]

  const zonaIds = {}
  for (const z of zonas) {
    const res = insertZona.run(agId, z.nombre, z.kgAd, z.soloDebidos)
    zonaIds[z.nombre] = res.lastInsertRowid
  }

  // ── CP → Zona ─────────────────────────────────────────────────────────────
  // Cataluña: 08 Barcelona, 17 Girona, 25 Lleida, 43 Tarragona
  // → apuntan a Matí-Tarda (la horaria activa se elige en runtime por hora)
  //   Tarda-Matí no tiene CPs asignados: se activa dinámicamente en calculationService
  // Nacional: resto de península excl. Canarias(35,38), Ceuta(51), Melilla(52)
  // Baleares (07) → Mallorca (solo_debidos)
  const cpCatalunya = ['08', '17', '25', '43']
  const cpNacional = [
    '01','02','03','04','05','06','09','10','11','12','13','14','15',
    '16','18','19','20','21','22','23','24','26','27','28','29','30',
    '31','32','33','34','36','37','39','40','41','42','44','45','46',
    '47','48','49','50',
  ]
  const cpMallorca    = ['07']
  const cpIbzMenorca  = [] // no hay CP diferenciado en provincias; se accede vía UI
  const cpFormentera  = [] // ídem

  const insertCp = db.prepare(
    'INSERT OR REPLACE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)'
  )

  // Cataluña → Matí-Tarda (zona base; la lógica horaria intercambia a Tarda-Matí en runtime)
  for (const cp of cpCatalunya) insertCp.run(agId, zonaIds['Matí-Tarda'], cp)
  for (const cp of cpNacional)   insertCp.run(agId, zonaIds['Nacional'],  cp)
  for (const cp of cpMallorca)   insertCp.run(agId, zonaIds['Mallorca'],  cp)

  // ── Tarifas ───────────────────────────────────────────────────────────────
  // Tramos: 0-10, 10-20, 20-30, 30-40, 40-50 kg
  // Para >50 kg: precio_50kg + ceil(peso-50) × kg_adicional de la zona
  const insertTarifa = db.prepare(
    'INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)'
  )

  const tarifas = {
    'Matí-Tarda':  [ [0,10,8.30],  [10,20,12.42], [20,30,14.08], [30,40,16.56], [40,50,19.19] ],
    'Tarda-Matí':  [ [0,10,7.64],  [10,20,10.58], [20,30,12.94], [30,40,15.28], [40,50,17.61] ],
    'Nacional':    [ [0,10,10.86], [10,20,15.03], [20,30,18.38], [30,40,21.70], [40,50,25.04] ],
    'Mallorca':    [ [0,10,10.68], [10,20,12.31], [20,30,17.99], [30,40,21.77], [40,50,27.08] ],
    'IBZ-Menorca': [ [0,10,12.10], [10,20,15.97], [20,30,21.50], [30,40,27.62], [40,50,34.25] ],
    'Formentera':  [ [0,10,18.75], [10,20,23.88], [20,30,30.48], [30,40,37.68], [40,50,43.61] ],
  }

  for (const [zonaKey, filas] of Object.entries(tarifas)) {
    for (const [desde, hasta, precio] of filas) {
      insertTarifa.run(agId, zonaIds[zonaKey], desde, hasta, precio)
    }
  }

  console.log('[seed] ✅ Logística insertada correctamente.')
  console.log('[seed]    Zonas horarias Cataluña: Matí-Tarda (<11h) / Tarda-Matí (11-19h)')
  console.log('[seed]    Nacional: resto península')
  console.log('[seed]    Solo Debidos: Mallorca / IBZ-Menorca / Formentera')
})

insertAll()
