import type { TwigraphApi } from '@twigraph/shared/ipc'

declare global {
  interface Window {
    /**
     * The only way out of this window. Exposed by the preload as the named channels in
     * `@twigraph/shared/ipc`, and nothing else.
     */
    readonly twigraph: TwigraphApi
  }
}
