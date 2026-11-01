import type { VersionEntry } from './models';

const aprilFoolsVersions = new Set([
  '15w14a',
  '1.rv-pre1',
  '3d shareware v1.34',
  '20w14infinite',
  '22w13oneblockatatime',
  '23w13a_or_b',
  '24w14potato',
  '25w14craftmine',
  '26w14a',
]);

export function gameVersionCategory(version: Pick<VersionEntry, 'id' | 'type'>): string {
  return aprilFoolsVersions.has(version.id.toLowerCase()) ? 'april_fools' : version.type;
}
