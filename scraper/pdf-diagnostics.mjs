import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Retain only public PDFs already fetched by the normal scraper, only on failure.
export function createPdfDiagnostics(id, directory = process.env.TOUKI_DIAGNOSTICS_DIR) {
  const inputs = [];
  let bytes = 0;
  return {
    record(source, buffer) {
      if (!directory || !/^[a-z]+$/.test(id) || inputs.length >= 5 ||
          bytes + buffer.length > 50 * 1024 * 1024 ||
          buffer.subarray(0, 5).toString('ascii') !== '%PDF-') return;
      const url = new URL(source);
      if (url.protocol !== 'https:' || url.username || url.password ||
          !(url.hostname === 'moj.go.jp' || url.hostname.endsWith('.moj.go.jp'))) return;
      // Query strings, response headers, environment and credentials are never saved.
      inputs.push({ sourceUrl: url.origin + url.pathname, buffer: Buffer.from(buffer) });
      bytes += buffer.length;
    },
    saveFailure() {
      if (!inputs.length) return;
      const target = path.join(directory, id);
      fs.mkdirSync(target, { recursive: true });
      const files = inputs.map(({ sourceUrl, buffer }, index) => {
        const file = `${index + 1}.pdf`;
        fs.writeFileSync(path.join(target, file), buffer);
        return { file, sourceUrl, size: buffer.length,
          sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
      });
      fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify({
        jurisdiction: id, capturedAt: new Date().toISOString(),
        failure: 'scrape-or-validation-failed', files,
      }, null, 2) + '\n');
    },
  };
}
