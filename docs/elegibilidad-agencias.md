# Elegibilidad de agencias (mercancía fuera de norma)

Las reglas de "fuera de norma" (GLS largo > 110 cm; Seur largo > 175 cm o L+A+H > 300 cm) existen **duplicadas**:

- Proceso principal: `src/main/services/elegibilidad.js` (`motivoFueraDeNorma`), usada por la orden de carga.
- Renderer: `src/renderer/js/components/formHandler.js:430-438`, que solo pinta el aviso en la tarjeta.

Si se cambia una, hay que cambiar la otra.

TODO: que el renderer use las mismas reglas, p. ej. exponiendo el motivo en los resultados de `calcularTarifas` (`motivoFueraDeNorma` por resultado) y quitando la copia de `formHandler.js`.
