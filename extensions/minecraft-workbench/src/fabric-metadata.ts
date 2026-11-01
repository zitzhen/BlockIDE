import AdmZip from 'adm-zip';
import * as semver from 'semver';

export type VersionPredicate = string | string[];
export function candidateModVersion(value: string): string {
  return value
    .replace(/^mc\d+(?:\.\d+)+[-+]/i, '')
    .replace(/-(?:fabric|forge|neoforge|quilt)$/i, '');
}
export interface FabricModule {
  id: string;
  version: string;
  provides?: string[];
  depends?: Record<string, VersionPredicate>;
  breaks?: Record<string, VersionPredicate>;
}
export function fabricSatisfies(version: string, predicate: VersionPredicate): boolean {
  if (Array.isArray(predicate)) return predicate.some((value) => fabricSatisfies(version, value));
  if (typeof predicate !== 'string') return true;
  const normalized = semver.valid(version, { loose: true }) || semver.coerce(version)?.version;
  if (!normalized || !semver.validRange(predicate, { loose: true })) return true;
  return semver.satisfies(normalized, predicate, { loose: true, includePrerelease: true });
}
export function readFabricMetadata(archive: string | Buffer): FabricModule[] {
  const result: FabricModule[] = [];
  let count = 0;
  let bytes = 0;
  const read = (zip: AdmZip, depth: number) => {
    const entry = zip.getEntry('fabric.mod.json');
    if (!entry) return;
    if (entry.header.size > 2 * 1024 ** 2) throw new Error('Mod metadata exceeds size limit');
    const value = JSON.parse(entry.getData().toString()) as FabricModule & {
      jars?: { file: string }[];
    };
    if (typeof value.id !== 'string' || typeof value.version !== 'string') return;
    result.push(value);
    for (const jar of value.jars || []) {
      if (++count > 200 || depth >= 4) break;
      const nested = zip.getEntry(jar.file);
      if (!nested) continue;
      bytes += nested.header.size;
      if (bytes > 128 * 1024 ** 2) throw new Error('Embedded mod metadata exceeds size limit');
      read(new AdmZip(nested.getData()), depth + 1);
    }
  };
  read(new AdmZip(archive), 0);
  return result;
}
export function fabricDiagnostics(modules: FabricModule[], native: Record<string, string>) {
  const versions = new Map(Object.entries(native));
  for (const module of modules)
    for (const id of [module.id, ...(module.provides || [])]) versions.set(id, module.version);
  const issues: {
    owner: string;
    dependency: string;
    expected: VersionPredicate;
    actual?: string;
    type: 'required' | 'incompatible';
  }[] = [];
  for (const module of modules) {
    for (const [dependency, expected] of Object.entries(module.depends || {})) {
      if (
        ['java', 'quilt_loader'].includes(dependency) ||
        (dependency === 'fabricloader' && !native.fabricloader)
      )
        continue;
      const actual = versions.get(dependency);
      if (!actual || !fabricSatisfies(actual, expected))
        issues.push({ owner: module.id, dependency, expected, actual, type: 'required' });
    }
    for (const [dependency, expected] of Object.entries(module.breaks || {})) {
      const actual = versions.get(dependency);
      if (actual && fabricSatisfies(actual, expected))
        issues.push({ owner: module.id, dependency, expected, actual, type: 'incompatible' });
    }
  }
  return issues;
}
