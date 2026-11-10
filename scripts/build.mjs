// Build of the web interface with esbuild.
//   node scripts/build.mjs           → dist/index.html + app.js + styles.css, dist/yutreno.html (single file), dist/model.html
//   node scripts/build.mjs --serve   → development server on http://localhost:8000 with automatic rebuild
import * as esbuild from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'src/web'), dist = join(root, 'dist');
const serve = process.argv.includes('--serve');
mkdirSync(dist, { recursive: true });

const options = {
  entryPoints: [join(web, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  outfile: join(dist, 'app.js'),
  sourcemap: serve ? 'inline' : false,
  minify: !serve,
  define: {
    __ATO_EXAMPLE__: JSON.stringify(readFileSync(join(root, 'examples/ato.js'), 'utf8')),
    __ATO_S130_EXAMPLE__: JSON.stringify(readFileSync(join(root, 'examples/ato_s130.js'), 'utf8')),
  },
  logLevel: 'info',
};

function writeHtml() {
  copyFileSync(join(web, 'index.html'), join(dist, 'index.html'));
  copyFileSync(join(web, 'styles.css'), join(dist, 'styles.css'));
  const html = readFileSync(join(web, 'index.html'), 'utf8');
  const css = readFileSync(join(web, 'styles.css'), 'utf8');
  const js = readFileSync(join(dist, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const single = html
    .replace('<link rel="stylesheet" href="styles.css">', () => '<style>\n' + css + '</style>')
    .replace('<script src="app.js"></script>', () => '<script>\n' + js + '</script>');
  writeFileSync(join(dist, 'yutreno.html'), single);
  // fragment for publishing as an artifact (without doctype, html, head and body)
  const head = single.slice(single.indexOf('<title>'), single.indexOf('</head>'));
  const body = single.slice(single.indexOf('<body>') + 6, single.lastIndexOf('</body>'));
  writeFileSync(join(dist, 'artifact.html'), head.trim() + '\n' + body.trim() + '\n');
}

/** Model page: dist/model.html (complete document) and dist/model-artifact.html (to publish) */
async function buildDocs() {
  const docs = join(root, 'src/docs');
  await esbuild.build({ entryPoints: [join(docs, 'model.ts')], bundle: true, format: 'iife', target: 'es2020', outfile: join(dist, 'model.js'), minify: true, logLevel: 'warning' });
  const tpl = readFileSync(join(docs, 'model.html'), 'utf8');
  const js = readFileSync(join(dist, 'model.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
  const frag = tpl.replace('<script src="model.js"></script>', () => '<script>\n' + js + '</script>');
  writeFileSync(join(dist, 'model-artifact.html'), frag.replace('<!--body-->\n', ''));
  const [head, body] = frag.split('<!--body-->');
  writeFileSync(join(dist, 'model.html'), '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head + '</head>\n<body>' + body + '</body>\n</html>\n');
}

if (serve) {
  const ctx = await esbuild.context({
    ...options,
    plugins: [{ name: 'html', setup(b) { b.onEnd(r => { if (!r.errors.length) writeHtml(); }); } }],
  });
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: dist, port: 8000 });
  console.log(`YuTreno in development on http://localhost:${port}`);
} else {
  await esbuild.build(options);
  writeHtml();
  await buildDocs();
  console.log('Created dist/index.html, dist/yutreno.html (single file), dist/artifact.html and the model page dist/model.html');
}
