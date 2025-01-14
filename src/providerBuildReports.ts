import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as mkdirp from 'mkdirp';
import * as rimraf from 'rimraf';


namespace _ {

	function handleResult<T>(resolve: (result: T) => void, reject: (error: Error) => void, error: Error | null | undefined, result: T): void
	{
		if (error)
		{
			reject(messageError(error));
		} else
		{
			resolve(result);
		}
	}

	function messageError(error: Error & { code?: string }): Error
	{
		if (error.code === 'ENOENT')
		{
			return vscode.FileSystemError.FileNotFound();
		}

		if (error.code === 'EISDIR')
		{
			return vscode.FileSystemError.FileIsADirectory();
		}

		if (error.code === 'EEXIST')
		{
			return vscode.FileSystemError.FileExists();
		}

		if (error.code === 'EPERM' || error.code === 'EACCESS')
		{
			return vscode.FileSystemError.NoPermissions();
		}

		return error;
	}

	export function checkCancellation(token: vscode.CancellationToken): void
	{
		if (token.isCancellationRequested)
		{
			throw new Error('Operation cancelled');
		}
	}

	export function normalizeNFC(items: string): string;
	export function normalizeNFC(items: string[]): string[];
	export function normalizeNFC(items: string | string[]): string | string[]
	{
		if (process.platform !== 'darwin')
		{
			return items;
		}

		if (Array.isArray(items))
		{
			return items.map(item => item.normalize('NFC'));
		}

		return items.normalize('NFC');
	}

	export function readdir(path: string): Promise<string[]>
	{
		return new Promise<string[]>((resolve, reject) =>
		{
			fs.readdir(path, (error, children) => handleResult(resolve, reject, error, normalizeNFC(children)));
		});
	}

	export function stat(path: string): Promise<fs.Stats>
	{
		return new Promise<fs.Stats>((resolve, reject) =>
		{
			fs.stat(path, (error, stat) => handleResult(resolve, reject, error, stat));
		});
	}

	export function readfile(path: string): Promise<Buffer>
	{
		return new Promise<Buffer>((resolve, reject) =>
		{
			fs.readFile(path, (error, buffer) => handleResult(resolve, reject, error, buffer));
		});
	}

	export function writefile(path: string, content: Buffer): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			fs.writeFile(path, content, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function exists(path: string): Promise<boolean>
	{
		return new Promise<boolean>((resolve, reject) =>
		{
			fs.exists(path, exists => handleResult(resolve, reject, null, exists));
		});
	}

	export function rmrf(path: string): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			rimraf(path, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function mkdir(path: string): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			mkdirp(path, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function rename(oldPath: string, newPath: string): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			fs.rename(oldPath, newPath, error => handleResult(resolve, reject, error, void 0));
		});
	}

	export function unlink(path: string): Promise<void>
	{
		return new Promise<void>((resolve, reject) =>
		{
			fs.unlink(path, error => handleResult(resolve, reject, error, void 0));
		});
	}
}

export class FileStat implements vscode.FileStat
{
	constructor(private fsStat: fs.Stats) { }

	get type(): vscode.FileType
	{
		return this.fsStat.isFile() ? vscode.FileType.File : this.fsStat.isDirectory() ? vscode.FileType.Directory : this.fsStat.isSymbolicLink() ? vscode.FileType.SymbolicLink : vscode.FileType.Unknown;
	}

	get isFile(): boolean | undefined
	{
		return this.fsStat.isFile();
	}

	get isDirectory(): boolean | undefined
	{
		return this.fsStat.isDirectory();
	}

	get isSymbolicLink(): boolean | undefined
	{
		return this.fsStat.isSymbolicLink();
	}

	get size(): number
	{
		return this.fsStat.size;
	}

	get ctime(): number
	{
		return this.fsStat.ctime.getTime();
	}

	get mtime(): number
	{
		return this.fsStat.mtime.getTime();
	}
}

interface Entry
{
	uri: any;
	type: vscode.FileType;
}

export class ProviderBuildReports implements vscode.TreeDataProvider<Entry>, vscode.FileSystemProvider
{
    private _onDidChangeFile: vscode.EventEmitter<vscode.FileChangeEvent[]>;   
    private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
    readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;

	constructor()
	{
		this._onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    }
    
	public refresh(): any
	{
        this._onDidChangeTreeData.fire();
    }

	get onDidChangeFile(): vscode.Event<vscode.FileChangeEvent[]>
	{
		return this._onDidChangeFile.event;
	}

	watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable
	{
		const watcher = fs.watch(uri.fsPath, { recursive: options.recursive }, async (event: string, filename: string | Buffer) =>
		{
			const filepath = path.join(uri.fsPath, _.normalizeNFC(filename.toString()));

			this._onDidChangeFile.fire([{
				type: event === 'change' ? vscode.FileChangeType.Changed : await _.exists(filepath) ? vscode.FileChangeType.Created : vscode.FileChangeType.Deleted,
				uri: uri.with({ path: filepath })
			} as vscode.FileChangeEvent]);
		});

		return { dispose: () => watcher.close() };
	}

	stat(uri: vscode.Uri): vscode.FileStat | Thenable<vscode.FileStat>
	{
		return this._stat(uri.fsPath);
	}

	async _stat(path: string): Promise<vscode.FileStat>
	{
		return new FileStat(await _.stat(path));
	}

	readDirectory(uri: vscode.Uri): [string, vscode.FileType][] | Thenable<[string, vscode.FileType][]>
	{
		return this._readDirectory(uri);
	}

	async _readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]>
	{
		const children = await _.readdir(uri.fsPath);

		const result: [string, vscode.FileType][] = [];
		for (let i = 0; i < children.length; i++)
		{
			const child = children[i];
			const stat = await this._stat(path.join(uri.fsPath, child));
			result.push([child, stat.type]);
		}

		return Promise.resolve(result);
	}

	createDirectory(uri: vscode.Uri): void | Thenable<void>
	{
		return _.mkdir(uri.fsPath);
	}

	readFile(uri: vscode.Uri): Uint8Array | Thenable<Uint8Array>
	{
		return _.readfile(uri.fsPath);
	}

	writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): void | Thenable<void>
	{
		return this._writeFile(uri, content, options);
	}

	async _writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void>
	{
		const exists = await _.exists(uri.fsPath);
		if (!exists)
		{
			if (!options.create)
			{
				throw vscode.FileSystemError.FileNotFound();
			}

			await _.mkdir(path.dirname(uri.fsPath));
		}
		else
		{
			if (!options.overwrite)
			{
				throw vscode.FileSystemError.FileExists();
			}
		}

		return _.writefile(uri.fsPath, content as Buffer);
	}

	delete(uri: vscode.Uri, options: { recursive: boolean; }): void | Thenable<void>
	{
		if (options.recursive)
		{
			return _.rmrf(uri.fsPath);
		}

		return _.unlink(uri.fsPath);
	}

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void | Thenable<void>
	{
		return this._rename(oldUri, newUri, options);
	}

	async _rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): Promise<void>
	{
		const exists = await _.exists(newUri.fsPath);
		if (exists)
		{
			if (!options.overwrite)
			{
				throw vscode.FileSystemError.FileExists();
			}
			else
			{
				await _.rmrf(newUri.fsPath);
			}
		}

		const parentExists = await _.exists(path.dirname(newUri.fsPath));
		if (!parentExists)
		{
			await _.mkdir(path.dirname(newUri.fsPath));
		}

		return _.rename(oldUri.fsPath, newUri.fsPath);
	}

	async getChildren(element?: Entry): Promise<Entry[]>
	{
		let glob = String(vscode.workspace.getConfiguration('karateRunner.buildReports').get('toTarget'));
		let buildReportFiles = await vscode.workspace.findFiles(glob).then((value) => { return value; });

		if (element)
		{
			let displayType = String(vscode.workspace.getConfiguration('karateRunner.buildReports').get('activityBarDisplayType'));

			if(displayType === "Shallow")
			{
				let buildReportFilesFiltered = buildReportFiles.filter((reportFile) =>
				{
					return reportFile.toString().startsWith(element.uri.toString());
				});
	
				return buildReportFilesFiltered.map((reportFile) => 
					(
						{ uri: reportFile, type: vscode.FileType.File }
					)
				);
			}
			else
			{
				let children = await this.readDirectory(element.uri);

				let childrenFiltered = children.filter((child) =>
				{
					let childUri = vscode.Uri.file(path.join(element.uri.fsPath, child[0]));
					
					let found = buildReportFiles.find((file) =>
					{
						return file.toString().startsWith(childUri.toString());
					});
					
					return found !== undefined;
				});
	
				return childrenFiltered.map(([name, type]) => 
					(
						{ uri: vscode.Uri.file(path.join(element.uri.fsPath, name)), type: type }
					)
				);
			}
		}

		let workspaceFolder = vscode.workspace.workspaceFolders.filter(folder => folder.uri.scheme === 'file')[0];
		if (workspaceFolder)
		{
			let children = await this.readDirectory(workspaceFolder.uri);

			let childrenFiltered = children.filter((child) =>
			{
				let childUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, child[0]));
				
				let found = buildReportFiles.find((file) =>
				{
					return file.toString().startsWith(childUri.toString());
				});
				
				return found !== undefined;
			});

			if(childrenFiltered.length <= 0)
			{
				return [{ uri: "No reports found...", type: vscode.FileType.Unknown }];
			}

			childrenFiltered.sort((a, b) =>
			{
				if (a[1] === b[1])
				{
					return a[0].localeCompare(b[0]);
				}
				
				return a[1] === vscode.FileType.Directory ? -1 : 1;
			});

			return childrenFiltered.map(([name, type]) => 
				(
					{ uri: vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, name)), type: type }
				)
			);
		}

		return [{ uri: "No reports found...", type: vscode.FileType.Unknown }];
	}

	getTreeItem(element: Entry): vscode.TreeItem
	{
		let treeItem = new vscode.TreeItem
		(
			element.uri,
			element.type === vscode.FileType.Directory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);

		if (element.type === vscode.FileType.File)
		{
			treeItem.command = { command: 'karateRunner.openBuildReport', title: "Open Build Report", arguments: [element.uri] };
			treeItem.contextValue = 'file';
		}

		return treeItem;
	}
}

export default ProviderBuildReports;