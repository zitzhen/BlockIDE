/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import { gulp } from './lib/gulp/facade.ts';
import * as path from 'path';
import rcedit from 'rcedit';
import vfs from 'vinyl-fs';
import pkg from '../package.json' with { type: 'json' };
import product from '../product.json' with { type: 'json' };
import { getVersion } from './lib/getVersion.ts';
import * as task from './lib/gulp/task.ts';
import * as util from './lib/util.ts';
import { prepareManagedPayload } from './win32/managedPayload.ts';
import { generateWixSource, normalizeMsiVersion } from './win32/msi/generateWix.ts';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const repoPath = path.dirname(import.meta.dirname);
const commit = getVersion(repoPath);
const buildPath = (arch: string) => path.join(path.dirname(repoPath), `VSCode-win32-${arch}`);
const setupDir = (arch: string, target: string) => path.join(repoPath, '.build', `win32-${arch}`, `${target}-setup`);
const innoSetupPath = path.join(path.dirname(path.dirname(require.resolve('innosetup'))), 'bin', 'ISCC.exe');
const signWin32Path = path.join(repoPath, 'build', 'azure-pipelines', 'common', 'sign-win32.ts');

function packageInnoSetup(iss: string, options: { definitions?: Record<string, unknown> }, cb: (err?: Error | null) => void) {
	const definitions = options.definitions || {};

	if (process.argv.some(arg => arg === '--debug-inno')) {
		definitions['Debug'] = 'true';
	}

	if (process.argv.some(arg => arg === '--sign')) {
		definitions['Sign'] = 'true';
	}

	const keys = Object.keys(definitions);

	keys.forEach(key => assert(typeof definitions[key] === 'string', `Missing value for '${key}' in Inno Setup package step`));

	const defs = keys.map(key => `/d${key}=${definitions[key]}`);
	const args = [
		iss,
		...defs,
		`/sesrp=node ${signWin32Path} $f`
	];

	cp.spawn(innoSetupPath, args, { stdio: ['ignore', 'inherit', 'inherit'] })
		.on('error', cb)
		.on('exit', code => {
			if (code === 0) {
				cb(null);
			} else {
				cb(new Error(`InnoSetup returned exit code: ${code}`));
			}
		});
}

function buildWin32Setup(arch: string, target: string): task.CallbackTask {
	if (target !== 'system' && target !== 'user') {
		throw new Error('Invalid setup target');
	}

	return (cb) => {
		const x64AppId = target === 'system' ? product.win32x64AppId : product.win32x64UserAppId;
		const arm64AppId = target === 'system' ? product.win32arm64AppId : product.win32arm64UserAppId;

		const sourcePath = buildPath(arch);
		const outputPath = setupDir(arch, target);
		fs.mkdirSync(outputPath, { recursive: true });

		const quality = (product as typeof product & { quality?: string }).quality || 'dev';
		const useVersionedUpdate = (product as typeof product & { win32VersionedUpdate?: boolean })?.win32VersionedUpdate;
		const versionedResourcesFolder = useVersionedUpdate ? commit!.substring(0, 10) : '';
		const issPath = path.join(import.meta.dirname, 'win32', 'code.iss');
		const productJsonRelativePath = path.join(versionedResourcesFolder, 'resources/app/product.json');
		const originalProductJsonPath = path.join(sourcePath, productJsonRelativePath);
		const productJsonPath = path.join(outputPath, 'product.json');
		const productJson = JSON.parse(fs.readFileSync(originalProductJsonPath, 'utf8'));
		productJson['target'] = target;

		const definitions: Record<string, unknown> = {
			NameLong: product.nameLong,
			NameShort: product.nameShort,
			DirName: product.win32DirName,
			Version: pkg.version,
			RawVersion: pkg.version.replace(/-\w+$/, ''),
			Commit: commit,
			NameVersion: product.win32NameVersion + (target === 'user' ? ' (User)' : ''),
			ExeBasename: product.nameShort,
			RegValueName: product.win32RegValueName,
			ShellNameShort: product.win32ShellNameShort,
			AppMutex: product.win32MutexName,
			TunnelMutex: product.win32TunnelMutex,
			TunnelServiceMutex: product.win32TunnelServiceMutex,
			TunnelApplicationName: product.tunnelApplicationName,
			ApplicationName: product.applicationName,
			Arch: arch,
			AppId: { 'x64': x64AppId, 'arm64': arm64AppId }[arch],
			IncompatibleTargetAppId: { 'x64': product.win32x64AppId, 'arm64': product.win32arm64AppId }[arch],
			AppUserId: product.win32AppUserModelId,
			ArchitecturesAllowed: { 'x64': 'x64', 'arm64': 'arm64' }[arch],
			ArchitecturesInstallIn64BitMode: { 'x64': 'x64', 'arm64': 'arm64' }[arch],
			SourceDir: sourcePath,
			RepoDir: repoPath,
			OutputDir: outputPath,
			InstallTarget: target,
			ProductJsonRelativePath: productJsonRelativePath,
			ProductJsonPath: productJsonPath,
			VersionedResourcesFolder: versionedResourcesFolder,
			Quality: quality
		};

		if (quality === 'stable' || quality === 'insider') {
			definitions['AppxPackage'] = `${quality === 'stable' ? 'code' : 'code_insider'}_${arch}.appx`;
			definitions['AppxPackageDll'] = `${quality === 'stable' ? 'code' : 'code_insider'}_explorer_command_${arch}.dll`;
			definitions['AppxPackageName'] = `${product.win32AppUserModelId}`;
			const ctxMenu = (product as { win32ContextMenu?: Record<string, { clsid: string }> }).win32ContextMenu;
			if (ctxMenu && ctxMenu[arch]) {
				definitions['FileExplorerContextMenuCLSID'] = ctxMenu[arch].clsid;
			}
		}

		if (fs.existsSync(path.join(sourcePath, 'bin', 'copilot-shim', 'copilot.exe'))) {
			definitions['CopilotShim'] = 'true';
			if (fs.existsSync(path.join(sourcePath, 'bin', 'copilot-shim', 'copilot'))) {
				definitions['CopilotShimLauncher'] = 'true';
			}
		}

		fs.writeFileSync(productJsonPath, JSON.stringify(productJson, undefined, '\t'));

		packageInnoSetup(issPath, { definitions }, cb as (err?: Error | null) => void);
	};
}

function defineWin32SetupTasks(arch: string, target: string) {
	const cleanTask = util.rimraf(setupDir(arch, target));
	task.task(task.define(`vscode-win32-${arch}-${target}-setup`, task.series(cleanTask, buildWin32Setup(arch, target))));
}

defineWin32SetupTasks('x64', 'system');
defineWin32SetupTasks('arm64', 'system');
defineWin32SetupTasks('x64', 'user');
defineWin32SetupTasks('arm64', 'user');

function copyInnoUpdater(arch: string) {
	return () => {
		return gulp.src('build/win32/{inno_updater.exe,vcruntime140.dll}', { base: 'build/win32' })
			.pipe(vfs.dest(path.join(buildPath(arch), 'tools')));
	};
}

function updateIcon(executablePath: string): task.CallbackTask {
	return cb => {
		const icon = path.join(repoPath, 'resources', 'win32', 'code.ico');
		rcedit(executablePath, { icon }, cb);
	};
}

task.task(task.define('vscode-win32-x64-inno-updater', task.series(copyInnoUpdater('x64'), updateIcon(path.join(buildPath('x64'), 'tools', 'inno_updater.exe')))));
task.task(task.define('vscode-win32-arm64-inno-updater', task.series(copyInnoUpdater('arm64'), updateIcon(path.join(buildPath('arm64'), 'tools', 'inno_updater.exe')))));

const managedPackageDir = (arch: string, kind: 'msi' | 'msix') => path.join(repoPath, '.build', `win32-${arch}`, kind);
const iconPath = path.join(repoPath, 'resources', 'win32', 'code.ico');
const aboutUrl = 'https://github.com/zitzhen/BlockIDE';

function getVersionedResourcesFolder(): string {
	const useVersionedUpdate = (product as typeof product & { win32VersionedUpdate?: boolean }).win32VersionedUpdate;
	return useVersionedUpdate ? commit!.substring(0, 10) : '';
}

function spawnTool(executable: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		cp.spawn(executable, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
			.on('error', reject)
			.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} exited with code: ${code}`)));
	});
}

function findWixTool(name: string): string {
	const directories = [
		process.env['WIX_BIN'],
		'C:\\Program Files (x86)\\WiX Toolset v3.14\\bin',
		'C:\\Program Files (x86)\\WiX Toolset v3.11\\bin'
	].filter((directory): directory is string => !!directory);

	for (const directory of directories) {
		const tool = path.join(directory, name);
		if (fs.existsSync(tool)) {
			return tool;
		}
	}

	return name;
}

function findWindowsSdkTool(name: string, arch: string, overrideEnvironmentVariable: string): string {
	const override = process.env[overrideEnvironmentVariable];
	if (override) {
		return override;
	}

	const sdkBinRoot = 'C:\\Program Files (x86)\\Windows Kits\\10\\bin';
	if (fs.existsSync(sdkBinRoot)) {
		const versions = fs.readdirSync(sdkBinRoot)
			.filter(version => /^\d+\.\d+\.\d+\.\d+$/.test(version))
			.sort()
			.reverse();

		for (const version of versions) {
			const tool = path.join(sdkBinRoot, version, arch, name);
			if (fs.existsSync(tool)) {
				return tool;
			}
		}
	}

	return name;
}

function normalizeMsixVersion(version: string): string {
	const parts = version.split('-')[0].split('.').filter(part => /^\d+$/.test(part)).slice(0, 4);

	while (parts.length < 4) {
		parts.push('0');
	}

	return parts.map(part => Math.min(parseInt(part, 10), 65535)).join('.');
}

function buildWin32Msi(arch: string): task.CallbackTask {
	return cb => {
		void (async () => {
			if (process.platform !== 'win32') {
				throw new Error('MSI packaging is only supported on Windows');
			}

			const sourcePath = buildPath(arch);
			if (!fs.existsSync(sourcePath)) {
				throw new Error(`Missing built client: ${sourcePath}`);
			}

			const outputPath = managedPackageDir(arch, 'msi');
			const payloadPath = path.join(outputPath, 'payload');
			fs.mkdirSync(outputPath, { recursive: true });
			prepareManagedPayload(sourcePath, payloadPath, getVersionedResourcesFolder());

			const wxsPath = path.join(outputPath, 'Product.generated.wxs');
			fs.writeFileSync(wxsPath, generateWixSource({
				sourceDir: payloadPath,
				productName: product.nameLong,
				manufacturer: product.nameLong,
				version: pkg.version,
				executableName: `${product.nameShort}.exe`,
				iconPath,
				aboutUrl
			}), 'utf8');

			const wixArch = { 'x64': 'x64', 'arm64': 'arm64' }[arch];
			if (!wixArch) {
				throw new Error(`Unsupported architecture: ${arch}`);
			}

			const wixobjPath = path.join(outputPath, 'Product.wixobj');
			await spawnTool(findWixTool('candle.exe'), [
				wxsPath,
				'-arch', wixArch,
				`-dSourceDir=${payloadPath}`,
				`-dIconPath=${iconPath}`,
				'-o', wixobjPath
			], outputPath);

			await spawnTool(findWixTool('light.exe'), [
				wixobjPath,
				'-o', path.join(outputPath, `${product.nameShort}-${normalizeMsiVersion(pkg.version)}-${arch}.msi`)
			], outputPath);
		})().then(() => cb?.(), err => cb?.(err instanceof Error ? err : new Error(String(err))));
	};
}

task.task(task.define('vscode-win32-x64-msi', buildWin32Msi('x64')));
task.task(task.define('vscode-win32-arm64-msi', buildWin32Msi('arm64')));

function buildWin32Msix(arch: string): task.CallbackTask {
	return cb => {
		void (async () => {
			if (process.platform !== 'win32') {
				throw new Error('MSIX packaging is only supported on Windows');
			}

			const sourcePath = buildPath(arch);
			if (!fs.existsSync(sourcePath)) {
				throw new Error(`Missing built client: ${sourcePath}`);
			}

			const outputPath = managedPackageDir(arch, 'msix');
			const payloadPath = path.join(outputPath, 'payload');
			fs.mkdirSync(outputPath, { recursive: true });
			prepareManagedPayload(sourcePath, payloadPath, getVersionedResourcesFolder());

			const manifestTemplatePath = path.join(import.meta.dirname, 'win32', 'msix', 'AppxManifest.template.xml');
			const replacements: Record<string, string> = {
				IDENTITY: process.env['BLOCKIDE_MSIX_IDENTITY'] || product.win32AppUserModelId,
				PUBLISHER: process.env['BLOCKIDE_MSIX_PUBLISHER'] || 'CN=BlockIDE',
				PUBLISHER_DISPLAY_NAME: process.env['BLOCKIDE_MSIX_PUBLISHER_DISPLAY_NAME'] || product.nameLong,
				VERSION: normalizeMsixVersion(pkg.version),
				ARCH: arch,
				DISPLAY_NAME: product.nameLong,
				DESCRIPTION: product.nameLong,
				EXECUTABLE: `${product.nameShort}.exe`
			};
			const manifest = fs.readFileSync(manifestTemplatePath, 'utf8')
				.replace(/@@([A-Z0-9_]+)@@/g, (match, key: string) => {
					const replacement = replacements[key];
					if (replacement === undefined) {
						throw new Error(`Missing MSIX manifest placeholder: ${match}`);
					}
					return replacement;
				});
			fs.writeFileSync(path.join(payloadPath, 'AppxManifest.xml'), manifest, 'utf8');

			const assetsPath = path.join(payloadPath, 'Assets');
			fs.mkdirSync(assetsPath, { recursive: true });
			fs.copyFileSync(path.join(repoPath, 'resources', 'win32', 'code_150x150.png'), path.join(assetsPath, 'Square150x150Logo.png'));
			fs.copyFileSync(path.join(repoPath, 'resources', 'win32', 'code_70x70.png'), path.join(assetsPath, 'Square44x44Logo.png'));
			fs.copyFileSync(path.join(repoPath, 'resources', 'win32', 'code_150x150.png'), path.join(assetsPath, 'StoreLogo.png'));

			const msixPath = path.join(outputPath, `${product.nameShort}-${normalizeMsixVersion(pkg.version)}-${arch}.msix`);
			await spawnTool(findWindowsSdkTool('makeappx.exe', arch, 'MAKEAPPX'), [
				'pack',
				'/d', payloadPath,
				'/p', msixPath,
				'/o'
			], outputPath);

			const pfxPath = process.env['BLOCKIDE_MSIX_PFX'];
			if (pfxPath) {
				const signArgs = [
					'sign',
					'/fd', 'SHA256',
					'/f', pfxPath,
					'/tr', 'http://timestamp.digicert.com',
					'/td', 'SHA256'
				];

				const pfxPassword = process.env['BLOCKIDE_MSIX_PFX_PASSWORD'];
				if (pfxPassword) {
					signArgs.push('/p', pfxPassword);
				}

				signArgs.push(msixPath);
				await spawnTool(findWindowsSdkTool('signtool.exe', arch, 'SIGNTOOL'), signArgs, outputPath);
			}
		})().then(() => cb?.(), err => cb?.(err instanceof Error ? err : new Error(String(err))));
	};
}

task.task(task.define('vscode-win32-x64-msix', buildWin32Msix('x64')));
task.task(task.define('vscode-win32-arm64-msix', buildWin32Msix('arm64')));
