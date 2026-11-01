import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Backups } from '../src/backups';
import { Instance } from '../src/models';

test('restoring worlds first preserves the current worlds and rejects links', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-backup-'));
  const instance: Instance = {
    id: 'test',
    name: 'Test',
    directory: root,
    minecraft: '1.21.1',
    loader: 'vanilla',
    createdAt: '',
  };
  const backups = new Backups();
  try {
    await fs.mkdir(path.join(root, 'saves', 'World'), { recursive: true });
    await fs.writeFile(path.join(root, 'saves', 'World', 'level.dat'), 'original');
    const first = await backups.create(instance);
    await fs.writeFile(path.join(root, 'saves', 'World', 'level.dat'), 'changed');
    await backups.restore(instance, first);
    assert.equal(
      await fs.readFile(path.join(root, 'saves', 'World', 'level.dat'), 'utf8'),
      'original',
    );
    const all = await backups.list(instance);
    assert.equal(all.length, 2);
    const current = all.find((name) => name !== first)!;
    assert.equal(
      await fs.readFile(
        path.join(backups.directory(instance), current, 'saves', 'World', 'level.dat'),
        'utf8',
      ),
      'changed',
    );
    await fs.symlink(os.tmpdir(), path.join(root, 'saves', 'World', 'link'), 'junction');
    await assert.rejects(backups.create(instance), /symbolic/i);
    await assert.rejects(backups.restore(instance, '../outside'));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
