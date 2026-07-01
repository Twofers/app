const { readdirSync, statSync } = require("node:fs");
const { basename, extname, join, relative } = require("node:path");
const { spawnSync } = require("node:child_process");

function walk(dir, out) {
  const entries = readdirSync(dir);
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (extname(name) === ".ts" && !basename(name).endsWith(".test.ts")) out.push(full);
  }
}

const files = [];
walk(join(process.cwd(), "supabase", "functions"), files);

if (files.length === 0) {
  console.log("No Edge Function source TypeScript files found.");
  process.exit(0);
}

files.sort();
const passthroughArgs = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (arg === "--pretty") {
    if (process.argv[index + 1] === "true" || process.argv[index + 1] === "false") {
      index += 1;
    }
    continue;
  }
  passthroughArgs.push(arg);
}

const denoArgs = ["check", ...passthroughArgs, ...files];
const result = spawnSync("deno", denoArgs, {
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.error(`\nEdge Function source typecheck failed across ${files.length} files.`);
  process.exit(1);
}

console.log(`Typechecked ${files.length} Edge Function source files:`);
for (const file of files) {
  console.log(`  ${relative(process.cwd(), file)}`);
}
