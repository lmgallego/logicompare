# Product Requirements Document (PRD): LogiCompare Desktop App

## 1. Visión General del Proyecto
LogiCompare es una aplicación de escritorio local diseñada para calcular, comparar y gestionar tarifas de envíos logísticos (paquetería) entre diferentes agencias de transporte (empezando por GLS). La aplicación permitirá introducir las dimensiones físicas y el destino de un paquete, calculando el peso volumétrico y devolviendo el precio final aplicando los recargos y márgenes correspondientes de cada agencia.

## 2. Stack Tecnológico
* **Framework de Escritorio:** Electron (con Node.js).
* **Frontend:** HTML5, JavaScript (o TypeScript) modular.
* **Estilos:** Tailwind CSS (vía Vite o CLI).
* **Base de Datos Local:** SQLite (usando la librería `better-sqlite3`).
* **Iconos:** Lucide Icons o Heroicons.
* **Tipografía:** Roboto (Google Fonts).

## 3. UI/UX y Sistema de Diseño
El diseño debe ser ultra-moderno, limpio y de aspecto industrial/profesional, basado estrictamente en el Design System proporcionado.

### 3.1. Paleta de Colores (Tailwind Config)
* **Primary:** `#2E5BFF` (Azul eléctrico para botones principales y acentos).
* **Secondary:** `#546E7A` (Gris azulado oscuro para textos secundarios e iconos).
* **Tertiary:** `#B0BEC5` (Gris claro para bordes y divisores).
* **Neutral/Background:** `#F1F5F9` (Gris muy claro/Off-white para el fondo de la aplicación).
* **Surface/Cards:** `#FFFFFF` (Blanco puro para las tarjetas de resultados y paneles).

### 3.2. Estructura de la Interfaz (Layout Principal)
1.  **Sidebar Izquierdo (Menu Colapsable):** Logo, Perfil, Navegación (New Quote, History, Address Book, Analytics, Support, Database Maintenance), Logout.
2.  **Panel Central - Izquierda (Entrada de Datos):** Inputs (Largo, Ancho, Alto, CP 2 dígitos) y Botón de Calcular.
3.  **Panel Central - Derecha (Resultados):** Tarjetas de agencias con desglose de precios y widgets de métricas.

## 4. Estructura de Base de Datos (SQLite)
* **`provincias`**: `cp_prefix` (PK), `nombre`.
* **`agencias`**: `id` (PK), `nombre`, `ambito`, `logo_path`, `activa`.
* **`zonas_agencia`**: `id` (PK), `agencia_id` (FK), `nombre_zona`.
* **`zonas_provincias`**: `agencia_id` (FK), `zona_id` (FK), `cp_prefix` (FK).
* **`tarifas_agencia`**: `id` (PK), `agencia_id` (FK), `zona_id` (FK), `kilos_desde`, `kilos_hasta`, `precio_base`.
* **`recargos_agencia`**: `id` (PK), `agencia_id` (FK), `nombre`, `es_porcentaje`, `valor`, `minimo_aplicable`, `sobre_total`.

## 5. Requisitos Funcionales y Lógica de Negocio
1.  **Cálculo Volumétrico:** Volumen en $m^3$ y "Peso Tasable" según factor de conversión.
2.  **Zonificación:** Búsqueda de zona mediante CP en `zonas_provincias`.
3.  **Cotización:** Búsqueda del `precio_base` en `tarifas_agencia` según Peso Tasable y Zona.
4.  **Recargos:** Aplicación de porcentajes o fijos (combustible, seguro).
5.  **Mantenimiento de BD:** CRUD de agencias y subida de logos al directorio `userData` de Electron.

## 6. Arquitectura de Software y Buenas Prácticas (CRÍTICO)
El proyecto **NO** debe ser un monolito en un solo archivo. Debe seguir una arquitectura en capas (Layered Architecture) y aplicar principios SOLID para garantizar el mantenimiento a largo plazo.

### 6.1. Principios SOLID a Aplicar
* **Single Responsibility Principle (SRP):** Separar claramente la lógica de acceso a datos (Repositories), la lógica de negocio/cálculo logístico (Services) y la interfaz de usuario (Controllers/Renderers).
* **Open/Closed Principle (OCP):** El motor de cálculo debe estar diseñado para que añadir una nueva agencia con reglas de recargos distintas no implique modificar el código central del motor, sino añadir nuevas configuraciones en base de datos o implementar nuevas estrategias si fuera estrictamente necesario.

### 6.2. Patrones de Diseño y Comunicación (Electron)
* Usar estrictamente **Context Isolation** y **`preload.js`** para la comunicación entre el Renderer (Frontend) y el Main Process (Backend local).
* El Frontend no debe acceder a SQLite directamente. Debe llamar a través de `window.api.invoke('calcular-tarifas', datos)`.

### 6.3. Estructura de Carpetas Exigida
El proyecto debe organizarse en módulos claros:

```text
/src
  /main                 # Proceso Principal de Electron (Node.js)
    main.js             # Punto de entrada de Electron (creación de ventana)
    preload.js          # Puente de seguridad IPC (Inter-Process Communication)
    /ipcHandlers        # Controladores que escuchan los eventos del frontend
    /services           # LÓGICA DE NEGOCIO (Ej: calculationService.js)
    /repositories       # ACCESO A DATOS (Ej: agencyRepository.js, rateRepository.js)
    /database           # Configuración de better-sqlite3 y migraciones
  /renderer             # Proceso de Renderizado (Frontend HTML/JS/CSS)
    index.html          # Interfaz principal
    /css                # Archivos Tailwind / estilos globales
    /js
      /components       # Módulos JS para la UI (Ej: sidebar.js, formHandler.js)
      /utils            # Funciones auxiliares de formateo (moneda, fechas)
      app.js            # Inicializador del frontend