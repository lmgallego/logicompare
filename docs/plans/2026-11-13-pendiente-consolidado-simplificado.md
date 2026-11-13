# Pendiente: consolidar Excel simplificados (Soporte)

Estado: pendiente para una versión posterior a v2.2.0.

## Problema

El Excel simplificado del historial solo trae Fecha, Cliente, Destinatario, precios, Bultos y
"Pesos por bulto": no lleva Agencia, Medidas, CP ni Peso. Al consolidarlo en Soporte:

- **Duplicados:** la clave de duplicado es fecha + agencia + precio + medidas + CP. Una cotización
  que viene en un Excel completo y en uno simplificado no coincide (medidas y CP vacíos en el
  simplificado), así que sale dos veces.
- **Peso 0:** las filas del simplificado salen con "Peso (kg)" = 0, "Metros Cúbicos" = 0 y
  medidas y CP vacíos en el consolidado completo.

Desde v2.2.0 la agencia se toma del nombre real de la hoja y la pantalla avisa al mezclar
simplificados ("Los Excel simplificados no se pueden cruzar con los completos…").

## Opciones a valorar

1. Añadir al Excel simplificado columnas ocultas o una hoja técnica con medidas, CP y peso
   (cambia el formato del simplificado).
2. Clave de duplicado relajada cuando una de las filas viene de un simplificado
   (fecha + agencia + precio): riesgo de fundir dos cotizaciones distintas del mismo minuto.
3. No admitir simplificados en el consolidado.

Comprobado en la app con el botón el 2026-11-13: completo nuevo + completo v2.1.3 = 10 filas;
añadiendo el simplificado = 20 (cada cotización repetida, la del simplificado sin peso).
