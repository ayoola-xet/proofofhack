import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const CARDS_DIR = resolve("scripts/demo-video-cards");
const OUTPUT_DIR = resolve("output/demo-video/cards");

async function toDataUri(path: string) {
  const buf = await readFile(path);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const logo = await toDataUri(resolve("apps/web/public/logo.png"));

  const jobs: { html: string; out: string; transparent: boolean }[] = [
    { html: "title-card.html", out: "title-card.png", transparent: false },
    { html: "end-card.html", out: "end-card.png", transparent: false },
    { html: "lower-third-circle.html", out: "lower-third-circle.png", transparent: true },
    { html: "label-protocol.html", out: "label-protocol.png", transparent: true },
    { html: "label-researcher.html", out: "label-researcher.png", transparent: true },
  ];

  for (const job of jobs) {
    let html = await readFile(resolve(CARDS_DIR, job.html), "utf8");
    html = html.replaceAll("LOGO_SRC", logo);
    await page.setContent(html, { waitUntil: "load" });
    await page.screenshot({ path: resolve(OUTPUT_DIR, job.out), omitBackground: job.transparent });
    console.log(`Rendered ${job.out}`);
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
