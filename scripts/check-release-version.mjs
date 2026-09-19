import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The release rule, checked rather than assumed.
 *
 * The tag names the version, and `apps/desktop/package.json` is the version electron-builder
 * writes into the installer metadata and the file names. A tag that disagrees with it would
 * publish an installer labelled with a version nobody asked for, which is the kind of mistake a
 * reader of the release page has no way to notice.
 */

const raw = process.env.TWIGRAPH_RELEASE_TAG ?? process.env.GITHUB_REF_NAME ?? ''
const tag = raw.replace(/^refs\/tags\//, '')
const version = JSON.parse(readFileSync(resolve('apps/desktop/package.json'), 'utf8')).version

if (tag !== `v${version}`) {
  process.stderr.write(
    `the tag "${tag}" does not name the desktop app version "${version}" in apps/desktop/package.json\n`,
  )
  process.exit(1)
}

process.stdout.write(`releasing the twigraph desktop app ${version}\n`)
