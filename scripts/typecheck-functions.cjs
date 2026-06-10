const { readdirSync, statSync } = require("node:fs");
const { join, extname } = require("node:path");
const { spawnSync } = require("node:child_process");

function walk(dir, out) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (extname(name) === ".ts") out.push(full);
  }
}

const files = [];
walk(join(process.cwd(), "supabase", "functions"), files);

if (files.length === 0) {
  console.log("No Edge Function TypeScript files found.");
  process.exit(0);
}

const failures = [];
for (const file of files) {
  const result = spawnSync("deno", ["check", file], { stdio: "inherit", shell: true });
  if (result.error || result.status !== 0) {
    failures.push(file);
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} of ${files.length} Edge Function files failed typecheck:`);
  for (const file of failures) console.error(`  ${file}`);
  process.exit(1);
}

console.log(`Typechecked ${files.length} Edge Function files.`);
