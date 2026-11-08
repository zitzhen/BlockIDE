/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface WixProductOptions {
	/** Directory that contains the staged client (the payload). */
	readonly sourceDir: string;
	readonly productName: string;
	readonly manufacturer: string;
	readonly version: string;
	readonly executableName: string;
	readonly iconPath: string;
	readonly aboutUrl: string;
}

interface DirectoryNode {
	readonly id: string;
	readonly name: string;
	/** Directory path relative to the payload root, using `/` separators. */
	readonly relativePath: string;
	readonly children: DirectoryNode[];
	readonly files: string[];
}

/** MSI only supports a `major.minor.build` product version. */
export function normalizeMsiVersion(version: string): string {
	const numeric = version.replace(/^[^\d]*/, '').split('-')[0];
	const parts = numeric.split('.').filter(part => /^\d+$/.test(part)).slice(0, 3);

	while (parts.length < 3) {
		parts.push('0');
	}

	return parts.join('.');
}

/** Stable component GUIDs keep major upgrades from treating files as new components. */
function guidFromKey(key: string): string {
	const hash = crypto.createHash('md5').update(`blockide:${key}`).digest('hex');

	return `{${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}}`.toUpperCase();
}

function idFromKey(prefix: string, key: string): string {
	return prefix + crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function toWindowsPath(value: string): string {
	return value.split('/').join('\\');
}

function readDirectoryTree(root: string, relativePath: string): DirectoryNode {
	const absolutePath = relativePath ? path.join(root, ...relativePath.split('/')) : root;
	const node: DirectoryNode = {
		id: relativePath ? idFromKey('d_', relativePath) : 'INSTALLFOLDER',
		name: path.basename(absolutePath),
		relativePath,
		children: [],
		files: []
	};

	for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
		const childRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

		if (entry.isDirectory()) {
			node.children.push(readDirectoryTree(root, childRelativePath));
		} else if (entry.isFile()) {
			node.files.push(entry.name);
		}
	}

	return node;
}

function renderDirectories(node: DirectoryNode, depth: number): string[] {
	const indent = '\t'.repeat(depth);
	const lines: string[] = [];

	for (const child of node.children) {
		lines.push(`${indent}<Directory Id="${child.id}" Name="${escapeXml(child.name)}">`);
		lines.push(...renderDirectories(child, depth + 1));
		lines.push(`${indent}</Directory>`);
	}

	return lines;
}

function renderComponentGroups(node: DirectoryNode): string[] {
	const lines: string[] = [];

	if (node.files.length > 0) {
		const groupId = idFromKey('cg_', node.relativePath);

		lines.push('\t<Fragment>');
		lines.push(`\t\t<ComponentGroup Id="${groupId}" Directory="${node.id}">`);

		node.files.forEach((file, index) => {
			const fileRelativePath = node.relativePath ? `${node.relativePath}/${file}` : file;
			const componentId = idFromKey('c_', fileRelativePath);
			const fileId = idFromKey('f_', fileRelativePath);

			lines.push(`\t\t\t<Component Id="${componentId}" Guid="${guidFromKey(fileRelativePath)}">`);

			if (index === 0 && node.relativePath) {
				lines.push(`\t\t\t\t<RemoveFolder Id="${idFromKey('rf_', node.relativePath)}" On="uninstall" />`);
			}

			lines.push(`\t\t\t\t<File Id="${fileId}" Source="$(var.SourceDir)\\${escapeXml(toWindowsPath(fileRelativePath))}" KeyPath="yes" />`);
			lines.push('\t\t\t</Component>');
		});

		lines.push('\t\t</ComponentGroup>');
		lines.push('\t</Fragment>');
		lines.push('');
	}

	for (const child of node.children) {
		lines.push(...renderComponentGroups(child));
	}

	return lines;
}

function collectComponentGroupIds(node: DirectoryNode, result: string[] = []): string[] {
	if (node.files.length > 0) {
		result.push(idFromKey('cg_', node.relativePath));
	}

	for (const child of node.children) {
		collectComponentGroupIds(child, result);
	}

	return result;
}

export function generateWixSource(options: WixProductOptions): string {
	const tree = readDirectoryTree(options.sourceDir, '');
	const componentGroupRefs = collectComponentGroupIds(tree)
		.map(id => `\t\t\t<ComponentGroupRef Id="${id}" />`)
		.join('\n');
	const directoryLines = renderDirectories(tree, 4).join('\n');
	const componentLines = renderComponentGroups(tree).join('\n');

	return `<?xml version="1.0" encoding="utf-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
	<Product Id="*" Name="${escapeXml(options.productName)}" Language="1033" Version="${normalizeMsiVersion(options.version)}" Manufacturer="${escapeXml(options.manufacturer)}" UpgradeCode="{2F8E3D2A-7C4B-4A61-9C1D-5C6A9F2B8E31}">
		<Package InstallerVersion="500" Compressed="yes" InstallScope="perMachine" Description="${escapeXml(options.productName)} installer" />
		<MajorUpgrade AllowSameVersionUpgrades="yes" DowngradeErrorMessage="A newer version of ${escapeXml(options.productName)} is already installed." />
		<MediaTemplate EmbedCab="yes" />
		<Icon Id="AppIcon" SourceFile="$(var.IconPath)" />
		<Property Id="ARPPRODUCTICON" Value="AppIcon" />
		<Property Id="ARPURLINFOABOUT" Value="${escapeXml(options.aboutUrl)}" />
		<Property Id="ARPNOMODIFY" Value="1" />
		<Directory Id="TARGETDIR" Name="SourceDir">
			<Directory Id="ProgramFiles64Folder">
				<Directory Id="INSTALLFOLDER" Name="${escapeXml(options.productName)}">
${directoryLines}
				</Directory>
			</Directory>
			<Directory Id="ProgramMenuFolder">
				<Directory Id="ApplicationProgramsFolder" Name="${escapeXml(options.productName)}" />
			</Directory>
		</Directory>
		<DirectoryRef Id="INSTALLFOLDER">
			<Component Id="CleanupInstallFolder" Guid="{79C2E5A4-3B7D-4E6C-9F10-8A2B4D6E1C35}">
				<RemoveFolder Id="RemoveInstallFolder" On="uninstall" />
				<RegistryValue Root="HKLM" Key="Software\\${escapeXml(options.productName)}" Name="InstallFolder" Type="integer" Value="1" KeyPath="yes" />
			</Component>
			<Component Id="AppPaths" Guid="{A51B7C2D-9E4F-4B83-8D61-3C5E7F9A2B14}">
				<RegistryKey Root="HKLM" Key="SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${escapeXml(options.executableName)}">
					<RegistryValue Type="string" Value="[INSTALLFOLDER]${escapeXml(options.executableName)}" KeyPath="yes" />
					<RegistryValue Name="Path" Type="string" Value="[INSTALLFOLDER]bin" />
				</RegistryKey>
			</Component>
			<Component Id="PathEnvironment" Guid="{C62D8E3F-1A5B-4C74-9E28-6B4F0D2A8C39}">
				<Environment Id="PathEnvironmentEntry" Name="PATH" Value="[INSTALLFOLDER]bin" Permanent="no" Part="last" Action="set" System="yes" />
				<RegistryValue Root="HKLM" Key="Software\\${escapeXml(options.productName)}" Name="PathEnvironment" Type="integer" Value="1" KeyPath="yes" />
			</Component>
		</DirectoryRef>
		<DirectoryRef Id="ApplicationProgramsFolder">
			<Component Id="ApplicationShortcut" Guid="{E83F1A6B-2C7D-4E59-8B04-7D1F3A5C9E62}">
				<Shortcut Id="ApplicationStartMenuShortcut" Name="${escapeXml(options.productName)}" Description="${escapeXml(options.productName)}" Target="[INSTALLFOLDER]${escapeXml(options.executableName)}" WorkingDirectory="INSTALLFOLDER" />
				<RemoveFolder Id="RemoveApplicationProgramsFolder" On="uninstall" />
				<RegistryValue Root="HKLM" Key="Software\\${escapeXml(options.productName)}" Name="StartMenuShortcut" Type="integer" Value="1" KeyPath="yes" />
			</Component>
		</DirectoryRef>
		<Feature Id="MainFeature" Title="${escapeXml(options.productName)}" Level="1" Display="expand">
${componentGroupRefs}
			<ComponentRef Id="CleanupInstallFolder" />
			<ComponentRef Id="AppPaths" />
			<ComponentRef Id="PathEnvironment" />
			<ComponentRef Id="ApplicationShortcut" />
		</Feature>
	</Product>
${componentLines}</Wix>
`;
}
