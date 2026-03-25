const fs = require("fs");
const path = require("path");

const localesDir = path.join(__dirname, "../lib/i18n/locales");

function merge(locale, patchFile) {
  const basePath = path.join(localesDir, `${locale}.json`);
  const base = JSON.parse(fs.readFileSync(basePath, "utf8"));
  const patch = JSON.parse(fs.readFileSync(path.join(__dirname, patchFile), "utf8"));
  Object.assign(base, patch);
  fs.writeFileSync(basePath, JSON.stringify(base, null, 2) + "\n");
}

merge("en", "locale-patch-en.json");
merge("es", "locale-patch-es.json");
merge("ko", "locale-patch-ko.json");
