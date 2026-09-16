import { run } from './cli'

/**
 * The bin entry point.
 *
 * Everything it does is wire `process` to `run`, because `run` takes its input and output
 * as arguments and can therefore be tested without a terminal.
 */
const code = await run(process.argv.slice(2), {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
})

process.exitCode = code
