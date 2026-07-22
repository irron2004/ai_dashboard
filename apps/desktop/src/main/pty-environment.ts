export type PtyEnvironmentKind = 'local' | 'wsl' | 'ssh'

export type PtyEnvironmentDiagnostic = {
  kind: PtyEnvironmentKind
  term: string
  colorTerm: string
  locale?: string
  utf8: boolean
  verified: boolean
  warnings: string[]
  checks: string[]
}

export type PtyEnvironmentResult = {
  env: Record<string, string>
  diagnostic: PtyEnvironmentDiagnostic
}

type BuildPtyEnvironmentInput = {
  kind: PtyEnvironmentKind
  env: Record<string, string | undefined>
  availableLocales?: readonly string[]
  remoteCharmap?: string
}

const UTF8_LOCALE_PRIORITY = ['C.UTF-8', 'C.utf8', 'en_US.UTF-8', 'ko_KR.UTF-8']

export function isUtf8Locale(value: string | undefined): boolean {
  return Boolean(value && /utf-?8/i.test(value))
}

function currentLocale(env: Record<string, string | undefined>): string | undefined {
  return env.LC_ALL || env.LC_CTYPE || env.LANG
}

function supportedUtf8Locale(locales: readonly string[]): string | undefined {
  const normalized = new Map(locales.map((locale) => [locale.toLowerCase().replace(/[-_.]/g, ''), locale]))
  for (const candidate of UTF8_LOCALE_PRIORITY) {
    const match = normalized.get(candidate.toLowerCase().replace(/[-_.]/g, ''))
    if (match) return match
  }
  return locales.find(isUtf8Locale)
}

/** Builds PTY env without guessing or installing a remote locale. */
export function buildPtyEnvironment(input: BuildPtyEnvironmentInput): PtyEnvironmentResult {
  const env = Object.fromEntries(
    Object.entries(input.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  const warnings: string[] = []
  const checks: string[] = []

  if (input.kind === 'ssh') {
    const charmap = input.remoteCharmap?.trim()
    const verified = Boolean(charmap)
    const utf8 = isUtf8Locale(charmap)
    if (!verified) {
      warnings.push('원격 locale을 아직 확인하지 못했습니다.')
      checks.push('locale charmap', 'locale -a')
    } else if (!utf8) {
      warnings.push(`원격 charmap(${charmap})이 UTF-8이 아닙니다. 서버 locale을 확인해 주세요.`)
      checks.push('locale charmap', 'locale -a')
    }
    return {
      env,
      diagnostic: {
        kind: input.kind,
        term: env.TERM,
        colorTerm: env.COLORTERM,
        locale: charmap,
        utf8,
        verified,
        warnings,
        checks,
      },
    }
  }

  let locale = currentLocale(env)
  if (!isUtf8Locale(locale)) {
    const supported = supportedUtf8Locale(input.availableLocales ?? [])
    if (supported) {
      env.LANG = supported
      env.LC_CTYPE = supported
      if (env.LC_ALL) env.LC_ALL = supported
      locale = supported
    } else {
      warnings.push('현재 locale이 UTF-8이 아니며 확인된 UTF-8 locale도 없습니다.')
      checks.push('locale charmap', 'locale -a')
    }
  }
  return {
    env,
    diagnostic: {
      kind: input.kind,
      term: env.TERM,
      colorTerm: env.COLORTERM,
      locale,
      utf8: isUtf8Locale(locale),
      verified: true,
      warnings,
      checks,
    },
  }
}

export function localPtyEnvironmentKind(env: Record<string, string | undefined>): 'local' | 'wsl' {
  return env.WSL_DISTRO_NAME || env.WSL_INTEROP ? 'wsl' : 'local'
}
