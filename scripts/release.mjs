#!/usr/bin/env node
import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'

const bump = process.argv[2] ?? 'patch'
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage: release.mjs [patch|minor|major]')
  process.exit(1)
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

function get(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}

const branch = get('git rev-parse --abbrev-ref HEAD')
if (branch !== 'main') {
  console.error(`Must be on main (currently on ${branch})`)
  process.exit(1)
}

const status = get('git status --porcelain')
if (status) {
  console.error('Working tree is dirty — commit or stash changes first')
  process.exit(1)
}

run('git fetch origin main')
const behind = get('git rev-list HEAD..origin/main --count')
if (behind !== '0') {
  console.error(`Branch is ${behind} commit(s) behind origin/main — pull first`)
  process.exit(1)
}

run('node_modules/.bin/tsc --noEmit')
run('pnpm build')
run('pnpm test')
run('pnpm audit --audit-level=high --prod')
run('./mcp-publisher validate')

run(`npm version ${bump} --no-git-tag-version`)

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
const tag = `v${version}`

// Keep the (gitignored, local-only) server.json in lockstep with package.json — the MCP registry
// rejects a publish whose server.json version (or package version) doesn't match the npm package.
// It's read by mcp-publisher below, not committed, so it's synced but never git-added.
const serverJson = JSON.parse(readFileSync('server.json', 'utf8'))
serverJson.version = version
for (const pkg of serverJson.packages ?? []) {
  if (pkg.identifier === 'devicecloud-mcp') pkg.version = version
}
writeFileSync('server.json', JSON.stringify(serverJson, null, 2) + '\n')

run('git add package.json')
run(`git commit -m "${tag}"`)
run(`git tag ${tag}`)
run('git push && git push --tags')
run('pnpm publish --no-git-checks')

// Publish metadata to the official MCP registry. Non-fatal: npm + git are already pushed,
// so a registry hiccup (e.g. an expired login) shouldn't abort the release — just retry the step.
try {
  run('./mcp-publisher publish')
} catch {
  console.error('\nmcp-publisher publish failed — the npm package and git tag are already live.')
  console.error('Authenticate and retry just this step:')
  console.error('  ./mcp-publisher login github && ./mcp-publisher publish')
  process.exit(1)
}
