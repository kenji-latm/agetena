import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "app");
const portal = resolve(root, "site");
const output = resolve(root, "_site");
const agetena = resolve(output, "agetena");
const rootPrivacy = resolve(output, "privacy.html");

const agetenaFiles = [
  "index.html",
  "privacy.html",
  "styles.css",
  "app.js",
  "shared-config.js",
  "sw.js",
  "manifest.webmanifest",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon.svg",
  "data",
];

await rm(output, { recursive: true, force: true });
await cp(source, output, { recursive: true });
await mkdir(agetena, { recursive: true });

for (const item of agetenaFiles) {
  await cp(resolve(source, item), resolve(agetena, item), { recursive: true });
}

// ルート（/）はテナシリーズのポータル。app/ のコピーで置かれたアゲテナ用 index.html を上書きする。
await cp(portal, output, { recursive: true, force: true });

await writeFile(
  rootPrivacy,
  redirectHtml({
    title: "アゲテナのプライバシー説明へ移動します",
    message: "アゲテナのプライバシー説明は新しいURLへ移動しました。",
    targetPath: "/agetena/privacy.html",
    linkText: "プライバシー説明を開く",
  })
);

console.log("GitHub Pages output prepared: / = テナシリーズのポータル, /agetena/ = アゲテナ本体");

function redirectHtml({ title, message, targetPath, linkText }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(title)}</title>
  <script>
    (function () {
      var target = new URL(${JSON.stringify(targetPath)}, window.location.origin);
      target.search = window.location.search;
      target.hash = window.location.hash;
      var redirect = function () {
        window.location.replace(target.href);
      };

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.getRegistrations()
          .then(function (registrations) {
            return Promise.all(registrations.map(function (registration) {
              return new URL(registration.scope).pathname === "/" ? registration.unregister() : true;
            }));
          })
          .then(redirect, redirect);
      } else {
        redirect();
      }
    })();
  </script>
</head>
<body>
  <p>${escapeHtml(message)}</p>
  <p><a id="redirect-link" href="${escapeHtml(targetPath)}">${escapeHtml(linkText)}</a></p>
  <script>
    document.getElementById("redirect-link").href = new URL(${JSON.stringify(targetPath)}, window.location.origin).href;
  </script>
</body>
</html>
`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}
