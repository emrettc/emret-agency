/**
 * Project profiles (Phase 3, docs/FAZ3-TASARIM.md).
 *
 * Each project runs as its own app instance started with `--profile=<id>`. The
 * id selects a private Electron userData folder (`<userData>/profiles/<id>`), so
 * every project has its own config.json, encrypted secrets, renderer storage and
 * single-instance lock. No flag = the Merkez (head office) instance, which keeps
 * the original userData folder untouched.
 *
 * Pure helpers only — the side effect lives in src/main/profile.ts.
 */

/** Lowercase letters, digits and dashes; 1–40 chars; no leading/trailing dash.
 *  Safe as a folder name on every OS and impossible to escape the profiles dir. */
const PROFILE_ID_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export function isValidProfileId(id: string): boolean {
  return PROFILE_ID_RE.test(id);
}

/**
 * Find `--profile=<id>` (or `--profile <id>`) in an argv list.
 * Returns the id, null when the flag is absent, or throws on a malformed id —
 * a typo must not silently open the Merkez profile in its place.
 */
export function parseProfileArg(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;
    if (arg.startsWith('--profile=')) value = arg.slice('--profile='.length);
    else if (arg === '--profile') value = argv[i + 1];
    else continue;
    if (value === undefined || !isValidProfileId(value)) {
      throw new Error(`invalid --profile value: ${JSON.stringify(value ?? '')}`);
    }
    return value;
  }
  return null;
}

/** Turn a human project name into a profile id: Turkish letters folded to ASCII,
 *  everything else collapsed to dashes. Returns '' when nothing usable remains. */
export function profileIdFromName(name: string): string {
  const folded = name
    .toLocaleLowerCase('tr')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
    .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const id = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return isValidProfileId(id) ? id : '';
}
