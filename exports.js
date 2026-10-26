export const EXPORT_FORMATS = {
  png: { mime: 'image/png', label: 'PNG', extension: '.png' },
  jpg: { mime: 'image/jpeg', label: 'JPG', extension: '.jpg' },
  pdf: { mime: 'application/pdf', label: 'PDF', extension: '.pdf' },
};
export async function chooseSaveTarget(name, mime, extension) {
  if (typeof window.showSaveFilePicker !== 'function' || !window.isSecureContext) return null;
  try {
    return await window.showSaveFilePicker({ startIn: 'downloads', suggestedName: name,
      types: [{ description: extension.slice(1).toUpperCase(), accept: { [mime]: [extension] } }], excludeAcceptAllOption: true });
  } catch (error) {
    if (['SecurityError', 'NotAllowedError'].includes(error.name)) return null;
    throw error;
  }
}
export async function saveBlob(blob, name, handle = null) {
  if (handle) {
    const stream = await handle.createWritable();
    try { await stream.write(blob); await stream.close(); } catch (error) { try { await stream.abort(); } catch {} throw error; }
  } else {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
export const pdfPageSize = page => page.width === 2480 && page.height === 3508 ? [210 / 25.4 * 72, 297 / 25.4 * 72]
  : page.width === 3508 && page.height === 2480 ? [297 / 25.4 * 72, 210 / 25.4 * 72] : [page.width * .75, page.height * .75];
export async function buildPDF(pages, render, name, progress = () => {}) {
  const { PDFDocument } = await import('/vendor/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.create(); pdf.setTitle(name); pdf.setCreator('Canvnail');
  for (let i = 0; i < pages.length; i++) {
    progress(i + 1, pages.length);
    const canvas = await render(pages[i], true);
    try {
      const bytes = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!bytes) throw new Error('No se ha podido preparar una página.');
      const image = await pdf.embedPng(await bytes.arrayBuffer()), [width, height] = pdfPageSize(pages[i]);
      pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
    } finally { canvas.width = canvas.height = 0; }
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
