// Gerçek uygulamayı (Windows, WebView2) uzaktan hata ayıklama portuyla açar ve Playwright ile bağlanır.
// Hata ayıklama derlemesi arayüzü Vite'tan (localhost:1430) yükler: önce `bun run dev` çalışıyor olmalı.
// Yapılandırma geçici bir klasöre yazılır (ATAK_RDM_CONFIG_DIR); kullanıcının kendi ayarlarına dokunulmaz.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launchApp({ port = 9223, exe = "src-tauri/target/debug/atak-redis-desktop-manager.exe", configDir } = {}) {
  const dir = configDir ?? mkdtempSync(join(tmpdir(), "ardm-e2e-"));
  const child = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, ATAK_RDM_CONFIG_DIR: dir },
    stdio: ["ignore", "inherit", "inherit"],
  });

  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {
      /* henüz açılmadı */
    }
    if (i > 150) throw new Error("WebView2 hata ayıklama portu açılmadı");
    await sleep(200);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  let page = context.pages().find((p) => p.url().startsWith("http://localhost:1430"));
  while (!page) {
    await sleep(200);
    page = context.pages().find((p) => p.url().startsWith("http://localhost:1430"));
  }
  await page.waitForSelector(".app", { timeout: 30000 });

  return {
    page,
    configDir: dir,
    async close({ keepConfig = false } = {}) {
      await browser.close().catch(() => undefined);
      child.kill();
      await sleep(500);
      if (!keepConfig && !configDir) rmSync(dir, { recursive: true, force: true });
    },
  };
}
