/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APC_FIXTURE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
