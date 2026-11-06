/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { suite, test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { load } from 'js-yaml';
import * as ts from 'typescript';
import { detectAgentHostE2EChanges } from '../../../.github/actions/detect-agent-host-e2e-changes/detect.ts';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const profilePath = path.join(repositoryRoot, 'src/vs/platform/agentHost/test/node/agentHostTestProfile.ts');

async function detect(files: readonly { filename: string; previous_filename?: string; status?: string; patch?: string }[], expectedCount = files.length, failure?: Error) {
	const outputs: Record<string, string> = {};
	const messages: string[] = [];
	await detectAgentHostE2EChanges({
		paginate: async (_method, parameters) => {
			assert.equal(parameters.per_page, 100);
			if (failure) {
				throw failure;
			}
			return files;
		},
		rest: { pulls: { listFiles: {} } },
	}, {
		repo: { owner: 'microsoft', repo: 'vscode' },
		issue: { number: 1 },
		payload: { pull_request: { changed_files: expectedCount } },
	}, {
		info: message => messages.push(message),
		warning: message => messages.push(message),
		setOutput: (name, value) => outputs[name] = value,
	});
	return { outputs, messages };
}

suite('Agent Host PR test selection', () => {
	test('keeps unrelated changes out of the parallel runner and relevant changes in the PR profile', async () => {
		const results = [];
		for (const filename of [
			'src/vs/workbench/browser/editor.ts',
			'README.md',
			'build/azure-pipelines/product-build.yml',
			'.vscode/settings.json',
			'.vscode/extensions/vscode-extras/package.json',
			'.vscode/extensions/vscode-selfhost-test-provider/package-lock.json',
			'test/sanity/package.json',
			'.eslint-plugin-local/package.json',
			'src/vs/platform/agentHost/node/copilot/copilotAgent.ts',
			'src/vs/base/common/async.ts',
		]) {
			const { outputs } = await detect([{ filename }]);
			results.push({ affected: outputs.affected, profile: outputs.profile });
		}
		assert.deepStrictEqual(results, [
			{ affected: 'false', profile: 'pr' },
			{ affected: 'false', profile: 'pr' },
			{ affected: 'false', profile: 'pr' },
			{ affected: 'false', profile: 'pr' },
			{ affected: 'false', profile: 'pr' },
			{ affected: 'false', profile: 'pr' },
			{ affected: 'false', profile: 'pr' },
			{ affected: 'false', profile: 'pr' },
			{ affected: 'true', profile: 'pr' },
			{ affected: 'true', profile: 'pr' },
		]);
	});

	test('test artifacts, dependencies and infrastructure force full coverage in their own PR', async () => {
		const filenames = [
			'src/vs/platform/agentHost/test/node/e2e/suites/newSuite.ts',
			'src/vs/platform/agentHost/test/node/e2e/captures/new.yaml',
			'src/vs/platform/agentHost/test/node/e2e/providers/__snapshots__/new.prompt.md',
			'src/vs/platform/agentHost/test/node/providerIntegration/copilotOtel.integrationTest.ts',
			'src/vs/platform/agentHost/test/node/agentHostTestProfile.ts',
			'src/vs/platform/agentHost/test/common/agent.test.ts',
			'test/integration/agentHost/runner.ts',
			'test/unit/electron/index.js',
			'.github/actions/detect-agent-host-e2e-changes/detect.ts',
			'.github/workflows/pr-win32-test.yml',
			'scripts/test-agent-host-e2e.sh',
			'scripts/test-agent-host-e2e.bat',
			'scripts/test-integration.sh',
			'scripts/test-integration.bat',
			'build/agent-sdk/agents/copilot/package.json',
			'build/azure-pipelines/linux/setup-env.sh',
			'build/lib/test/agentHostTestSelection.test.ts',
			'package.json',
			'package-lock.json',
			'remote/package.json',
			'remote/package-lock.json',
			'extensions/copilot/package.json',
			'.npmrc',
			'.nvmrc',
			'product.json',
		];
		const results = [];
		for (const filename of filenames) {
			const { outputs, messages } = await detect([{ filename }]);
			results.push([outputs.affected, outputs.profile, outputs.reason.includes(filename), messages.some(message => message.includes('profile: full'))]);
		}
		assert.deepStrictEqual(results, filenames.map(() => ['true', 'full', true, true]));
	});

	test('a change that only updates the distro commit in package.json does not run Agent Host E2E', async () => {
		const { outputs } = await detect([{
			filename: 'package.json',
			status: 'modified',
			patch: [
				'@@ -1,5 +1,5 @@',
				' {',
				'   "name": "code-oss-dev",',
				'-  "distro": "2733515d0a50cde08bdfbbe4368f0f75b7828882",',
				'+  "distro": "eb93e228cf5aa5544a0eccb94616d63902d7e4e8",',
				'   "author": {',
			].join('\n'),
		}]);
		assert.deepStrictEqual({ affected: outputs.affected, profile: outputs.profile }, { affected: 'false', profile: 'pr' });
	});

	test('both sides of a rename participate in selection', async () => {
		const results = [];
		for (const file of [
			{ filename: 'archive/old.yaml', previous_filename: 'src/vs/platform/agentHost/test/node/e2e/captures/old.yaml' },
			{ filename: 'src/vs/platform/agentHost/test/node/e2e/captures/new.yaml', previous_filename: 'archive/new.yaml' },
			{ filename: 'archive/agent.ts', previous_filename: 'src/vs/platform/agentHost/node/agent.ts' },
		]) {
			const { outputs } = await detect([file]);
			results.push([outputs.affected, outputs.profile]);
		}
		assert.deepStrictEqual(results, [['true', 'full'], ['true', 'full'], ['true', 'pr']]);
	});

	test('failed and incomplete changed-file lookups fall back to full coverage', async () => {
		const results = await Promise.all([
			detect([], 1),
			detect([], 0, new Error('lookup unavailable')),
		]);
		assert.deepStrictEqual(results.map(({ outputs, messages }) => ({
			affected: outputs.affected,
			profile: outputs.profile,
			hasReason: outputs.reason.length > 0,
			fullWasReported: messages.some(message => message.includes('full Agent Host test profile')),
		})), [
			{ affected: 'true', profile: 'full', hasReason: true, fullWasReported: true },
			{ affected: 'true', profile: 'full', hasReason: true, fullWasReported: true },
		]);
	});

	test('PR smoke-only workflows skip Agent Host E2E', () => {
		const pr = load(readFileSync(path.join(repositoryRoot, '.github/workflows/pr.yml'), 'utf8')) as {
			jobs: Record<string, { steps?: { uses?: string }[]; with?: Record<string, unknown> }>;
		};
		assert.deepStrictEqual({
			detectsAgentHostChanges: pr.jobs.changes.steps?.some(step => step.uses === './.github/actions/detect-agent-host-e2e-changes'),
			platformInputs: [
				pr.jobs['linux-tests'].with?.agent_host_e2e_affected,
				pr.jobs['macos-tests'].with?.agent_host_e2e_tests,
				pr.jobs['windows-tests'].with?.agent_host_e2e_affected,
			],
		}, {
			detectsAgentHostChanges: false,
			platformInputs: [false, false, false],
		});
	});

	test('the Agent Host E2E runner covers exactly the files excluded by integration scripts', () => {
		const e2eDirectory = 'src/vs/platform/agentHost/test/node/e2e';
		const shellGlob = readFileSync(path.join(repositoryRoot, 'scripts/test-integration.sh'), 'utf8').match(/^AGENT_HOST_E2E_GLOB="(?<glob>[^"]+)"$/m)?.groups?.glob;
		const batchGlob = readFileSync(path.join(repositoryRoot, 'scripts/test-integration.bat'), 'utf8').match(/--excludeRunGlob "(?<glob>[^"]+)"/)?.groups?.glob;
		assert.ok(shellGlob);
		// The scripts match compiled output, so test the compiled path of every E2E source file.
		const excluded = readdirSync(path.join(repositoryRoot, e2eDirectory), { recursive: true, encoding: 'utf8' })
			.map(file => path.posix.join(e2eDirectory, file.split(path.sep).join('/')))
			.filter(file => file.endsWith('.integrationTest.ts') && path.matchesGlob(file.replace(/^src\//, 'out/').replace(/\.ts$/, '.js'), shellGlob))
			.sort();
		const runnerFiles = [...readFileSync(path.join(repositoryRoot, 'test/integration/agentHost/runner.ts'), 'utf8').matchAll(/^\t\tfile: '(?<file>[^']+)',$/gm)]
			.map(match => match.groups!.file)
			.sort();
		assert.deepStrictEqual({ batchGlob, excludedFromIntegrationScripts: excluded, runByAgentHostE2E: runnerFiles }, {
			batchGlob: shellGlob,
			excludedFromIntegrationScripts: runnerFiles,
			runByAgentHostE2E: [
				`${e2eDirectory}/conformance/agentHostConformance.integrationTest.ts`,
				`${e2eDirectory}/providers/claudeAgentHostE2E.integrationTest.ts`,
				`${e2eDirectory}/providers/codexAgentHostE2E.integrationTest.ts`,
				`${e2eDirectory}/providers/copilotAgentHostE2E.integrationTest.ts`,
				`${e2eDirectory}/providers/copilotManagedSettingsAgentHostE2E.integrationTest.ts`,
				`${e2eDirectory}/providers/copilotOtelAgentHostE2E.integrationTest.ts`,
			],
		});
	});

	test('every CI step that runs the integration tests is paired with an Agent Host E2E step', () => {
		interface ICommandStep {
			readonly command: string;
			readonly environment: Record<string, unknown>;
		}
		// Finds steps in any GitHub Actions or Azure DevOps shape, including template parameters and expression branches.
		// Steps that jobs share through a YAML alias are the same object, and count once.
		const commandSteps = (value: unknown, found: ICommandStep[] = [], visited = new Set<object>()): ICommandStep[] => {
			if (value && typeof value === 'object') {
				if (visited.has(value)) {
					return found;
				}
				visited.add(value);
			}
			if (Array.isArray(value)) {
				value.forEach(item => commandSteps(item, found, visited));
			} else if (value && typeof value === 'object') {
				const record = value as Record<string, unknown>;
				const command = ['run', 'script', 'powershell', 'pwsh', 'bash'].map(key => record[key]).find(entry => typeof entry === 'string');
				if (typeof command === 'string') {
					found.push({ command, environment: (record.env ?? {}) as Record<string, unknown> });
				}
				Object.values(record).forEach(child => commandSteps(child, found, visited));
			}
			return found;
		};
		const pipelineFiles = (directory: string): string[] => readdirSync(path.join(repositoryRoot, directory), { recursive: true, encoding: 'utf8' })
			.filter(file => /\.ya?ml$/.test(file))
			.map(file => path.posix.join(directory, file.split(path.sep).join('/')));
		// The extension host tests do not run any Agent Host E2E entrypoints.
		const unitRun = /test-(integration|agent-host-e2e)\.(sh|bat)\b(?![^\n]*--(run|runGlob|suite|only-extension-host-tests)\b)/;
		const pairs = [...pipelineFiles('.github/workflows'), ...pipelineFiles('build/azure-pipelines')].sort().flatMap(file => {
			const steps = commandSteps(load(readFileSync(path.join(repositoryRoot, file), 'utf8')));
			const integration = steps.filter(step => unitRun.test(step.command) && step.command.includes('test-integration.'));
			const agentHost = steps.filter(step => unitRun.test(step.command) && step.command.includes('test-agent-host-e2e.'));
			if (integration.length === 0 && agentHost.length === 0) {
				return [];
			}
			// The change-detection skip only applies to the Agent Host E2E step, and only Agent Host E2E runs in
			// shards. Where the integration tests run in parts, the node.js part is the one that excludes the
			// Agent Host E2E entrypoints.
			const signature = (step: ICommandStep) => JSON.stringify({
				command: step.command.replace('test-agent-host-e2e.', 'test-integration.').replace(' --only-node-tests', '').replace(/\$\{\{ env\.AGENT_HOST_E2E_SHARD_.*? \}\}/g, ''),
				environment: Object.fromEntries(Object.entries(step.environment).filter(([name]) => name !== 'VSCODE_SKIP_AGENT_HOST_E2E').sort()),
			});
			const agentHostSignatures = agentHost.map(signature).sort();
			return [{
				file,
				integrationSteps: integration.length,
				pairedWithAgentHostE2E: JSON.stringify(integration.map(signature).sort()) === JSON.stringify(agentHostSignatures),
			}];
		});
		assert.deepStrictEqual(pairs, [
			'.github/workflows/pr-darwin-test.yml',
			'.github/workflows/pr-linux-test.yml',
			'.github/workflows/pr-win32-test.yml',
			'build/azure-pipelines/darwin/product-smoke-flaky-darwin.yml',
			'build/azure-pipelines/darwin/steps/product-build-darwin-test.yml',
			'build/azure-pipelines/linux/product-smoke-flaky-linux.yml',
			'build/azure-pipelines/linux/steps/product-build-linux-test.yml',
			'build/azure-pipelines/win32/product-smoke-flaky-win32.yml',
			'build/azure-pipelines/win32/steps/product-build-win32-test.yml',
		].map(file => ({ file, integrationSteps: 1, pairedWithAgentHostE2E: true })));
	});
});

suite('Agent Host test profile registration', () => {
	test('defaults to full and rejects unknown profile values', () => {
		const { getAgentHostTestProfile } = profile(undefined);
		assert.deepStrictEqual([getAgentHostTestProfile(), getAgentHostTestProfile('full'), getAgentHostTestProfile('pr')], ['full', 'full', 'pr']);
		for (const value of ['', 'quick', 'FULL']) {
			assert.throws(() => getAgentHostTestProfile(value), /Invalid AGENT_HOST_TEST_PROFILE/);
		}
	});

	test('full-only registration preserves titles and honors capability gates in both profiles', () => {
		const results = [];
		for (const value of [undefined, 'full', 'pr']) {
			const { fullOnlyTest, registrations } = profile(value);
			for (const enabled of [true, false]) {
				fullOnlyTest('fixture identity stays unchanged', () => { }, enabled);
			}
			results.push(registrations);
		}
		assert.deepStrictEqual(results, [
			[{ title: 'fixture identity stays unchanged', skipped: false }, { title: 'fixture identity stays unchanged', skipped: true }],
			[{ title: 'fixture identity stays unchanged', skipped: false }, { title: 'fixture identity stays unchanged', skipped: true }],
			[{ title: 'fixture identity stays unchanged', skipped: true }, { title: 'fixture identity stays unchanged', skipped: true }],
		]);
	});

	test('the initial full-only inventory contains only the intended variations', () => {
		const titles: string[] = [];
		for (const relativePath of [
			'src/vs/platform/agentHost/test/node/e2e/suites/fileOperationsSuite.ts',
			'src/vs/platform/agentHost/test/node/e2e/suites/multiChatSuite.ts',
			'src/vs/platform/agentHost/test/node/e2e/suites/copilotCoverageSuite.ts',
			'src/vs/platform/agentHost/test/node/providerIntegration/copilotOtel.integrationTest.ts',
		]) {
			const source = ts.createSourceFile(relativePath, readFileSync(path.join(repositoryRoot, relativePath), 'utf8'), ts.ScriptTarget.Latest, true);
			const visit = (node: ts.Node): void => {
				if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
					const lastArgument = node.arguments.at(-1);
					const fullOnly = node.expression.text === 'fullOnlyTest'
						|| (lastArgument && ts.isStringLiteral(lastArgument) && lastArgument.text === 'full');
					if (fullOnly) {
						const title = node.arguments[node.expression.text === 'fileOperationTest' ? 1 : 0];
						assert.ok(title && (ts.isStringLiteral(title) || ts.isTemplateExpression(title)));
						titles.push(ts.isStringLiteral(title) ? title.text : title.head.text);
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(source);
		}
		assert.deepStrictEqual(titles.sort(), [
			'reads a file from a nested directory',
			'reads a value from JSON',
			'counts lines in a file',
			'lists workspace entries',
			'inspects git status',
			'peer chat reads a file from a nested directory',
			'peer chat creates a file in a nested directory',
			'view range returns only the requested workspace lines',
			'grep searches workspace content through the provider tool',
			'glob finds a nested workspace file through the provider tool',
			'shell tools and concurrent session events complete with OTel ',
		].sort());
	});
});

function profile(value: string | undefined) {
	const registrations: { title: string; skipped: boolean }[] = [];
	const register = (title: string) => registrations.push({ title, skipped: false });
	const exports = {} as {
		getAgentHostTestProfile(value?: string): 'pr' | 'full';
		fullOnlyTest(title: string, run: () => void, enabled?: boolean): void;
	};
	const source = ts.transpileModule(readFileSync(profilePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
	runInNewContext(source, {
		exports,
		process: { env: value === undefined ? {} : { AGENT_HOST_TEST_PROFILE: value } },
		test: Object.assign(register, { skip: (title: string) => registrations.push({ title, skipped: true }) }),
	}, { filename: profilePath });
	return { ...exports, registrations };
}
