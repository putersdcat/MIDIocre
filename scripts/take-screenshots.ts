#!/usr/bin/env node

/**
 * Take screenshots of the demo with different themes for README slideshow generation.
 *
 * This script:
 * 1. Starts the dev server
 * 2. Uses Playwright to navigate to the demo
 * 3. Cycles through all available themes
 * 4. Takes screenshots of each theme
 * 5. Saves them to .playwright-mcp directory
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';

const THEMES = ['midnight', 'synthwave', 'emerald', 'frost', 'hakerman'];
const OUTPUT_DIR = '.playwright-mcp';
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(port: number, timeout = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(`${BASE_URL}/`);
      if (response.ok) return;
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error('Server did not start within timeout');
}

async function takeScreenshots(): Promise<void> {
  console.log('Starting dev server...');
  const server = spawn('node', ['scripts/dev-server.mjs'], {
    stdio: 'inherit',
    detached: false,
  });

  try {
    // Wait for server to be ready
    await waitForServer(PORT);
    console.log('Server is ready');

    // Create output directory
    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    // Launch browser
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Set viewport size
    await page.setViewportSize({ width: 1200, height: 800 });

    // Navigate to demo
    await page.goto(BASE_URL);
    await page.waitForLoadState('networkidle');

    // Wait a bit for the demo to load
    await page.waitForTimeout(2000);

    // Take screenshot for each theme
    for (const theme of THEMES) {
      console.log(`Taking screenshot for theme: ${theme}`);

      // Click the theme button
      const themeButton = page.locator(`.theme-btn[data-theme="${theme}"]`);
      await themeButton.click();

      // Wait for theme to apply
      await page.waitForTimeout(500);

      // Take screenshot
      const screenshotPath = join(OUTPUT_DIR, `demo-${theme}.png`);
      await page.screenshot({
        path: screenshotPath,
        fullPage: true,
      });

      console.log(`Saved: ${screenshotPath}`);
    }

    await browser.close();
    console.log('Screenshots completed');

  } finally {
    // Stop the server
    server.kill();
  }
}

takeScreenshots().catch(console.error);