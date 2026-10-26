# Componentes y licencias de terceros

El código propio y la ilustración de prueba `tests/fixtures/bear.svg` se distribuyen bajo MIT (ver `LICENSE`). Las dependencias y los modelos conservan sus propias licencias. Las tipografías se obtienen del sistema del usuario; no se distribuyen archivos de Comic Sans MS ni otras fuentes comerciales.

## PDF-Lib 1.17.1

Andrew Dillon y colaboradores. Licencia MIT, copia en `licenses/PDFLib-MIT.txt`.

- Fuente: https://github.com/Hopding/pdf-lib
- Versión fijada en `package-lock.json`. El módulo incluido en el paquete se sirve localmente como `/vendor/pdf-lib.esm.min.js`; no se utiliza CDN ni servicio de conversión.
- Canvnail compone el PDF a partir de imágenes PNG de cada página, conservando la apariencia, el orden y las dimensiones A4. El contenido editable se conserva en el proyecto Canvnail; el PDF no incluye texto seleccionable.

## ONNX Runtime Web 1.22.0

Microsoft Corporation. Licencia MIT, copia en `licenses/ONNXRuntime-MIT.txt`.
Distribución fijada en `package-lock.json`; los archivos JavaScript y WebAssembly se sirven desde el paquete instalado, sin usar un CDN.

- Fuente: https://github.com/microsoft/onnxruntime/tree/v1.22.0
- Avisos de terceros del proyecto: copia en `licenses/ONNXRuntime-ThirdPartyNotices.txt`, obtenida de https://github.com/microsoft/onnxruntime/blob/v1.22.0/ThirdPartyNotices.txt.

## U²-Net pequeño (U2NETP)

Xuebin Qin y colaboradores. Repositorio original bajo Apache-2.0, copia en `licenses/U2NET-Apache-2.0.txt`.

- Arquitectura y modelo: https://github.com/xuebinqin/U-2-Net
- Conversión ONNX distribuida por rembg: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
- Integridad de origen: MD5 `8e83ca70e441ab06c318d82300c84806`, publicado en `rembg/sessions/u2netp.py`.
- SHA-256 y tamaño de la copia instalada: `models/manifest.json`. La instalación exige que el SHA-256 coincida con el valor fijado en el código, tanto para este modelo como para U2NET completo.

La entrada sigue la normalización RGB/NCHW usada por U²-Net/rembg. Canvnail implementa la preparación, el reescalado de máscara y la composición alfa en JavaScript. No incluye ni ejecuta el paquete Python rembg.

## U²-Net completo (U2NET)

Mismos autores y licencia Apache-2.0 que el modelo pequeño; se usa para el modo Mayor calidad. La sesión anterior se libera al cambiar de modelo.

- Conversión ONNX distribuida por rembg: https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx
- Integridad de origen: MD5 `60024c5c889badc19c04ad937298a77b`, publicado en https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net.py.
- SHA-256: `8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491`.
- Tamaño: 175 997 641 bytes. Manifest instalado: `models/manifest-quality.json`.

### Comprobación de las licencias de los modelos (26 de octubre de 2026)

El autor Xuebin Qin confirmó expresamente que el código y los modelos publicados en U²-Net comparten licencia (Apache-2.0): https://github.com/xuebinqin/U-2-Net/issues/208#issuecomment-847883906. Por tanto, la atribución Apache-2.0 no se deduce únicamente de la licencia del código. La licencia permite reproducción y distribución conservando su texto y los avisos aplicables; los archivos modificados deben indicar sus cambios. Canvnail descarga las conversiones ONNX de rembg sin modificarlas, conserva su procedencia y verifica sus hashes. Los pesos no se incluyen en el repositorio ni quedan relicenciados bajo la MIT de Canvnail.

Las direcciones y los MD5 de ambos archivos coinciden con las sesiones oficiales de rembg:

- https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2net.py
- https://github.com/danielgatis/rembg/blob/main/rembg/sessions/u2netp.py

Existe una reserva expresa del autor respecto a los derechos de los datos de entrenamiento, que no controla. Confirmó que ambos modelos se entrenaron con DUTS: https://github.com/xuebinqin/U-2-Net/issues/208#issuecomment-848093240. La web original de DUTS reserva los derechos de las anotaciones y explica que las imágenes proceden de ImageNet y SUN: https://saliencydetection.net/duts/. No se ha encontrado allí una autorización explícita que resuelva el alcance de esos derechos sobre los pesos entrenados. Esto no demuestra que usar o compartir los modelos infrinja derechos, ni convierte automáticamente los pesos en un recurso de uso no comercial; impide garantizar ausencia absoluta de reclamaciones de terceros. Canvnail no distribuye imágenes ni anotaciones de DUTS.

Conclusión de esta revisión documental: el permiso del autor de los modelos bajo Apache-2.0 respalda compartir Canvnail con la integración actual y sus avisos. No constituye una autorización de los titulares de los datos de entrenamiento ni una garantía jurídica general. No debe presentarse la licencia MIT del editor como permiso sobre esos datos.

Los controles de borde son código propio: morfología separable (mínimo/máximo), suavizado mediante dos pasadas de filtro de caja separable y contraste de máscara. Se aplican a resolución original y respetan el alfa del original. No añaden dependencias ni servicios externos.

## Herramientas de desarrollo

Playwright se instala como dependencia de desarrollo, bajo Apache-2.0. Su licencia y avisos se conservan en el paquete instalado (`node_modules/playwright/LICENSE` y `NOTICE`, y los de `playwright-core`). Fuente: https://github.com/microsoft/playwright.

La antigua fotografía del caballo de U²-Net no forma parte de la distribución. Las pruebas utilizan una ilustración SVG original del proyecto, sin fotografías ni capturas de Canva. Comprobar la segmentación de esa ilustración no mide la precisión del modelo sobre fotografías reales.
