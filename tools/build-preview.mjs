// Сборка одностраничного превью «Рамок»: весь код, стили, шрифты, банк заданий и теория —
// в одном HTML-фрагменте (без service worker). Основная версия — обычная папка для GitHub Pages.
// Запуск: npm run build:preview [путь/к/файлу.html]
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(root, 'dist', 'preview.html'));

// 1. Код: ES-модули → один скрипт.
const js = execFileSync('npx', [
  '--yes', 'esbuild@0.24.0', join(root, 'js/app.js'),
  '--bundle', '--format=iife', '--target=es2020', '--minify', '--charset=utf8', '--legal-comments=none',
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

// 2. Стили: шрифты — внутрь, как data: URI.
const css = readFileSync(join(root, 'css/app.css'), 'utf8').replace(
  /url\("\.\.\/fonts\/([^"]+\.woff2)"\)/g,
  (_, file) => `url("data:font/woff2;base64,${readFileSync(join(root, 'fonts', file)).toString('base64')}")`,
);

// 3. Банк заданий — внутрь, чтобы не зависеть от загрузки файла.
const bank = JSON.stringify(JSON.parse(readFileSync(join(root, 'data/bank.json'), 'utf8'))).replace(/</g, '\\u003c');
const theory = JSON.stringify(JSON.parse(readFileSync(join(root, 'data/theory.json'), 'utf8'))).replace(/</g, '\\u003c');

const html = `<title>Рамки</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Помощник для учёбы: календарь дедлайнов, план дня с учётом дороги и сна, отработка тем.">
<style>${css}</style>
<div class="strip" id="strip"></div>
<main class="app"><div class="view" id="view"></div></main>
<nav class="nav" id="nav" aria-label="Разделы"></nav>
<script>window.__RAMKI_PREVIEW__ = true; window.__RAMKI_BANK__ = ${bank}; window.__RAMKI_THEORY__ = ${theory};</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`Превью: ${out} (${Math.round(html.length / 1024)} КБ)`);
