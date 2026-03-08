/**
 * Icon Generator for System Tray
 *
 * Run with: bun packages/bridge/assets/generate-icons.ts
 *
 * Converts icon.svg to PNG and ICO formats for system tray.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const assetsDir = import.meta.dir;

/**
 * Creates an ICO file from a PNG buffer.
 */
function createIco(pngBuffer: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Image type (ICO)
  header.writeUInt16LE(1, 4); // Number of images

  const entry = Buffer.alloc(16);
  entry.writeUInt8(width >= 256 ? 0 : width, 0);
  entry.writeUInt8(height >= 256 ? 0 : height, 1);
  entry.writeUInt8(0, 2); // Color palette
  entry.writeUInt8(0, 3); // Reserved
  entry.writeUInt16LE(1, 4); // Color planes
  entry.writeUInt16LE(32, 6); // Bits per pixel
  entry.writeUInt32LE(pngBuffer.length, 8); // Image size
  entry.writeUInt32LE(22, 12); // Offset (6 + 16)

  return Buffer.concat([header, entry, pngBuffer]);
}

/**
 * Render SVG to PNG at specified size.
 */
function renderSvgToPng(svgContent: string, size: number): Buffer {
  const resvg = new Resvg(svgContent, {
    fitTo: { mode: "width", value: size },
  });
  const rendered = resvg.render();
  return Buffer.from(rendered.asPng());
}

// Read the source SVG
const svgPath = resolve(assetsDir, "icon.svg");
const svgContent = readFileSync(svgPath, "utf-8");

// Create normal icon (green - running state)
const iconPng = renderSvgToPng(svgContent, 32);
const iconIco = createIco(iconPng, 32, 32);

// Create error icon (red background instead of dark blue)
const errorSvgContent = svgContent.replace("#1a1a2e", "#7f1d1d").replace("#4ade80", "#fca5a5");
const iconErrorPng = renderSvgToPng(errorSvgContent, 32);
const iconErrorIco = createIco(iconErrorPng, 32, 32);

// Write files
writeFileSync(resolve(assetsDir, "icon.png"), iconPng);
writeFileSync(resolve(assetsDir, "icon.ico"), iconIco);
writeFileSync(resolve(assetsDir, "icon-error.png"), iconErrorPng);
writeFileSync(resolve(assetsDir, "icon-error.ico"), iconErrorIco);

console.log("Icons generated from icon.svg:");
console.log(`  - icon.png (${iconPng.length} bytes)`);
console.log(`  - icon.ico (${iconIco.length} bytes)`);
console.log(`  - icon-error.png (${iconErrorPng.length} bytes)`);
console.log(`  - icon-error.ico (${iconErrorIco.length} bytes)`);
