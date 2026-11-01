import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { fabricSatisfies, readFabricMetadata } from '../src/fabric-metadata';
import { ContentService } from '../src/content';
import { Network } from '../src/network';
import { Instance, ModVersion } from '../src/models';

test('Fabric version predicates preserve bounds and array alternatives', () => {
  assert.ok(fabricSatisfies('0.6.13+mc1.21.1', '0.6.x'));
  assert.ok(!fabricSatisfies('0.8.13+mc1.21.1', '0.6.x'));
  assert.ok(fabricSatisfies('1.21.1', ['1.20.1', '1.21.x']));
  assert.ok(!fabricSatisfies('1.22.1', ['1.20.1', '1.21.x']));
  assert.ok(fabricSatisfies('0.16.10', '>=0.12.3'));
  const nested = new AdmZip();
  nested.addFile('fabric.mod.json', Buffer.from('{"id":"api-module","version":"1.2.3"}'));
  const root = new AdmZip();
  root.addFile(
    'fabric.mod.json',
    Buffer.from('{"id":"api","version":"1.0.0","jars":[{"file":"META-INF/jars/module.jar"}]}'),
  );
  root.addFile('META-INF/jars/module.jar', nested.toBuffer());
  assert.deepEqual(
    readFabricMetadata(root.toBuffer()).map((module) => module.id),
    ['api', 'api-module'],
  );
});
test('required versions obey the downloaded mod bounds and incompatible standalone upgrades are blocked', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-bounds-'));
  const payloads = new Map<string, Buffer>();
  const make = (
    id: string,
    project: string,
    version: string,
    depends: Record<string, string>,
  ): ModVersion => {
    const zip = new AdmZip();
    zip.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: project, version, depends })));
    const data = zip.toBuffer();
    const url = `https://cdn.modrinth.com/${id}.jar`;
    payloads.set(url, data);
    return {
      id,
      project_id: project,
      name: id,
      version_number: version,
      loaders: ['fabric'],
      game_versions: ['1.21.1'],
      dependencies: [],
      files: [
        {
          filename: `${id}.jar`,
          primary: true,
          url,
          size: data.length,
          hashes: { sha1: createHash('sha1').update(data).digest('hex') },
        },
      ],
    };
  };
  const iris = make('iris-v1', 'iris', '1.8.8', {
    minecraft: '1.21.x',
    fabricloader: '>=0.12.3',
    sodium: '0.6.x',
  });
  const old = make('sodium-old', 'sodium', '0.6.13', { minecraft: '1.21.x' });
  const recent = make('sodium-new', 'sodium', '0.8.13', { minecraft: '1.21.x' });
  old.version_number = 'mc1.21.1-0.6.13-fabric';
  recent.version_number = 'mc1.21.1-0.8.13-fabric';
  iris.dependencies.push({ project_id: 'sodium', dependency_type: 'required' });
  const all = [iris, old, recent];
  const net = {
    json: async (url: string) => {
      if (url.includes('/project/sodium/version')) return [recent, old];
      if (url.includes('/project/sodium')) return { id: 'sodium', slug: 'sodium' };
      const version = all.find((v) => url.includes(`/version/${v.id}`));
      if (version) return version;
      throw new Error(url);
    },
    download: async (url: string, target: string) => {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, payloads.get(url)!);
    },
  } as unknown as Network;
  const instance: Instance = {
    id: 'test',
    name: 'Test',
    minecraft: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.10',
    directory: path.join(root, 'game'),
    createdAt: '',
  };
  const service = new ContentService(net, path.join(root, 'cache'));
  try {
    const plan = await service.plan(instance, iris, 'mod');
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.entries.find((entry) => entry.required)?.version.id, old.id);
    await service.install(instance, iris, 'mod', new AbortController().signal, () => {});
    await fs.access(path.join(instance.directory, 'mods/sodium-old.jar'));
    const upgrade = await service.plan(instance, recent, 'mod');
    assert.ok(upgrade.conflicts.some((conflict) => conflict.includes('0.6.x')));
    await assert.rejects(
      service.install(instance, recent, 'mod', new AbortController().signal, () => {}),
      /0.6.x/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
