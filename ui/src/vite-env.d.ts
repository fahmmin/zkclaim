/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Network the wallet must be on; defaults to the local devnet, `undeployed`. */
  readonly VITE_NETWORK_ID?: string;
}
