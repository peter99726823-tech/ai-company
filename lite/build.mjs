// Builds the link version: one self-contained HTML page (UI + Phaser + SQLite-in-WebAssembly + fonts).
//   node lite/build.mjs   →  lite/dist/index.html
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "lite/dist");
fs.mkdirSync(out, { recursive: true });

const swap = {
  name: "lite-swap",
  setup(b) {
    // Shared server code imports the Node DB client; the link version uses sql.js instead.
    b.onResolve({ filter: /(^|\/)db\/client$/ }, () => ({ path: path.join(root, "lite/client.ts") }));
    b.onResolve({ filter: /^@\/hooks\/useOfficeData$/ }, () => ({ path: path.join(root, "lite/useOfficeDataLite.ts") }));
    b.onResolve({ filter: /^(server-only|node:crypto|buffer)$/ }, () => ({ path: path.join(root, "lite/shims.ts") }));
    b.onResolve({ filter: /^@\/lib\/pdfWorker$/ }, () => ({ path: path.join(root, "lite/pdfWorker.ts") }));
    // "?text": embed a file as a string (pdf.js worker for the one-file link version)
    b.onResolve({ filter: /\?text$/ }, (a) => ({ path: path.join(root, "node_modules", a.path.replace(/\?text$/, "")), namespace: "as-text" }));
    b.onLoad({ filter: /.*/, namespace: "as-text" }, (a) => ({ contents: fs.readFileSync(a.path, "utf8"), loader: "text" }));
  },
};

const js = await build({
  entryPoints: [path.join(root, "lite/entry.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  plugins: [swap],
  external: ["fs", "path", "crypto"], // only referenced on sql.js's Node code path
  define: { "process.env.NODE_ENV": '"production"', "process.env.AI_MAX_CALLS_PER_TASK": '"3"' },
  loader: { ".wasm": "binary", ".sql": "text", ".json": "json" },
  logLevel: "warning",
});
const jsText = js.outputFiles[0].text.replaceAll("</script", "<\\/script");

let css = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
css = (await postcss([tailwind({ base: root })]).process(css, { from: path.join(root, "src/app/globals.css") })).css;
const font = (f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(root, "public/fonts", f)).toString("base64")})`;
css = css
  .replace(/url\("\/fonts\/Galmuri11\.woff2"\)/g, font("Galmuri11.woff2"))
  .replace(/url\("\/fonts\/Galmuri11-Bold\.woff2"\)/g, font("Galmuri11-Bold.woff2"))
  .replace(/@font-face\s*{[^}]*Galmuri9[^}]*}/g, "");

const html = `<title>AI 회사 시뮬레이터</title>
<style>${css}</style>
<div id="root"></div>
<script>${jsText}</script>
`;
fs.writeFileSync(path.join(out, "index.html"), html);
console.log(`lite/dist/index.html ${(html.length / 1024 / 1024).toFixed(2)} MB`);
