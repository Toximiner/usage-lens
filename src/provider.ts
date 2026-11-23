import * as vscode from 'vscode';
import { getConfig, type ResolvedConfig } from './config';
import { getEligibleSymbols, EligibleSymbol } from './symbols';
import { applyFilters } from './filters';
import { isExcluded } from './pathMatcher';
import { isDocumentOverSizeLimit, isInitPy } from './pythonFiles';
import { getLocationCommand } from './locationCommand';

class SymbolCodeLens extends vscode.CodeLens {
    constructor(
        range: vscode.Range,
        public readonly documentUri: vscode.Uri,
        public readonly symbol: EligibleSymbol
    ) {
        super(range);
    }
}

interface ReferenceResult {
    count: number;
    locations: vscode.Location[];
    title: string;
}

export class PythonCodeLensProvider implements vscode.CodeLensProvider, vscode.InlayHintsProvider {
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
    private _onDidChangeInlayHints: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeInlayHints: vscode.Event<void> = this._onDidChangeInlayHints.event;

    private readonly symbolCache = new Map<string, Promise<EligibleSymbol[]>>();
    private readonly rawReferenceCache = new Map<string, Promise<vscode.Location[]>>();
    private readonly referenceResultCache = new Map<string, Promise<ReferenceResult | null>>();

    public refresh(uri?: vscode.Uri) {
        this.invalidate(uri);
        this._onDidChangeCodeLenses.fire();
        this._onDidChangeInlayHints.fire();
    }

    public refreshAfterDocumentChange(uri: vscode.Uri) {
        this.invalidateDocumentSymbols(uri);
        this.rawReferenceCache.clear();
        this.referenceResultCache.clear();
        this._onDidChangeCodeLenses.fire();
        this._onDidChangeInlayHints.fire();
    }

    public invalidate(uri?: vscode.Uri) {
        if (!uri) {
            this.symbolCache.clear();
            this.rawReferenceCache.clear();
            this.referenceResultCache.clear();
            return;
        }

        const prefix = `${uri.toString()}|`;
        this.invalidateDocumentSymbols(uri);
        this.deleteCacheEntries(this.rawReferenceCache, prefix);
        this.deleteCacheEntries(this.referenceResultCache, prefix);
    }

    public dispose() {
        this.symbolCache.clear();
        this.rawReferenceCache.clear();
        this.referenceResultCache.clear();
        this._onDidChangeCodeLenses.dispose();
        this._onDidChangeInlayHints.dispose();
    }

    public async provideCodeLenses(
        document: vscode.TextDocument,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens[]> {
        const config = getConfig(document.uri);

        if (config.displayMode !== 'codeLens' || !(await this.isDocumentEligible(document, config))) {
            return [];
        }

        const eligibleSymbols = await this.getSymbols(document, config);
        if (token.isCancellationRequested) { return []; }

        const candidates: SymbolCodeLens[] = [];
        for (const sym of eligibleSymbols) {
            candidates.push(new SymbolCodeLens(sym.range, document.uri, sym));
            if (document.languageId === 'python' && config.lenses.showImplementations && sym.kind === 'class') {
                candidates.push(new SymbolCodeLens(sym.range, document.uri, { ...sym, kind: 'class-impl' }));
            }
        }

        // VS Code reserves a row for every returned lens, even an empty resolved
        // command. Resolve before returning when counts can be hidden, so omitted
        // lenses never enter the editor layout. Limit concurrent server requests.
        if (config.references.showZero && config.references.minCount === 0) {
            return candidates;
        }
        const resolved: (vscode.CodeLens | null)[] = new Array(candidates.length).fill(null);
        let next = 0;
        const worker = async () => {
            while (!token.isCancellationRequested) {
                const index = next++;
                if (index >= candidates.length) { return; }
                resolved[index] = await this.resolveCodeLens(candidates[index], token);
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
        if (token.isCancellationRequested) { return []; }
        const lenses = resolved.filter((lens): lens is vscode.CodeLens => lens !== null);

        return lenses;
    }

    public async provideInlayHints(
        document: vscode.TextDocument,
        range: vscode.Range,
        token: vscode.CancellationToken
    ): Promise<vscode.InlayHint[]> {
        const config = getConfig(document.uri);
        if (config.displayMode !== 'inline' || !(await this.isDocumentEligible(document, config))) {
            return [];
        }

        const symbols = await this.getSymbols(document, config);
        if (token.isCancellationRequested) { return []; }
        const candidates: EligibleSymbol[] = [];
        for (const sym of symbols) {
            if (sym.range.start.line >= range.start.line && sym.range.start.line <= range.end.line) {
                candidates.push(sym);
                if (document.languageId === 'python' && config.lenses.showImplementations && sym.kind === 'class') {
                    candidates.push({ ...sym, kind: 'class-impl' });
                }
            }
        }

        const hints: (vscode.InlayHint | null)[] = new Array(candidates.length).fill(null);
        let next = 0;
        const worker = async () => {
            while (!token.isCancellationRequested) {
                const index = next++;
                if (index >= candidates.length) { return; }
                const sym = candidates[index];
                try {
                    const result = await this.resolveReferences(document, sym, config);
                    if (!result || token.isCancellationRequested) { continue; }
                    const lineEnd = document.lineAt(sym.selectionRange.start.line).range.end;
                    const part = new vscode.InlayHintLabelPart(` · ${result.title}`);
                    if (result.count > 0) {
                        const locationCommand = getLocationCommand(config.clickAction);
                        part.command = {
                            title: result.title,
                            command: locationCommand.command,
                            arguments: [document.uri, sym.selectionRange.start, result.locations, locationCommand.mode]
                        };
                    }
                    const hint = new vscode.InlayHint(lineEnd, [part]);
                    hint.paddingLeft = true;
                    hints[index] = hint;
                } catch {
                    // A temporarily unavailable language server should not reserve an inline hint.
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, worker));
        return token.isCancellationRequested ? [] : hints.filter((hint): hint is vscode.InlayHint => hint !== null);
    }

    public async resolveCodeLens(
        codeLens: vscode.CodeLens,
        token: vscode.CancellationToken
    ): Promise<vscode.CodeLens | null> {
        if (!(codeLens instanceof SymbolCodeLens)) {
            return null;
        }

        const { documentUri, symbol: sym } = codeLens;
        const config = getConfig(documentUri);
        if (!config.enable || (!config.files.includeInitPy && isInitPy(documentUri))) {
            return null;
        }

        const document = vscode.workspace.textDocuments.find(
            doc => doc.uri.toString() === documentUri.toString()
        ) ?? await vscode.workspace.openTextDocument(documentUri);

        let result: ReferenceResult | null;
        try {
            result = await this.resolveReferences(document, sym, config);
        } catch {
            return null;
        }

        if (token.isCancellationRequested) { return null; }

        if (!result) {
            return null;
        }

        const locationCommand = getLocationCommand(config.clickAction);

        codeLens.command = {
            title: result.title,
            command: result.count > 0 ? locationCommand.command : "",
            arguments: result.count > 0
                ? [documentUri, sym.selectionRange.start, result.locations, locationCommand.mode]
                : []
        };

        return codeLens;
    }

    private async resolveReferences(
        document: vscode.TextDocument,
        sym: EligibleSymbol,
        config: ResolvedConfig
    ): Promise<ReferenceResult | null> {
        const key = this.getReferenceResultCacheKey(document, sym);
        const existing = this.referenceResultCache.get(key);
        if (existing) {
            return existing;
        }

        const result = this.computeReferences(document, sym, config).then(value => {
            if (!value || value.count === 0) { this.referenceResultCache.delete(key); }
            return value;
        }).catch((error: unknown) => {
            this.referenceResultCache.delete(key);
            throw error;
        });
        this.referenceResultCache.set(key, result);
        return result;
    }

    private async computeReferences(
        document: vscode.TextDocument,
        sym: EligibleSymbol,
        config: ResolvedConfig
    ): Promise<ReferenceResult | null> {
        const docCache = new Map<string, vscode.TextDocument>();
        docCache.set(document.uri.toString(), document);

        const rawLocations = await this.getRawReferences(document, sym);
        const locations = sym.kind === 'class-impl'
            ? await this.getImplementationLocations(rawLocations, config, docCache)
            : rawLocations;

        let uniqueLocations = [...new Map(locations.map(loc => [
            `${loc.uri.toString()}|${loc.range.start.line}:${loc.range.start.character}-${loc.range.end.line}:${loc.range.end.character}`, loc
        ])).values()];
        if (config.references.filterDefinitions && document.languageId !== 'python') {
            const definitions = await vscode.commands.executeCommand<Array<vscode.Location | vscode.LocationLink>>(
                'vscode.executeDefinitionProvider', document.uri, sym.selectionRange.start
            ) || [];
            uniqueLocations = uniqueLocations.filter(loc => !definitions.some(def => {
                const uri = 'targetUri' in def ? def.targetUri : def.uri;
                const range = 'targetUri' in def ? (def.targetSelectionRange ?? def.targetRange) : def.range;
                return uri.toString() === loc.uri.toString() && !!range.intersection(loc.range);
            }));
        }
        const filteredLocations = await applyFilters(uniqueLocations, sym, config, document, docCache);
        const count = filteredLocations.length;

        if (count < config.references.minCount || (count === 0 && !config.references.showZero)) {
            return null;
        }

        return {
            count,
            locations: filteredLocations,
            title: this.getTitle(sym, count)
        };
    }

    private async getRawReferences(
        document: vscode.TextDocument,
        sym: EligibleSymbol
    ): Promise<vscode.Location[]> {
        const key = this.getRawReferenceCacheKey(document, sym);
        const existing = this.rawReferenceCache.get(key);
        if (existing) {
            return existing;
        }

        const rawReferences = this.executeReferenceProvider(document.uri, sym.selectionRange.start)
            .then(locations => {
                if (locations.length === 0) { this.rawReferenceCache.delete(key); }
                return locations;
            })
            .catch((error: unknown) => {
                this.rawReferenceCache.delete(key);
                throw error;
            });
        this.rawReferenceCache.set(key, rawReferences);
        return rawReferences;
    }

    private async executeReferenceProvider(
        uri: vscode.Uri,
        position: vscode.Position
    ): Promise<vscode.Location[]> {
        return await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        ) || [];
    }

    private async getImplementationLocations(
        locations: vscode.Location[],
        config: ResolvedConfig,
        docCache: Map<string, vscode.TextDocument>
    ): Promise<vscode.Location[]> {
        const implementationLocations: vscode.Location[] = [];

        for (const loc of locations) {
            if (!config.files.includeInitPy && isInitPy(loc.uri)) {
                continue;
            }

            try {
                const key = loc.uri.toString();
                let locDoc = docCache.get(key);
                if (!locDoc) {
                    locDoc = await vscode.workspace.openTextDocument(loc.uri);
                    docCache.set(key, locDoc);
                }
                const lineText = locDoc.lineAt(loc.range.start.line).text;
                if (/^\s*class\s+\w+\s*\(/.test(lineText)) {
                    implementationLocations.push(loc);
                }
            } catch {
                // ignore unreadable files
            }
        }

        return implementationLocations;
    }

    private async getSymbols(
        document: vscode.TextDocument,
        config: ResolvedConfig
    ): Promise<EligibleSymbol[]> {
        const key = `${document.uri.toString()}|${document.version}|symbols`;
        const existing = this.symbolCache.get(key);
        if (existing) {
            return existing;
        }

        const symbols = getEligibleSymbols(document, config).catch((error: unknown) => {
            this.symbolCache.delete(key);
            throw error;
        });
        this.symbolCache.set(key, symbols);
        return symbols;
    }

    private async isDocumentEligible(
        document: vscode.TextDocument,
        config: ResolvedConfig
    ): Promise<boolean> {
        if (!config.enable || !config.languages.includes(document.languageId)) {
            return false;
        }

        if (!config.files.includeInitPy && isInitPy(document.uri)) {
            return false;
        }

        if (await isDocumentOverSizeLimit(document, config.performance.maxFileSizeKB)) {
            return false;
        }

        return !isExcluded(document.uri, config.exclude);
    }

    private getRawReferenceCacheKey(document: vscode.TextDocument, sym: EligibleSymbol): string {
        return this.getPositionCacheKey(document, sym, 'rawReferences');
    }

    private getReferenceResultCacheKey(document: vscode.TextDocument, sym: EligibleSymbol): string {
        const position = sym.selectionRange.start;
        return [
            document.uri.toString(),
            document.version,
            'referenceResult',
            sym.kind,
            sym.name,
            position.line,
            position.character
        ].join('|');
    }

    private getPositionCacheKey(
        document: vscode.TextDocument,
        sym: EligibleSymbol,
        cacheKind: string
    ): string {
        const position = sym.selectionRange.start;
        return [
            document.uri.toString(),
            document.version,
            cacheKind,
            position.line,
            position.character
        ].join('|');
    }

    private getTitle(sym: EligibleSymbol, count: number): string {
        if (sym.kind === 'class-impl') {
            return `${count} ${count === 1 ? 'implementation' : 'implementations'}`;
        }

        return `${count} ${count === 1 ? 'usage' : 'usages'}`;
    }

    private deleteCacheEntries<T>(cache: Map<string, T>, prefix: string): void {
        for (const key of cache.keys()) {
            if (key.startsWith(prefix)) {
                cache.delete(key);
            }
        }
    }

    private invalidateDocumentSymbols(uri: vscode.Uri): void {
        this.deleteCacheEntries(this.symbolCache, `${uri.toString()}|`);
    }
}
