// Guardrail for AGENTS.md rule 1: config sources and script tables must match code.
// - Every key in src/config/config.ts (envSchema) must be documented in
//   .env.example and docs/configuration.md (same default where applicable).
// - Every `npm run <name>` in README.md / docs/development.md must exist in
//   package.json, and the README script table must list every package script.
// Run: npm run docs:check
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

const failures = [];

// 1. Config keys: single source of truth across config.ts / .env.example / configuration.md.
const configKeys = [...read('src/config/config.ts').matchAll(/^ +([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1]);
assert.ok(configKeys.length > 40, `expected dozens of env keys in config.ts, found ${configKeys.length}`);
const exampleKeys = new Set([...read('.env.example').matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]));
const documentedKeys = new Set([...read('docs/configuration.md').matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]));
for (const key of configKeys) {
  if (!exampleKeys.has(key)) failures.push(`config key ${key} missing from .env.example`);
  if (!documentedKeys.has(key)) failures.push(`config key ${key} missing from docs/configuration.md`);
}

// 2. Script tables: README.md lists every package script; docs mention only real scripts.
const pkg = JSON.parse(read('package.json'));
const packageScripts = new Set(Object.keys(pkg.scripts));
const readmeScripts = new Set([...read('README.md').matchAll(/^\|\s*`npm (?:run )?([^`]+)`\s*\|/gm)].map((m) => m[1]));
for (const name of packageScripts) {
  if (!readmeScripts.has(name)) failures.push(`package script ${name} missing from README.md script table`);
}
for (const name of readmeScripts) {
  if (!packageScripts.has(name)) failures.push(`README.md documents unknown script ${name}`);
}
const devMentions = new Set([...read('docs/development.md').matchAll(/npm run ([^\s`;,)]+)/g)].map((m) => m[1]));
for (const name of devMentions) {
  if (!packageScripts.has(name)) failures.push(`docs/development.md mentions unknown script ${name}`);
}

if (failures.length > 0) {
  console.error('docs:check FAILED:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`docs:check OK — ${configKeys.length} env keys in sync; ${packageScripts.size} scripts documented.`);
