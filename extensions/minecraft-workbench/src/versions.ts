export function neoForgePrefix(minecraft: string): string | undefined {
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(minecraft)) return undefined;
  const [major, minor, patch = '0'] = minecraft.split('.');
  return major === '1' ? `${minor}.${patch}.` : `${major}.${minor}.${patch}.`;
}
