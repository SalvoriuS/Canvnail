exports.readWorkspace = page => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('canvnail', 1);
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, read = db.transaction('projects').objectStore('projects').get('current');
    read.onsuccess = () => { resolve(read.result); db.close(); };
    read.onerror = () => { reject(read.error); db.close(); };
  };
}));
exports.legacyView = project => {
  if (project?.version !== 3) return project;
  const page = project.pages.find(page => page.id === project.activePageId) || project.pages[0];
  const { id, ...content } = page; return { version: 2, name: project.name, ...content };
};
exports.readProject = async page => exports.legacyView(await exports.readWorkspace(page));
exports.openInspector = async (page, pane) => {
  const tab = page.locator(`#inspector [data-inspector-tab="${pane}"]`);
  await tab.waitFor({ state: 'visible' });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
};
exports.openDrawing = async page => {
  const tab = page.getByRole('tab', { name: 'Dibujar', exact: true });
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click();
};
// Existing regression suites exercise the browser's download fallback, without native dialogs.
exports.useDownloadFallback = browser => {
  const create = browser.newContext.bind(browser);
  browser.newContext = async (...args) => { const context = await create(...args); await context.addInitScript(() => { window.showSaveFilePicker = undefined; }); return context; };
};
