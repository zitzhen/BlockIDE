import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Developer, Template } from '../src/developer';
import { Store } from '../src/store';
import { Network } from '../src/network';
import { Java } from '../src/java';

async function main() {
  const root =
    process.env.MW_PROJECT_DATA || (await fs.mkdtemp(path.join(os.tmpdir(), 'mc-live-projects-')));
  console.log(`Test data: ${root}`);
  const store = new Store(path.join(root, 'storage'), () => {});
  const net = new Network({ proxy: '', sources: {}, concurrency: 6 });
  const java = new Java(store, net);
  await java.detect();
  const dev = new Developer(store, net, java);
  try {
    const fabric =
      (await dev.templates('fabric')).find((t) => t.minecraft === '1.21.1') ||
      (await dev.templates('fabric')).find((t) => t.minecraft === '1.21');
    const neo = (await dev.templates('neoforge')).find((t) => t.minecraft === '1.21.1');
    const forge: Template = {
      loader: 'forge',
      name: '1.21.1-52.1.20',
      minecraft: '1.21.1',
      url: 'https://maven.minecraftforge.net/net/minecraftforge/forge/1.21.1-52.1.20/forge-1.21.1-52.1.20-mdk.zip',
    };
    for (const template of [fabric, neo, forge]) {
      if (!template) throw new Error('Official template not found');
      if (
        process.env.MW_PROJECT_LOADERS &&
        !process.env.MW_PROJECT_LOADERS.split(',').includes(template.loader)
      )
        continue;
      const projectPath = path.join(root, `sample_${template.loader}`);
      const project = await fs.access(projectPath).then(
        () => dev.import(projectPath),
        () =>
          dev.create(
            template,
            {
              name: 'Sample Mod',
              modId: `sample_${template.loader}`,
              packageName: `com.example.sample_${template.loader}`,
              parent: root,
            },
            new AbortController().signal,
          ),
      );
      console.log(`Generated ${template.loader}: ${project.directory}`);
      if (process.env.MW_BUILD_PROJECTS === '1') {
        const required = await dev.requiredJava(project);
        console.log(`Build requires Java ${required}`);
        let runtime;
        try {
          runtime = await java.select(required);
        } catch {
          await java.download(required, new AbortController().signal, () => {});
          runtime = await java.select(required);
        }
        const result = await promisify(execFile)(
          runtime.path,
          [
            '-classpath',
            path.join(project.directory, 'gradle/wrapper/gradle-wrapper.jar'),
            'org.gradle.wrapper.GradleWrapperMain',
            'build',
            '--no-daemon',
            '--console=plain',
          ],
          {
            cwd: project.directory,
            timeout: 600000,
            maxBuffer: 32 * 1024 ** 2,
            env: {
              ...process.env,
              JAVA_HOME: path.dirname(path.dirname(runtime.path)),
              GRADLE_USER_HOME: path.join(root, 'gradle'),
            },
          },
        );
        console.log(result.stdout.slice(-1800));
        console.log(result.stderr.slice(-1800));
      }
    }
  } finally {
    await net.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
