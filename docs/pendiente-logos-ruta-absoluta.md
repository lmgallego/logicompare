# Pendiente: logos de agencia con ruta absoluta

Estado: **Pendiente** (detectado el 2026-10-26 al revisar v2.1.1). Sin arreglar.

## Problema

`saveLogoFile` (`src/main/services/agencyService.js`) copia el logo a
`userData/logos/agency_<id>.<ext>` y devuelve la **ruta absoluta**, que se guarda
tal cual en `agencias.logo_path` (p. ej. `C:\Users\luism\AppData\Roaming\LogiCompare\logos\agency_3.png`).
El renderer la pinta con `<img src="file://${logo_path}">` (`formHandler.js`,
`devidosView.js`, `databaseView.js`); si falla, el `onerror` muestra el icono genérico.

Al importar la BD en otro equipo:

- La ruta apunta al usuario y la carpeta del equipo de origen: no existe.
- Aunque el usuario coincida, `export-db` / `import-db` solo copian `logicompare.db`;
  la carpeta `logos/` no viaja. El equipo destino no tiene los ficheros.

Resultado: todas las agencias salen con el icono genérico. No rompe cálculos ni datos.

## Solución propuesta

1. **Guardar solo el nombre del fichero** (`agency_3.png`) en `logo_path`.
   `saveLogoFile` devuelve `destName` en lugar de `destPath`.
2. **Resolver al leer**, en main (un único sitio, p. ej. al devolver agencias desde
   `agencyRepository`/handlers): `path.join(app.getPath('userData'), 'logos', logo_path)`.
   El renderer no cambia.
3. **Migración idempotente** en `migrations.js` (registrada en `migraciones_aplicadas`):
   `logo_path = basename(logo_path)` para los valores que sean ruta absoluta.
   Tolera ambos separadores (`\` y `/`).

## Logos al importar la BD en otro equipo

El paso 1–3 hace que la ruta sea correcta en cualquier equipo, pero **no lleva los
ficheros**: en el destino seguirá saliendo el icono genérico hasta que exista
`userData/logos/agency_<id>.<ext>`. Opciones, de menos a más trabajo:

- Volver a subir los logos en el equipo destino (válido si son pocas agencias).
- `export-db` copia también `logos/` junto al `.db` (carpeta o zip) e `import-db` la restaura.
- Guardar el logo dentro de la BD (BLOB o data URL en `agencias`): viaja con el `.db`
  sin tocar export/import. Es la opción más robusta si se quiere que importar la BD
  baste para tenerlo todo.

Ojo: el nombre lleva el `id` de la agencia; entre BDs distintas el mismo id puede ser
otra agencia, así que copiar `logos/` solo es fiable junto con su propia BD.
