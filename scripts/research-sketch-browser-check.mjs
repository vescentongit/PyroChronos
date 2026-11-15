// Run with Playwright MCP browser_run_code_unsafe's filename option against local dev.
async (page) => {
  if (!['localhost', '127.0.0.1'].includes(new URL(page.url()).hostname)) throw Error('Local QA only');
  await page.reload();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Analisis historis', exact: true }).click();
  await page.evaluate(() => {
    const host = document.querySelector('.global-map');
    let fiber = host[Object.keys(host).find(key => key.startsWith('__reactFiber'))];
    while (fiber) {
      for (let hook = fiber.memoizedState; hook; hook = hook.next) {
        if (hook.memoizedState?.current?.getSource) { window.qaMap = hook.memoizedState.current; return; }
      }
      fiber = fiber.return;
    }
    throw Error('Map instance missing');
  });
  await page.waitForFunction(() => window.qaMap.getSource('area-edit'));
  const panel = page.locator('.research-panel');
  const tools = page.locator('.global-drawing-tools');
  const editor = page.getByRole('textbox', { name: 'Bujur, lintang', exact: true });
  await panel.locator('summary').click();
  await editor.fill('112, -4\n118, -4\n118, 3\n112, 3');
  await page.getByRole('button', { name: 'Gunakan koordinat sebagai draft' }).click();
  await panel.getByRole('button', { name: 'Gunakan area ini', exact: true }).click();
  await panel.getByRole('button', { name: 'Hapus titik terakhir', exact: true }).click();
  await page.waitForFunction(async () => {
    const edit = await qaMap.getSource('area-edit').getData();
    const outlines = await qaMap.getSource('area-outlines').getData();
    return edit.features.filter(f => f.geometry.type === 'Point').length === 3 && outlines.features.length === 0;
  });
  if (!(await page.getByRole('button', { name: 'Analisis area', exact: true }).isDisabled())) throw Error('Dirty area can submit');
  await panel.getByRole('button', { name: 'Batal edit', exact: true }).click();
  await page.waitForFunction(async () => (await qaMap.getSource('area-edit').getData()).features.length === 0);
  if ((await editor.inputValue()).split('\n').length !== 4) throw Error('Cancel failed to restore coordinates');
  await panel.getByRole('button', { name: 'Hapus semua titik', exact: true }).click();
  await page.waitForFunction(async () => (await qaMap.getSource('area-edit').getData()).features.length === 0 && (await qaMap.getSource('area-outlines').getData()).features.length === 0);
  await page.getByRole('button', { name: 'Kalimantan', exact: true }).click();
  const canvas = page.locator('.maplibregl-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  for (const [x, y] of [[0.3, 0.55], [0.7, 0.55], [0.7, 0.8], [0.3, 0.8]]) {
    await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
  }
  await page.waitForFunction(async () => (await qaMap.getSource('area-edit').getData()).features.filter(f => f.geometry.type === 'Point').length === 4);
  for (let count = 3; count >= 0; count--) {
    await tools.getByRole('button', { name: 'Hapus titik terakhir', exact: true }).click();
    await page.waitForFunction(async count => {
      const data = await qaMap.getSource('area-edit').getData();
      return data.features.filter(f => f.geometry.type === 'Point').length === count && data.features.filter(f => f.geometry.type === 'LineString').length === (count > 1 ? 1 : 0);
    }, count);
  }
  await page.waitForFunction(() => qaMap.queryRenderedFeatures({ layers: ['edit-vertices', 'edit-line', 'area-draft', 'area-active'] }).length === 0);
  await editor.fill('999, 0\n118, 3\n112, 3');
  await page.getByRole('button', { name: 'Gunakan koordinat sebagai draft' }).click();
  if (!(await panel.locator('.research-coordinate-editor [role=alert]').isVisible())) throw Error('Invalid coordinates accepted');
  await editor.fill('112, -4\n118, 3\n118, -4\n112, 3');
  await page.getByRole('button', { name: 'Gunakan koordinat sebagai draft' }).click();
  await tools.getByRole('button', { name: 'Gunakan area ini', exact: true }).click();
  if (!(await tools.getByRole('alert').isVisible())) throw Error('Intersection error missing near drawing');
  await tools.getByRole('button', { name: 'Batal edit', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Mobile overflow');
  const order = await page.evaluate(() => {
    const map = document.querySelector('.global-surface').getBoundingClientRect();
    const form = document.querySelector('.research-setup').getBoundingClientRect();
    return map.bottom <= form.top + 1;
  });
  if (!order) throw Error('Period form must follow map');
  return { undoAppliedArea: true, cancel: true, clear: true, realMapClicks: true, undoToZeroRendered: true, invalidCoordinates: true, intersection: true, mobile: true, workflowOrder: true };
}
