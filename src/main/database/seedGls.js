const { getDb } = require('./connection')

const db = getDb()

const insertAll = db.transaction(() => {
  const existing = db.prepare("SELECT id FROM agencias WHERE nombre = 'GLS Express'").get()
  if (existing) {
    console.log('[seed] GLS Express ya existe, omitiendo...')
    return
  }

  // Crear agencia GLS con baremo 200 (valor por defecto, editable desde UI)
  const agencia = db.prepare(
    `INSERT INTO agencias (nombre, ambito, baremo, recargo_combustible, recargo_seguro, logo_path, activa)
     VALUES ('GLS Express', 'Nacional', 200, 0, 0, NULL, 1)`
  ).run()
  const agenciaId = agencia.lastInsertRowid
  console.log('[seed] Agencia GLS creada. ID:', agenciaId)

  // Zonas: Regional, Nacional, Portugal
  // GLS NO sirve: Baleares(07), Canarias(35,38), Ceuta(51), Melilla(52)
  const insertZona = db.prepare(
    'INSERT INTO zonas_agencia (agencia_id, nombre_zona, kg_adicional) VALUES (?, ?, ?)'
  )
  const zonaData = [
    { nombre: 'Regional',  kgAdicional: 0.40 },
    { nombre: 'Nacional',  kgAdicional: 0.49 },
    { nombre: 'Portugal',  kgAdicional: 0.50 },
  ]
  const zonaIds = {}
  for (const z of zonaData) {
    const res = insertZona.run(agenciaId, z.nombre, z.kgAdicional)
    zonaIds[z.nombre] = res.lastInsertRowid
  }

  // Mapping CP → zona según ámbito GLS
  // Regional: 08 Barcelona, 17 Girona, 25 Lleida, 28 Madrid, 43 Tarragona
  // Portugal: 00
  // Nacional: resto de la peninsula (excluidos Baleares, Canarias, Ceuta, Melilla)
  const cpMap = {
    'Regional': ['08', '17', '25', '28', '43'],
    'Portugal': ['00'],
    'Nacional': [
      '01','02','03','04','05','06','09','10','11','12','13','14','15',
      '16','18','19','20','21','22','23','24','26','27','29','30','31',
      '32','33','34','36','37','39','40','41','42','44','45','46',
      '47','48','49','50',
    ],
  }
  const insertCp = db.prepare(
    'INSERT OR REPLACE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?, ?, ?)'
  )
  for (const [zonaKey, cps] of Object.entries(cpMap)) {
    for (const cp of cps) insertCp.run(agenciaId, zonaIds[zonaKey], cp)
  }

  // Tarifas reales GLS (precio_base por tramo de kg)
  // Tramos: 0-1, 1-3, 3-5, 5-10, 10-15
  // Para >15kg se usa: precio_15kg + ceil(peso-15) * kg_adicional de la zona
  const insertTarifa = db.prepare(
    'INSERT INTO tarifas_agencia (agencia_id, zona_id, kilos_desde, kilos_hasta, precio_base) VALUES (?, ?, ?, ?, ?)'
  )
  const tarifas = {
    'Regional': [
      [0,  1,  3.78],
      [1,  3,  3.92],
      [3,  5,  4.26],
      [5,  10, 4.85],
      [10, 15, 6.51],
    ],
    'Nacional': [
      [0,  1,  4.62],
      [1,  3,  4.77],
      [3,  5,  5.25],
      [5,  10, 6.02],
      [10, 15, 7.77],
    ],
    'Portugal': [
      [0,  1,  5.27],
      [1,  3,  5.43],
      [3,  5,  5.97],
      [5,  10, 6.83],
      [10, 15, 8.80],
    ],
  }
  for (const [zonaKey, filas] of Object.entries(tarifas)) {
    for (const [desde, hasta, precio] of filas) {
      insertTarifa.run(agenciaId, zonaIds[zonaKey], desde, hasta, precio)
    }
  }

  console.log('[seed] ✅ GLS Express insertado correctamente.')
  console.log('[seed]    Zonas: Regional / Nacional / Portugal')
  console.log('[seed]    Sin cobertura: Baleares(07), Canarias(35,38), Ceuta(51), Melilla(52)')
})

insertAll()
