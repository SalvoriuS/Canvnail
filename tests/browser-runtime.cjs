const { chromium } = require('playwright');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

// Each suite gets a fresh browser profile, never the user's signed-in Chrome.
exports.chromium = chromium;
exports.launchOptions = { headless: true };
exports.baseURL = process.env.CANVNAIL_TEST_URL || 'http://127.0.0.1:4173/';
exports.isLocalRequest = url => url.startsWith(exports.baseURL) || /^(data:|blob:)/.test(url);
exports.fixtureImage = async (page, transparent = false) => {
  let svg = await readFile(path.join(__dirname, 'fixtures/bear.svg'), 'utf8');
  if (transparent) svg = svg.replace(/<rect id="background"[^>]*\/>/, '');
  return page.evaluate(async source => {
    const image = new Image();
    image.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(source)));
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width; canvas.height = image.height;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/png');
  }, svg);
};
exports.uploadFixture = async page => {
  const source = await exports.fixtureImage(page);
  await page.locator('#image-file').setInputFiles({
    name: 'bear.png', mimeType: 'image/png', buffer: Buffer.from(source.split(',')[1], 'base64'),
  });
};
