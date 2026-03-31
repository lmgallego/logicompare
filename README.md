# LogiCompare

Aplicación de escritorio para calcular y comparar tarifas logísticas entre agencias de transporte.

## Stack

- **Electron 29** — app de escritorio
- **Vite 5** — bundler del renderer
- **Tailwind CSS 3** — estilos (Design System "Industrial Precisionist")
- **better-sqlite3** — base de datos local SQLite
- **Material Symbols Outlined** — iconos

## Requisitos previos

- Node.js ≥ 18
- npm

> **Windows**: `better-sqlite3` necesita compilación nativa. Si no tienes Visual Studio Build Tools, ejecuta `npx electron-rebuild -f -w better-sqlite3` después de instalar.

## Desarrollo

```bash
# Instalar dependencias
npm install

# Lanzar en modo desarrollo (Vite + Electron en paralelo)
npm start
```

> Esto arranca el servidor Vite en `http://localhost:5173` y luego lanza Electron apuntando a esa URL.

## Estructura del proyecto

```
src/
  main/                     # Proceso principal Electron (Node.js / CommonJS)
    main.js                 # Punto de entrada, crea BrowserWindow
    preload.js              # Puente IPC seguro → window.api
    database/
      connection.js         # Singleton better-sqlite3
      migrations.js         # DDL tablas + seed provincias
    repositories/           # Acceso a datos (CRUD)
      agencyRepository.js
      provinciaRepository.js
      rateRepository.js
      surchargeRepository.js
      zoneRepository.js
    services/               # Lógica de negocio
      calculationService.js # Cálculo volumétrico, zonificación, recargos
      agencyService.js      # CRUD agencias + gestión logos
    ipcHandlers/            # Escuchan eventos del renderer
      quoteHandler.js       # calcular-tarifas, get-history
      agencyHandler.js      # CRUD agencias
      provinceHandler.js    # get-provincias
      windowHandler.js      # minimize/maximize/close
  renderer/                 # Proceso renderer (HTML/CSS/JS)
    index.html
    css/
      main.css              # Tailwind + componentes custom
    js/
      app.js                # Inicializador
      components/
        formHandler.js      # Formulario cotización + render resultados
        sidebar.js          # Navegación
        historyView.js      # Tabla historial
        databaseView.js     # CRUD agencias UI
      utils/
        formatters.js       # formatPrice, formatWeight, formatDate
```

## Base de datos

La DB SQLite se guarda en el directorio `userData` de Electron:
- **Windows**: `%APPDATA%\logicompare\logicompare.db`

### Tablas principales

| Tabla | Descripción |
|---|---|
| `provincias` | 52 CPs (seed automático) |
| `agencias` | Agencias de transporte |
| `zonas_agencia` | Zonas por agencia |
| `zonas_provincias` | Mapeo CP → zona |
| `tarifas_agencia` | Tramos de peso y precio base |
| `recargos_agencia` | Recargos (% o fijo) por agencia |
| `cotizaciones` | Historial de cálculos |

## Flujo de cálculo

1. Usuario introduce **Largo × Ancho × Alto (cm)** + **CP** + peso real opcional
2. Motor calcula **peso volumétrico** = L×A×A / 250
3. **Peso tasable** = max(peso_real, peso_volumétrico)
4. Para cada agencia activa: busca zona por CP → tarifa por peso → aplica recargos
5. Resultados ordenados por precio ascendente

## Añadir una nueva agencia

1. Ir a **Database** en el sidebar
2. Clic en **Nueva Agencia** → rellenar nombre, ámbito, logo
3. Desde la BD SQLite, insertar zonas, mapeos CP→zona y tramos de tarifa

## Build de producción

```bash
npm run build
```

Genera el instalador en `/dist`.
