function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS provincias (
      cp_prefix TEXT PRIMARY KEY,
      nombre    TEXT NOT NULL,
      baremo    INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS agencias (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre              TEXT NOT NULL,
      ambito              TEXT NOT NULL DEFAULT 'Nacional',
      baremo              INTEGER NOT NULL DEFAULT 1,
      recargo_combustible REAL NOT NULL DEFAULT 0,
      recargo_seguro      REAL NOT NULL DEFAULT 0,
      logo_path           TEXT,
      activa              INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS zonas_agencia (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      agencia_id     INTEGER NOT NULL,
      nombre_zona    TEXT NOT NULL,
      kg_adicional   REAL NOT NULL DEFAULT 0,
      solo_debidos   INTEGER NOT NULL DEFAULT 0,
      multiple_zones INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (agencia_id) REFERENCES agencias(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS zonas_provincias (
      agencia_id INTEGER NOT NULL,
      zona_id    INTEGER NOT NULL,
      cp_prefix  TEXT NOT NULL,
      PRIMARY KEY (agencia_id, zona_id, cp_prefix),
      FOREIGN KEY (agencia_id) REFERENCES agencias(id) ON DELETE CASCADE,
      FOREIGN KEY (zona_id)    REFERENCES zonas_agencia(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tarifas_agencia (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      agencia_id      INTEGER NOT NULL,
      zona_id         INTEGER NOT NULL,
      kilos_desde     REAL NOT NULL,
      kilos_hasta     REAL NOT NULL,
      precio_base     REAL NOT NULL,
      es_por_tonelada INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (agencia_id) REFERENCES agencias(id) ON DELETE CASCADE,
      FOREIGN KEY (zona_id)    REFERENCES zonas_agencia(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS tarifas_kg_adicional (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      zona_id    INTEGER NOT NULL,
      kg_desde   REAL NOT NULL,
      kg_hasta   REAL,
      precio_kg  REAL NOT NULL,
      FOREIGN KEY (zona_id) REFERENCES zonas_agencia(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recargos_agencia (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      agencia_id        INTEGER NOT NULL,
      nombre            TEXT NOT NULL,
      es_porcentaje     INTEGER NOT NULL DEFAULT 1,
      valor             REAL NOT NULL,
      minimo_aplicable  REAL,
      sobre_total       INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (agencia_id) REFERENCES agencias(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cotizaciones (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha          TEXT NOT NULL DEFAULT (datetime('now')),
      largo_cm       REAL NOT NULL,
      ancho_cm       REAL NOT NULL,
      alto_cm        REAL NOT NULL,
      cp_prefix      TEXT NOT NULL,
      metros_cubicos REAL NOT NULL DEFAULT 0,
      peso           REAL NOT NULL DEFAULT 0,
      agencia_id     INTEGER,
      precio_final   REAL,
      precio_redondeado REAL,
      FOREIGN KEY (agencia_id) REFERENCES agencias(id)
    );
  `)

  // Add solo_debidos column to zonas_agencia if not exists
  const zonaCols = db.prepare("PRAGMA table_info(zonas_agencia)").all().map(c => c.name)
  if (!zonaCols.includes('solo_debidos')) {
    db.prepare('ALTER TABLE zonas_agencia ADD COLUMN solo_debidos INTEGER NOT NULL DEFAULT 0').run()
  }
  if (!zonaCols.includes('multiple_zones')) {
    db.prepare('ALTER TABLE zonas_agencia ADD COLUMN multiple_zones INTEGER NOT NULL DEFAULT 0').run()
  }

  // Add es_por_tonelada column to tarifas_agencia if not exists
  const tarifaCols = db.prepare("PRAGMA table_info(tarifas_agencia)").all().map(c => c.name)
  if (!tarifaCols.includes('es_por_tonelada')) {
    db.prepare('ALTER TABLE tarifas_agencia ADD COLUMN es_por_tonelada INTEGER NOT NULL DEFAULT 0').run()
  }

  // Create tarifas_kg_adicional if not exists (migration for existing DBs)
  db.exec(`
    CREATE TABLE IF NOT EXISTS tarifas_kg_adicional (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      zona_id    INTEGER NOT NULL,
      kg_desde   REAL NOT NULL,
      kg_hasta   REAL,
      precio_kg  REAL NOT NULL,
      FOREIGN KEY (zona_id) REFERENCES zonas_agencia(id) ON DELETE CASCADE
    )
  `)

  // Migrate zonas_provincias PK from (agencia_id, cp_prefix) to (agencia_id, zona_id, cp_prefix)
  // SQLite doesn't support ALTER TABLE for PK changes — we rename+recreate
  const zpInfo = db.prepare("PRAGMA table_info(zonas_provincias)").all()
  const zpPkCols = zpInfo.filter(c => c.pk > 0).map(c => c.name)
  const needsPkMigration = !zpPkCols.includes('zona_id')
  if (needsPkMigration) {
    db.prepare('ALTER TABLE zonas_provincias RENAME TO zonas_provincias_old').run()
    db.exec(`
      CREATE TABLE zonas_provincias (
        agencia_id INTEGER NOT NULL,
        zona_id    INTEGER NOT NULL,
        cp_prefix  TEXT NOT NULL,
        PRIMARY KEY (agencia_id, zona_id, cp_prefix),
        FOREIGN KEY (agencia_id) REFERENCES agencias(id) ON DELETE CASCADE,
        FOREIGN KEY (zona_id)    REFERENCES zonas_agencia(id) ON DELETE CASCADE
      )
    `)
    db.prepare('INSERT INTO zonas_provincias SELECT agencia_id, zona_id, cp_prefix FROM zonas_provincias_old').run()
    db.prepare('DROP TABLE zonas_provincias_old').run()
  }

  // Add peso column if not exists (migration for existing DBs)
  const cols = db.prepare("PRAGMA table_info(cotizaciones)").all().map(c => c.name)
  if (!cols.includes('peso')) {
    db.prepare('ALTER TABLE cotizaciones ADD COLUMN peso REAL NOT NULL DEFAULT 0').run()
  }
  if (!cols.includes('precio_redondeado')) {
    db.prepare('ALTER TABLE cotizaciones ADD COLUMN precio_redondeado REAL').run()
  }

  // Migración: CP 28 (Madrid) debe estar en zona Nacional, no Regional, en GLS Express
  const glsAgencia = db.prepare("SELECT id FROM agencias WHERE nombre = 'GLS Express'").get()
  if (glsAgencia) {
    const zonaRegional = db.prepare(
      "SELECT id FROM zonas_agencia WHERE agencia_id = ? AND nombre_zona = 'Regional'"
    ).get(glsAgencia.id)
    const zonaNacional = db.prepare(
      "SELECT id FROM zonas_agencia WHERE agencia_id = ? AND nombre_zona = 'Nacional'"
    ).get(glsAgencia.id)
    if (zonaRegional && zonaNacional) {
      const en28Regional = db.prepare(
        "SELECT 1 FROM zonas_provincias WHERE agencia_id=? AND zona_id=? AND cp_prefix='28'"
      ).get(glsAgencia.id, zonaRegional.id)
      if (en28Regional) {
        db.prepare(
          "DELETE FROM zonas_provincias WHERE agencia_id=? AND zona_id=? AND cp_prefix='28'"
        ).run(glsAgencia.id, zonaRegional.id)
        db.prepare(
          "INSERT OR REPLACE INTO zonas_provincias (agencia_id, zona_id, cp_prefix) VALUES (?,?,'28')"
        ).run(glsAgencia.id, zonaNacional.id)
        console.log('[migration] CP 28 (Madrid) movido de Regional a Nacional en GLS Express')
      }
    }
  }

  // Tabla para cotizaciones pendientes de elegir agencia (guardadas con Ctrl+N sin elegir)
  db.exec(`
    CREATE TABLE IF NOT EXISTS cotizaciones_pendientes (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha       TEXT NOT NULL DEFAULT (datetime('now')),
      cp_prefix   TEXT NOT NULL,
      bultos_json TEXT NOT NULL,
      resultados_json TEXT NOT NULL
    )
  `)

  // Tabla para medidas de parachoques por referencia
  // referencia es PK (único), medidas en cm (enteras, ya con el +5 aplicado en import)
  db.exec(`
    CREATE TABLE IF NOT EXISTS parachoques (
      referencia    TEXT PRIMARY KEY,
      largo_cm      INTEGER NOT NULL,
      ancho_cm      INTEGER NOT NULL,
      alto_cm       INTEGER NOT NULL,
      actualizado   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Tabla de clientes (código + razón social). El código es PK (texto para soportar prefijos/letras).
  db.exec(`
    CREATE TABLE IF NOT EXISTS clientes (
      codigo        TEXT PRIMARY KEY,
      razon_social  TEXT NOT NULL,
      actualizado   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Añadir columna cliente_codigo a cotizaciones si no existe (no rompe DB existentes)
  const cotCols = db.prepare("PRAGMA table_info(cotizaciones)").all().map(c => c.name)
  if (!cotCols.includes('cliente_codigo')) {
    db.prepare('ALTER TABLE cotizaciones ADD COLUMN cliente_codigo TEXT').run()
  }

  seedProvincias(db)
}

function seedProvincias(db) {
  const count = db.prepare('SELECT COUNT(*) as c FROM provincias').get()
  if (count.c > 0) return

  const insert = db.prepare('INSERT OR IGNORE INTO provincias (cp_prefix, nombre, baremo) VALUES (?, ?, ?)')
  const provincias = [
    ['01','Alava',1],['02','Albacete',1],['03','Alicante',1],
    ['04','Almeria',1],['05','Avila',1],['06','Badajoz',1],
    ['07','Baleares',1],['08','Barcelona',1],['09','Burgos',1],
    ['10','Caceres',1],['11','Cadiz',1],['12','Castellon',1],
    ['13','Ciudad Real',1],['14','Cordoba',1],['15','La Coruna',1],
    ['16','Cuenca',1],['17','Girona',1],['18','Granada',1],
    ['19','Guadalajara',1],['20','Guipuzcoa',1],['21','Huelva',1],
    ['22','Huesca',1],['23','Jaen',1],['24','Leon',1],
    ['25','Lleida',1],['26','La Rioja',1],['27','Lugo',1],
    ['28','Madrid',1],['29','Malaga',1],['30','Murcia',1],
    ['31','Navarra',1],['32','Orense',1],['33','Asturias',1],
    ['34','Palencia',1],['35','Las Palmas',1],['36','Pontevedra',1],
    ['37','Salamanca',1],['38','Santa Cruz de Tenerife',1],['39','Cantabria',1],
    ['40','Segovia',1],['41','Sevilla',1],['42','Soria',1],
    ['43','Tarragona',1],['44','Teruel',1],['45','Toledo',1],
    ['46','Valencia',1],['47','Valladolid',1],['48','Vizcaya',1],
    ['49','Zamora',1],['50','Zaragoza',1],['51','Ceuta',1],
    ['52','Melilla',1],['00','Portugal',1],
  ]

  const insertMany = db.transaction((rows) => {
    for (const row of rows) insert.run(...row)
  })
  insertMany(provincias)
}

module.exports = { runMigrations }
