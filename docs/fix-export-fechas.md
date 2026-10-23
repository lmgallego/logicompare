# Bug: exportar historial por rango de fechas no incluye todo

Estado: **pendiente**. Diagnóstico hecho el 2026-08-05, sin aplicar cambios.
Rama en la que se detectó: `feature/medidas-unificadas`.

## Síntoma

Filtrar el historial del primer al último día del mes y exportar a Excel o PDF
no saca todos los registros del rango.

## Cadena afectada

Las exportaciones **no consultan la base de datos**. `buildXLSX` y `buildPDF`
(`src/renderer/js/components/historyView.js`) trabajan sobre `currentRows`, el
array que dejó el último `loadHistory`. Todo defecto de `get-history` se
propaga tal cual al fichero exportado.

```
historyView.js (filtros) -> get-history (quoteHandler.js:39) -> tabla cotizaciones
                         -> currentRows -> buildXLSX / buildPDF
```

## Causas

### 1. Desfase UTC en los bordes del rango  (principal con poco volumen)

- Inserción: `cotizaciones.fecha DEFAULT (datetime('now'))` (`migrations.js:73`) = **UTC**.
- Filtro: `date(c.fecha) >= date(?)` (`quoteHandler.js:42-43`) compara ese UTC.
- Pantalla y export: `formatDate` (`formatters.js:41`) hace `new Date(iso + 'Z')`
  y lo pasa a **hora local**.

En España (UTC+1/+2) una cotización creada el **día 1 a las 00:30 local** se
guardó como día 30/31 del mes anterior en UTC: el filtro `desde = 2026-08-01`
la excluye aunque la app la muestre con fecha 01/08. Simétricamente, las
primeras horas del día 1 del mes siguiente sí entran. Ventana afectada: las 1-2
primeras horas de cada día, en los extremos del filtro.

Agravante de coherencia: `save-quote-manual` guarda `fecha + ' 12:00:00'`
(`app.js:149`) como si fuera UTC y luego se pinta a las 14:00. Manuales y
automáticas no viven en el mismo huso.

### 2. `LIMIT 500` fijo  (principal con mucho volumen)

`quoteHandler.js:46`:

```
... ORDER BY c.fecha DESC LIMIT 500
```

Un mes con más de 500 cotizaciones exporta 500. Por el `ORDER BY fecha DESC`
las que se caen son **las más antiguas del rango**: el Excel empieza a mitad de
mes. Sin aviso en pantalla ni en el fichero.

Comprobación rápida: si el Excel tiene exactamente 500 filas, es esto.

### 3. Se exporta el filtro anterior, no el visible

`initHistoryControls:207` solo recarga al pulsar **Filtrar**. Los `input` de
fecha no tienen listener de `change`. Cambiar las fechas y pulsar directamente
Exportar saca el rango viejo: `currentRows` no se ha tocado. El modal de export
tampoco dice qué rango va a exportar.

### 4. Nombres de hoja XLSX sin deduplicar

`historyView.js:312` recorta el nombre a 31 caracteres sin comprobar
duplicados. Dos agencias con los mismos 31 primeros caracteres generan hojas
homónimas y Excel rechaza o "repara" el fichero — se percibe como export
incompleto.

Aparte, `normalizeAgencia` (`historyView.js:7-10`) borra los sufijos
`(Palet)`/`(Bulto)`, así que "SEUR (Palet)" y "SEUR (Bulto)" acaban en la misma
hoja. Verificar si es intencional; si no, es pérdida de detalle que no ocurre
en la tabla de pantalla.

### 5. `window.open` sin guard en el PDF

`buildPDF:371` no comprueba que `win` sea válido. Si Electron bloquea la
ventana emergente, `win.document.write` lanza y no sale nada ni ningún mensaje.

## Solución propuesta

### 1. UTC -> local en el filtro, no en el almacenamiento

Los datos ya están en UTC y `formatDate` ya los pinta en local. Lo incoherente
es el `WHERE`. Alinear el filtro con lo que ve el usuario; no reescribir la
columna `fecha` de las DBs existentes.

`quoteHandler.js:42-43`:

```js
if (desde) { conds.push("date(c.fecha,'localtime') >= date(?)"); params.push(desde) }
if (hasta) { conds.push("date(c.fecha,'localtime') <= date(?)"); params.push(hasta) }
```

Misma sustitución en los gemelos:
- `get-quotes-by-cliente` — `quoteHandler.js:110-111`
- `delete-history` — `quoteHandler.js:222-230`

**`delete-history` va en el mismo commit, obligatorio.** Si el filtro
selecciona en local y el borrado en UTC, "borrar lo que estoy viendo" borra un
rango desplazado. Ese es el riesgo real de arreglar solo la mitad.

Los `date('now', ...)` de analytics (`quoteHandler.js:259-344`) tienen el mismo
sesgo, pero son ventanas móviles de 30 días y no son el síntoma reportado.
Aplicar `'localtime'` ahí también por coherencia, secundario.

### 2. Quitar el `LIMIT 500` cuando hay filtro de fechas

`quoteHandler.js:46`:

```js
const limit = (desde || hasta) ? '' : ' LIMIT 500'
const sql = `SELECT ... ${where} ORDER BY c.fecha DESC${limit}`
```

El límite existe para que "ver todo sin filtro" no cargue la tabla entera. Con
un rango acotado ese motivo desaparece.

### 3. Los inputs de fecha recargan al cambiar

En `initHistoryControls`, junto a los listeners existentes:

```js
inputDesde?.addEventListener('change', () => { const f = getFilters(); loadHistory(f.desde, f.hasta, f.agenciaId) })
inputHasta?.addEventListener('change', () => { const f = getFilters(); loadHistory(f.desde, f.hasta, f.agenciaId) })
```

Complemento barato: en `openExportModal`, poner el rango en el título del modal
(`Exportar a Excel · 01/08/2026 – 31/08/2026 · 342 filas`). El usuario ve qué se
lleva antes de confirmar.

### 4. Nombres de hoja únicos

`historyView.js:312`:

```js
const used = new Set()
// dentro del forEach:
let sheetName = agName.replace(/[\\/*?:\[\]]/g, '').slice(0, 31) || 'Hoja'
while (used.has(sheetName)) sheetName = sheetName.slice(0, 28) + '_' + idx
used.add(sheetName)
```

### 5. Guard en el PDF

`buildPDF:371`:

```js
const win = window.open('', '_blank', 'width=900,height=700')
if (!win) { alertModal('No se pudo abrir la ventana de impresión.', 'Error'); return }
```

## Verificación

Un solo check, para el punto 1 (el que toca importes). Requiere TZ del sistema
en `Europe/Madrid`, que es el entorno real de la app.

```js
// test-fechas.js — node test-fechas.js
const Database = require('better-sqlite3')
const db = new Database(':memory:')
db.exec("CREATE TABLE cotizaciones (id INTEGER PRIMARY KEY, fecha TEXT)")
// 01/08 00:30 hora local española (verano) == 31/07 22:30 UTC
db.prepare("INSERT INTO cotizaciones (fecha) VALUES ('2026-07-31 22:30:00')").run()
const n = db.prepare("SELECT COUNT(*) c FROM cotizaciones WHERE date(fecha,'localtime') >= date('2026-08-01')").get().c
console.assert(n === 1, 'la cotización de las 00:30 del día 1 debe entrar en el rango del mes')
console.log('ok')
```

Falla con el `WHERE` actual, pasa con el corregido.

## Descartado

Reescribir `fecha` a hora local con una migración. Toca todas las filas de
todas las DBs instaladas, y los usuarios importan/exportan `.db` entre equipos:
una DB migrada conviviendo con otra sin migrar es peor bug que el actual.
