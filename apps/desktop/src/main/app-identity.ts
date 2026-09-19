/**
 * The Windows application user model id.
 *
 * NSIS writes this value into the Start Menu and desktop shortcuts, and Windows groups a
 * window's taskbar button by it. Both halves have to agree, or a shortcut pinned to the taskbar
 * grows a second, ungrouped icon next to the application it launches.
 *
 * The other half is `appId` in `apps/desktop/electron-builder.yml`, which nothing can import
 * from here — an installer configuration file cannot reach a TypeScript module. It is a string
 * in two files rather than a value with one source, so `tests/app-identity.test.ts` reads the
 * configuration and fails when the pair drifts apart.
 */
export const APP_ID = 'dev.twigraph.desktop'
