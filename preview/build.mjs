// Builds a single self-contained HTML page of the office screen (no server). → preview/dist/index.html
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const out = path.join(root, "preview/dist");
fs.mkdirSync(out, { recursive: true });

const js = await build({
  entryPoints: [path.join(root, "preview/entry.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  write: false,
  jsx: "automatic",
  tsconfig: path.join(root, "tsconfig.json"),
  alias: { "@/hooks/useOfficeData": path.join(root, "preview/useOfficeDataStatic.ts") },
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".json": "json" },
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
console.log(`preview/dist/index.html ${(html.length / 1024 / 1024).toFixed(2)} MB`);
