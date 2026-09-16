/**
 * Types for the fixture generator, so TypeScript tests can import it. The generator itself
 * is plain JavaScript on purpose: it is a build-time tool, not part of the product.
 */

/** Writes the whole fixture tree into `targetDir`, replacing whatever was there. */
export declare function generateFixtures(targetDir: string): Promise<readonly string[]>

/** Every path the generator writes, without writing anything. */
export declare const fixturePaths: readonly string[]

/** The directories under the target that the scan must refuse to descend into. */
export declare const ignoredDirectories: readonly string[]
