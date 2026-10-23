# LogiCompare — contexto del proyecto

App de escritorio (Electron) para calcular y comparar tarifas de agencias de transporte a partir de medidas de bultos y código postal. Todo local, sin backend. UI en español.

## Stack

Electron 29 (CommonJS en `src/main`) · Vite 5 + JS ESM vanilla en `src/renderer` · Tailwind 3 · better-sqlite3 (síncrono) · xlsx (import/export) · chart.js (analytics). Empaquetado con electron-builder (NSIS, Windows).

## Comandos

```bash
npm start          # Vite (5173) + Electron en dev, concurrently
npm run build      # vite build + electron-builder -> release/
npm run seed:gls   # seeds: gls | logistica | dhl | seur | transhaer | transabadell
```

`postinstall` ejecuta `electron-rebuild -f -w better-sqlite3`. Si falla el arranque nativo, relanzarlo a mano.

## Arquitectura

```
src/main/                 proceso principal (CommonJS)
  main.js                 arranque, splash, first-run import DB, import/export-db, registro de handlers
  preload.js              contextBridge -> window.api = { invoke, on, send }
  database/connection.js  singleton better-sqlite3 en app.getPath('userData')/logicompare.db
  database/migrations.js  esquema + migraciones idempotentes + seed de provincias
  database/seed*.js       carga de tarifas por agencia desde csv/
  repositories/           SQL puro (agency, provincia, rate, surcharge, zone)
  services/               calculationService (motor de cálculo), agencyService
  ipcHandlers/            un fichero por dominio; se auto-registran al requerirse en main.js
src/renderer/             ESM, sin framework
  index.html              todas las páginas en el mismo HTML, se alternan con clase .active
  js/app.js               router por páginas (PAGES[]), atajos Ctrl+N, toasts
  js/components/*View.js  una vista por página
  js/utils/               modals.js (modales genéricos), formatters.js
csv/                      fuentes de datos (xlsx/csv/json) para seeds e imports
```

Flujo típico: vista renderer → `window.api.invoke('canal', datos)` → handler en `ipcHandlers/` → repository/service → SQLite.

Añadir una página nueva = entrada en `PAGES` de `app.js` + `<div id="page-X">` en `index.html` + item en `sidebar.js` + `components/xView.js` + handler en main + `require` en `main.js`.

## Modelo de datos (SQLite)

- `provincias` (cp_prefix 2 dígitos, PK) — seed fijo de 52 provincias + `00` Portugal.
- `agencias` → `zonas_agencia` → `zonas_provincias` (qué CPs cubre cada zona) y `tarifas_agencia` (bandas kilos_desde/hasta → precio_base).
- `tarifas_kg_adicional`: bandas de kg extra por zona (estilo Transhaer). Si no existen, se usa `zonas_agencia.kg_adicional` plano.
- `recargos_agencia` existe pero el cálculo actual usa los campos `recargo_combustible` / `recargo_seguro` de `agencias`.
- `cotizaciones` (historial) y `cotizaciones_pendientes` (guardadas sin elegir agencia).
- `clientes`, `cajas` (medidas estándar, 6 filas base sembradas), `parachoques` y `cospel` (legacy), `medidas_elmer` (tabla unificada que sustituye a las dos anteriores).

Las migraciones son idempotentes y se ejecutan en cada arranque: `CREATE TABLE IF NOT EXISTS`, `PRAGMA table_info` + `ALTER TABLE` para columnas nuevas. Nunca romper DBs existentes: los usuarios importan/exportan el `.db` entre equipos.

## Motor de cálculo (`services/calculationService.js`)

1. m³ = largo×ancho×alto×1e-6, 3 decimales; con varios bultos se **suman los m³** y se calcula **un solo peso**.
2. peso tasable = `max(1, ceil(m³ × agencia.baremo))`.
3. banda de tarifa por peso; si el peso supera todas las bandas se usa la banda máxima + kg extra (bandas de `tarifas_kg_adicional` o `kg_adicional` plano). `es_por_tonelada` → precio × peso/1000.
4. recargos: combustible (%) y seguro (%, mínimo 0,90 €). Todo redondeado a 2 decimales.
5. resultados ordenados por precio, nulos al final.

Reglas de negocio particulares:
- Zonas con `solo_debidos = 1` se excluyen de Pagados.
- `multiple_zones`: un CP puede devolver varias zonas (ej. sub-islas de Baleares en Transhaer) y genera un resultado por zona.
- Agencia "Logística" en CPs catalanes (08/17/25/43): `Matí-Tarda` antes de las 11:00, `Tarda-Matí` de 11:00 a 19:00 — depende de la hora del sistema.
- Restricciones de dimensiones se exponen como `maxLargoCm` y `maxSumaDimCm` para que el renderer avise (GLS largo > 110, Seur suma ≤ 300).

## Convenciones

- Español en UI, comentarios, nombres de tabla y columnas; código en camelCase, columnas en snake_case.
- Main = CommonJS (`require`), renderer = ESM (`import`). No mezclar.
- Todo acceso a datos desde el renderer pasa por `window.api.invoke`; no hay nodeIntegration.
- Los handlers usan `ipcMain.removeHandler(...)` antes de `handle(...)` para tolerar recargas.
- Los importadores xlsx viven en su handler correspondiente, no en el renderer.
- No hay tests ni linter configurados.
