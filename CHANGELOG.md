# Changelog

## 0.1.2

- Use the available display name Universal Usage Lens for the initial Marketplace release.

## 0.1.1

- Use the Marketplace identifier `Toximiner.universal-usage-lens`; the original identifier was already taken.
- Keep the display name Usage Lens and the `usageLens` settings unchanged.

## 0.1.0 — Usage Lens

- Fork CodeLens Lite with separate extension identity, commands and settings.
- Add TypeScript, JavaScript, React and CSS-family language-provider support.
- Remove hidden counters before editor layout, eliminating empty CodeLens rows.
- Count imports and exclude declarations by default.
- Retry initial queries and avoid caching empty language-server results indefinitely.

## Upstream history

# Change Log

## [0.1.5]
- Improved: CodeLens resolution now caches document symbols, raw references, and filtered reference results per document version.
- Improved: class reference and implementation lenses share the same raw reference-provider result instead of asking Pylance twice for the same position.
- Improved: document edits now invalidate only the edited Python document's symbol cache while clearing reference caches globally, preserving cross-file count consistency after the debounce delay.

## [0.1.4]
- Fixed: `pythonCodeLensLite.clickAction` set to `reveal` now navigates to a matching reference instead of opening the same peek-style references UI.
- Fixed: `pythonCodeLensLite.references.filterImports` now also filters import-target CodeLens results and recognizes multiline Python import statements.

## [0.1.2]
- Added: `pythonCodeLensLite.files.includeInitPy` controls whether `__init__.py` files show CodeLens and contribute to reference counts.
- Improved: CodeLens resolution now uses the lens document instead of the active editor, which is safer with multiple open Python files.
- Improved: large-file checks avoid copying the full document text when file metadata is available.
- Removed: unused Mocha/test-electron scaffold and test bundle output.

## [0.1.1]
- Fixed: methods declared inside classes were not displaying their reference CodeLens. The Python symbol provider reports class methods as `SymbolKind.Method` (not `SymbolKind.Function`), and the detector has been updated to accept both kinds when traversing class bodies.

## [0.1.0]
- Initial release. Added configurable options for classes, methods, functions, module level declarations, and targeted imports scopes. Fully decoupled dependencies.
