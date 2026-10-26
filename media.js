/** Decode locally and rasterize once, so project files never reference external URLs. */
export async function importImage(file) {
  if (!/^image\/(png|jpeg|webp|gif|bmp|avif)$/i.test(file.type)) throw new Error('Elige una imagen PNG, JPG, WebP, GIF, BMP o AVIF.');
  if (file.size > 25_000_000) throw new Error('La imagen supera los 25 MB. Usa una copia de menor tamaño.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const naturalWidth = image.naturalWidth, naturalHeight = image.naturalHeight;
    if (!naturalWidth || !naturalHeight || naturalWidth * naturalHeight > 32_000_000 || Math.max(naturalWidth, naturalHeight) > 32000) throw new Error('La imagen supera la resolución admitida (32 millones de píxeles).');
    const canvas = document.createElement('canvas'); canvas.width = naturalWidth; canvas.height = naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    const src = canvas.toDataURL(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.95);
    if (src.length > 40_000_000) throw new Error('La imagen decodificada es demasiado grande. Usa una copia de menor tamaño.');
    return { src, name: (file.name || 'Imagen del portapapeles').slice(0, 200), naturalWidth, naturalHeight };
  } catch (error) {
    if (error.name === 'EncodingError') throw new Error('No se ha podido leer la imagen. Prueba con un archivo PNG o JPG.');
    throw error;
  } finally { URL.revokeObjectURL(url); }
}

export async function verifyProjectImages(doc) {
  const elements = doc.pages ? doc.pages.flatMap(page => page.elements) : doc.elements;
  // Decode sequentially to bound memory when opening documents with many pages.
  for (const element of elements.filter(element => element.type === 'image')) {
    for (const src of new Set([element.src, element.originalSrc, element.edgeBaseSrc].filter(Boolean))) {
      const image = new Image(); image.src = src;
      try { await image.decode(); } catch { throw new Error(`No se puede leer la imagen «${element.name}» del proyecto.`); }
      if (image.naturalWidth !== element.naturalWidth || image.naturalHeight !== element.naturalHeight) throw new Error(`Las dimensiones de «${element.name}» no coinciden con la imagen guardada.`);
    }
  }
}
