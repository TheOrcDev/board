#!/usr/bin/env node
// 1920×1080 screenshots of the grid: idle, mid-demo (Needs OrcDev lit), log, and a task panel.
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const origin = process.env.ORC_BOARD_URL ?? "http://localhost:3000";
const out = process.env.SCREENSHOT_DIR ?? "/opt/cursor/artifacts";
const mode = process.env.SCREENSHOT_MODE ?? "idle";
await mkdir(out, { recursive: true });

const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, colorScheme: "dark" });
page.setDefaultTimeout(30_000);

const shot = async (name) => {
  await page.waitForSelector(".tile");
  await page.waitForTimeout(500);
  const path = `${out}/${name}`;
  await page.screenshot({ path, fullPage: false });
  console.log(path);
};

await page.goto(origin, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
await page.waitForSelector(".tile");

if (mode === "idle") {
  await shot("orcdev-grid-idle.png");
} else if (mode === "demo") {
  await page.waitForSelector('.needs[data-lit="yes"]', { timeout: 60_000 });
  await page.waitForTimeout(700);
  await shot("orcdev-grid-demo.png");
} else if (mode === "log") {
  await page.locator('[data-testid="log-toggle"]').click();
  await page.waitForSelector('[data-testid="author-log"]');
  await page.waitForTimeout(400);
  await shot("orcdev-grid-log.png");
} else if (mode === "panel") {
  await page.waitForSelector('.needs[data-lit="yes"]', { timeout: 60_000 });
  await page.locator('button.tile[data-agent="videorc-main"]').click();
  await page.waitForSelector(".panel .thread, .panel .pad, .panel .bad", { timeout: 20_000 });
  await page.waitForTimeout(900);
  await shot("orcdev-grid-panel.png");
} else {
  await shot("orcdev-grid-idle.png");
}

await browser.close();
