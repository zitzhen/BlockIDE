import * as vscode from 'vscode';
export const config = <T>(key: string, fallback: T): T =>
  vscode.workspace.getConfiguration('minecraftWorkbench').get<T>(key, fallback);
export function t(en: string, zh: string): string {
  const locale = config<string>('language', 'auto');
  return locale === 'zh-cn' ||
    (locale === 'auto' && vscode.env.language.toLowerCase().startsWith('zh'))
    ? zh
    : en;
}
export async function trusted(): Promise<void> {
  if (!vscode.workspace.isTrusted)
    throw new Error(
      t(
        'Trust this workspace before running Minecraft or Gradle.',
        '请先信任工作区，再运行 Minecraft 或 Gradle。',
      ),
    );
}

export async function setLanguage(value: unknown): Promise<void> {
  if (typeof value !== 'string' || !['auto', 'en', 'zh-cn'].includes(value))
    throw new Error('Invalid language');
  const settings = vscode.workspace.getConfiguration('minecraftWorkbench');
  await settings.update('language', value, vscode.ConfigurationTarget.Global);
  if (settings.inspect('language')?.workspaceValue !== undefined)
    await settings.update('language', undefined, vscode.ConfigurationTarget.Workspace);
}
