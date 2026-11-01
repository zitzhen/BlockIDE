import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as vscode from 'vscode';
import { Accounts } from '../src/accounts';
import { Store } from '../src/store';
import { Network } from '../src/network';

test('online refresh is deduplicated, tokens remain in SecretStorage and removal clears them', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-account-'));
  const store = new Store(root, () => {});
  const values = new Map<string, string>();
  const secrets = {
    get: async (key: string) => values.get(key),
    store: async (key: string, value: string) => {
      values.set(key, value);
    },
    delete: async (key: string) => {
      values.delete(key);
    },
  } as unknown as vscode.SecretStorage;
  const account = { id: 'id', name: 'Player', kind: 'microsoft' as const };
  store.state.accounts.push(account);
  values.set(
    'minecraftWorkbench.account.id',
    JSON.stringify({ accessToken: 'expired', refreshToken: 'refresh-1', expiresAt: 0 }),
  );
  let refreshes = 0;
  const net = {
    json: async (url: string) => {
      if (url.endsWith('/token')) {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { access_token: 'ms-token', refresh_token: 'refresh-2' };
      }
      if (url.includes('user.auth')) return { Token: 'xbox-token' };
      if (url.includes('xsts.auth'))
        return { Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: 'hash' }] } };
      if (url.includes('login_with_xbox')) return { access_token: 'mc-token', expires_in: 86400 };
      if (url.endsWith('/profile')) return { id: 'id', name: 'Player' };
      throw new Error(url);
    },
  } as unknown as Network;
  const original = vscode.workspace.getConfiguration;
  (vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration = () => ({
    get: (key: string, fallback: unknown) =>
      key === 'microsoftClientId' ? 'test-client-id' : fallback,
  });
  const accounts = new Accounts(store, secrets, net);
  try {
    assert.deepEqual(
      await Promise.all([
        accounts.token(account),
        accounts.token(account),
        accounts.token(account),
      ]),
      ['mc-token', 'mc-token', 'mc-token'],
    );
    assert.equal(refreshes, 1);
    assert.equal(
      JSON.parse(values.get('minecraftWorkbench.account.id')!).refreshToken,
      'refresh-2',
    );
    assert.ok(!JSON.stringify(store.state).includes('mc-token'));
    await accounts.remove(account);
    assert.equal(values.size, 0);
    assert.equal(store.state.accounts.length, 0);
    await accounts.offline('TestPlayer');
    assert.equal(await accounts.token(store.state.accounts[0]), '0');
    assert.equal(values.size, 0);
  } finally {
    accounts.dispose();
    (vscode.workspace as unknown as { getConfiguration: unknown }).getConfiguration = original;
    await fs.rm(root, { recursive: true, force: true });
  }
});
