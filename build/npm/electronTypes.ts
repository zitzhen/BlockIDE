/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';
import { download, sha256 } from '../lib/download.ts';
import { getElectronVersion } from '../lib/electronVersion.ts';
import { root } from './installStateHash.ts';

const electronTypesPath = path.join(root, '.build', 'typings', 'electron.d.ts');

function getExpectedChecksum(): string {
	const checksumFile = fs.readFileSync(path.join(root, 'build', 'checksums', 'electron.txt'), 'utf8');
	const checksum = /^(?<checksum>[a-f0-9]{64}) \*electron\.d\.ts$/m.exec(checksumFile)?.groups?.checksum;
	if (!checksum) {
		throw new Error('Electron checksum manifest does not contain electron.d.ts');
	}
	return checksum;
}

export async function ensureElectronTypes(): Promise<void> {
	const expectedChecksum = getExpectedChecksum();
	if (fs.existsSync(electronTypesPath) && sha256(fs.readFileSync(electronTypesPath)) === expectedChecksum) {
		return;
	}

	const { electronVersion } = getElectronVersion();

	// GitHub Releases 偶发 504，依次尝试多个镜像；所有镜像都会校验 SHA-256，
	// 与 build/checksums/electron.txt 比对，保证内容一致。
	const urls = [
		`https://github.com/electron/electron/releases/download/v${electronVersion}/electron.d.ts`,
		`https://registry.npmmirror.com/-/binary/electron/v${electronVersion}/electron.d.ts`,
		`https://npmmirror.com/mirrors/electron/v${electronVersion}/electron.d.ts`
	];

	let contents: Uint8Array | undefined;
	let lastError: Error | undefined;
	for (const url of urls) {
		try {
			contents = await download(url, {
				checksumSha256: expectedChecksum,
				attempts: 3,
				retryDelay: 2000,
				timeout: 60_000,
				onRetry: error => console.warn(`Retrying ${url}: ${error.message}`)
			});
			break;
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));
			console.warn(`Mirror failed, trying next: ${url}`);
		}
	}
	if (!contents) {
		throw lastError ?? new Error('Failed to download electron.d.ts from all mirrors');
	}

	fs.mkdirSync(path.dirname(electronTypesPath), { recursive: true });
	fs.writeFileSync(electronTypesPath, contents);
}

if (import.meta.main) {
	ensureElectronTypes().catch(error => {
		console.error(error);
		process.exit(1);
	});
}
