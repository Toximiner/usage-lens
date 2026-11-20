import * as vscode from 'vscode';
import { PythonCodeLensProvider } from './provider';
import { invalidateConfigCache, getConfig } from './config';
import { invalidateClassificationCache } from './classifier';

const debouncers = new Map<string, NodeJS.Timeout>();

export function activate(context: vscode.ExtensionContext) {
    const provider = new PythonCodeLensProvider();

    // Register CodeLens provider for python text files
    const codeLensProvider = vscode.languages.registerCodeLensProvider(
        { scheme: 'file' },
        provider
    );
    context.subscriptions.push(codeLensProvider, provider);

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('usageLens.toggle', async () => {
            const config = vscode.workspace.getConfiguration('usageLens');
            const current = config.get<boolean>('enable');
            await config.update('enable', !current, vscode.ConfigurationTarget.Global);
            provider.refresh();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('usageLens.refresh', () => {
            provider.refresh();
        })
    );

    // Watch Configurations
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('usageLens')) {
                invalidateConfigCache();
                provider.refresh();
            }
        })
    );

    // Watch Documents
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (!getConfig(e.document.uri).languages.includes(e.document.languageId)) {
                return;
            }

            const key = e.document.uri.toString();
            const config = getConfig(e.document.uri);
            const existing = debouncers.get(key);
            if (existing) {
                clearTimeout(existing);
            }
            const timer = setTimeout(() => {
                debouncers.delete(key);
                provider.refreshAfterDocumentChange(e.document.uri);
            }, config.performance.debounceMs);
            debouncers.set(key, timer);
        })
    );

    // Clean up debouncers when documents close
    context.subscriptions.push(
        vscode.workspace.onDidCloseTextDocument((doc) => {
            const key = doc.uri.toString();
            const timer = debouncers.get(key);
            if (timer) {
                clearTimeout(timer);
                debouncers.delete(key);
            }
            provider.invalidate(doc.uri);
            invalidateConfigCache(doc.uri);
        })
    );

    // Re-query after switching editors and during initial language-server indexing.
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (editor && getConfig(editor.document.uri).languages.includes(editor.document.languageId)) { provider.refresh(editor.document.uri); }
    }));
    const startupTimers = [2000, 5000, 10000, 20000, 40000].map(delay =>
        setTimeout(() => provider.refresh(), delay)
    );
    context.subscriptions.push({ dispose: () => startupTimers.forEach(clearTimeout) });

    // Watch Folders
    context.subscriptions.push(
        vscode.workspace.onDidChangeWorkspaceFolders(() => {
            invalidateClassificationCache();
            provider.refresh();
        })
    );
}

export function deactivate() {
    for (const timer of debouncers.values()) {
        clearTimeout(timer);
    }
    debouncers.clear();
}
