// Build: turns the modular sources into the single self-contained HTML file.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...s) => join(root, ...s);

const MINIFY = process.argv.includes('--min');

/** Stops an inline payload from closing the tag that contains it. */
// `<\/` in the replacement: in a plain string `\/` is just `/`, and the escape that was meant
// to stop a `</script` inside the data from ending the element never happened.
const safeInline = (s) => s.replace(/<\/(script|style)/gi, '<\\/$1');
// The data blocks are delimited by HTML comments, so the JSON must not spell one: the same
// escape the runtime save applies (see io/file.js, protectJson).
const safeJson = (s) => safeInline(s).replace(/<!--/g, '\\u003c!--');

const CSS_FILES = ['reset.css', 'screen.css', 'document.css', 'print.css'];

async function bundleApp() {
  const res = await build({
    entryPoints: [p('src', 'main.js')],
    bundle: true,
    format: 'iife',
    target: ['chrome100', 'firefox100', 'safari16'],
    minify: MINIFY,
    write: false,
    legalComments: 'none',
  });
  return res.outputFiles[0].text;
}

async function readCss() {
  const parts = [];
  for (const f of CSS_FILES) parts.push(`/* ==== ${f} ==== */\n` + await readFile(p('src', 'styles', f), 'utf8'));
  return parts.join('\n');
}

function inject(shell, { css, paged, app, doc, history, assets, title }) {
  let out = shell
    .replace('/*TSW:CSS*/', () => safeInline(css))
    .replace('/*TSW:PAGED*/', () => safeInline(paged))
    .replace('/*TSW:APP*/', () => safeInline(app));
  out = replaceBlock(out, 'DOC', doc);
  out = replaceBlock(out, 'HISTORY', history);
  out = replaceBlock(out, 'ASSETS', assets);
  if (title) out = out.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  return out;
}

function replaceBlock(html, name, json) {
  const re = new RegExp(`<!--TSW:${name}-->[\\s\\S]*?<!--/TSW:${name}-->`);
  const body = `<script type="application/json" id="tsw-${name.toLowerCase()}">${safeJson(json)}</script>`;
  // Replacement through a function: the JSON may contain $&, $1 and the like, which as a
  // replacement string would be interpreted.
  return html.replace(re, () => `<!--TSW:${name}-->${body}<!--/TSW:${name}-->`);
}

const escapeHtml = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

async function main() {
  const [shell, css, paged, app] = await Promise.all([
    readFile(p('src', 'index.html'), 'utf8'),
    readCss(),
    readFile(p('node_modules', 'pagedjs', 'dist', 'paged.polyfill.min.js'), 'utf8'),
    bundleApp(),
  ]);
  await mkdir(p('dist'), { recursive: true });

  const empty = inject(shell, { css, paged, app, doc: 'null', history: 'null', assets: 'null' });
  await writeFile(p('dist', 'test-spec.html'), empty, 'utf8');

  const { buildDemo } = await import(new URL('./demo.mjs', import.meta.url));
  const demo = await buildDemo();
  const demoHtml = inject(shell, {
    css, paged, app,
    doc: JSON.stringify(demo.doc),
    history: JSON.stringify(demo.history),
    assets: JSON.stringify(demo.assets),
    title: demo.doc.header.title,
  });
  await writeFile(p('dist', 'example.html'), demoHtml, 'utf8');

  // The showcase: the same shell around a document written to exercise everything at once.
  const { buildWallboxDemo } = await import(new URL('./demo-wallbox.mjs', import.meta.url));
  const wallbox = await buildWallboxDemo();
  const wallboxHtml = inject(shell, {
    css, paged, app,
    doc: JSON.stringify(wallbox.doc),
    history: JSON.stringify(wallbox.history),
    assets: JSON.stringify(wallbox.assets),
    title: wallbox.doc.header.title,
  });
  await writeFile(p('dist', 'wallbox.html'), wallboxHtml, 'utf8');

  // The guides and the example travel with the tool.
  await copyFile(p('docs', 'EDITING-GUIDE.md'), p('dist', 'EDITING-GUIDE.md'));
  await copyFile(p('docs', 'IMPORT-GUIDE.md'), p('dist', 'IMPORT-GUIDE.md'));
  await copyFile(p('docs', 'example-spec.json'), p('dist', 'example-spec.json'));
  await copyFile(p('LICENSE'), p('dist', 'LICENSE'));

  const kb = (s) => (Buffer.byteLength(s, 'utf8') / 1024).toFixed(0) + ' KB';
  console.log(`dist/test-spec.html  ${kb(empty)}`);
  console.log(`dist/example.html     ${kb(demoHtml)}`);
  console.log(`dist/wallbox.html     ${kb(wallboxHtml)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
