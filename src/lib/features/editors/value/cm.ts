// CodeMirror 6 kurulumu: tema CSS değişkenlerinden (açık/koyu kendiliğinden), JSON vurgusu, katlama, arama,
// hex kipi (konum oluğu + satır sonunda ASCII) ve arayüz diline göre CodeMirror ifadeleri.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { i18n, t } from "$lib/i18n/index.svelte";
import { asciiOfHexLine, BYTES_PER_LINE } from "../codec/hex";
import type { Language } from "../codec/formats";

const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--fs-mono)",
    color: "var(--text)",
    backgroundColor: "var(--bg)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.6" },
  ".cm-content": { caretColor: "var(--text)", padding: "6px 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--text)", borderLeftWidth: "1.5px" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--bg-selected-strong) !important",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-sunken)",
    color: "var(--text-3)",
    border: "none",
    borderRight: "1px solid var(--border-subtle)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 8px 0 10px", minWidth: "32px" },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--bg-hover)", color: "var(--text-2)" },
  ".cm-foldGutter .cm-gutterElement": { padding: "0 4px", cursor: "pointer", color: "var(--text-3)" },
  ".cm-foldGutter .cm-gutterElement:hover": { color: "var(--text)" },
  ".cm-foldPlaceholder": {
    backgroundColor: "var(--bg-active)",
    border: "none",
    color: "var(--text-2)",
    borderRadius: "3px",
    padding: "0 4px",
    margin: "0 2px",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent)", color: "inherit" },
  ".cm-nonmatchingBracket": { backgroundColor: "var(--danger-soft)", color: "inherit" },
  ".cm-searchMatch": { backgroundColor: "var(--highlight)", borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent)" },
  ".cm-selectionMatch": { backgroundColor: "var(--bg-active)" },
  ".cm-specialChar": { color: "var(--danger)" },
  ".cm-tooltip": { backgroundColor: "var(--bg-elevated)", border: "1px solid var(--border)", color: "var(--text)" },
  ".cm-panels": { backgroundColor: "var(--bg-sunken)", color: "var(--text)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-search": { padding: "6px 8px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-sm)", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" },
  ".cm-search br": { flexBasis: "100%", height: 0 },
  ".cm-search label": { display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--text-2)", fontSize: "var(--fs-sm)" },
  ".cm-textfield": {
    height: "24px",
    padding: "0 7px",
    margin: 0,
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius)",
    backgroundColor: "var(--bg-input)",
    color: "var(--text)",
    fontFamily: "var(--font-mono)",
    fontSize: "var(--fs-sm)",
  },
  ".cm-textfield:focus": { borderColor: "var(--accent)", outline: "none", boxShadow: "0 0 0 3px var(--accent-soft)" },
  ".cm-button": {
    height: "24px",
    padding: "0 8px",
    margin: 0,
    border: "1px solid var(--border-strong)",
    borderRadius: "var(--radius)",
    backgroundImage: "none",
    backgroundColor: "var(--bg-elevated)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-sm)",
    cursor: "pointer",
  },
  ".cm-button:hover": { backgroundColor: "var(--bg-hover)" },
  ".cm-search button[name=close]": { marginLeft: "auto", border: "none", background: "none", color: "var(--text-3)", fontSize: "16px", cursor: "pointer" },
  ".cm-ascii": {
    marginLeft: "3ch",
    paddingLeft: "1.5ch",
    borderLeft: "1px solid var(--border)",
    color: "var(--text-3)",
    whiteSpace: "pre",
    pointerEvents: "none",
    userSelect: "none",
  },
});

const highlight = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--accent-text)" },
  { tag: tags.string, color: "var(--type-list)" },
  { tag: tags.number, color: "var(--type-zset)" },
  { tag: [tags.bool, tags.null], color: "var(--type-hash)", fontWeight: "500" },
  { tag: [tags.separator, tags.brace, tags.squareBracket, tags.punctuation], color: "var(--text-3)" },
  { tag: tags.invalid, color: "var(--danger)" },
]);

// ───────────── hex kipi ─────────────

/** Tam bir satırın hex genişliği: 16 × "xx " − 1 */
const HEX_WIDTH = BYTES_PER_LINE * 3 - 1;

class AsciiWidget extends WidgetType {
  constructor(
    readonly text: string,
    /** Kısa satırlarda ASCII sütunu hizalı kalsın diye eksik genişlik (karakter) */
    readonly gap: number,
  ) {
    super();
  }

  eq(other: AsciiWidget): boolean {
    return other.text === this.text && other.gap === this.gap;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-ascii";
    span.style.marginLeft = `${3 + this.gap}ch`;
    span.textContent = this.text.padEnd(BYTES_PER_LINE, " ");
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function asciiDecorations(view: EditorView): DecorationSet {
  const widgets = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos);
      if (line.length) widgets.push(Decoration.widget({ widget: new AsciiWidget(asciiOfHexLine(line.text), Math.max(0, HEX_WIDTH - line.length)), side: 1 }).range(line.to));
      pos = line.to + 1;
    }
  }
  return Decoration.set(widgets);
}

const asciiColumn = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = asciiDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = asciiDecorations(update.view);
    }
  },
  { decorations: (v) => v.decorations },
);

/** Yazılan metinden hex dışı karakterler atılır (yapıştırma kaydederken doğrulanır) */
const hexOnly = EditorView.inputHandler.of((view, from, to, text) => {
  if (/^[0-9a-fA-F\s]*$/.test(text)) return false;
  const clean = text.replace(/[^0-9a-fA-F\s]/g, "");
  view.dispatch({ changes: { from, to, insert: clean }, selection: { anchor: from + clean.length }, userEvent: "input.type" });
  return true;
});

function hexMode(): Extension {
  return [lineNumbers({ formatNumber: (n) => ((n - 1) * BYTES_PER_LINE).toString(16).padStart(8, "0") }), asciiColumn, hexOnly];
}

// ───────────── dil ve ifadeler ─────────────

export function languageExtension(lang: Language): Extension {
  if (lang === "json") return [lineNumbers(), foldGutter({ openText: "▾", closedText: "▸" }), json(), syntaxHighlighting(highlight), bracketMatching(), indentOnInput()];
  if (lang === "hex") return hexMode();
  return lineNumbers();
}

function phrases(): Extension {
  if (i18n.locale !== "tr") return [];
  return EditorState.phrases.of({
    Find: t("editors.cm.find"),
    Replace: t("editors.cm.replace"),
    next: t("editors.cm.next"),
    previous: t("editors.cm.previous"),
    all: t("editors.cm.all"),
    "match case": t("editors.cm.matchCase"),
    regexp: t("editors.cm.regexp"),
    "by word": t("editors.cm.byWord"),
    replace: t("editors.cm.replaceOne"),
    "replace all": t("editors.cm.replaceAll"),
    close: t("editors.cm.close"),
    "Go to line": t("editors.cm.gotoLine"),
    go: t("editors.cm.go"),
    "Folded lines": t("editors.cm.folded"),
    "Unfolded lines": t("editors.cm.unfolded"),
    "folded code": t("editors.cm.foldedCode"),
    unfold: t("editors.cm.unfold"),
    "Fold line": t("editors.cm.foldLine"),
    "Unfold line": t("editors.cm.unfoldLine"),
    "Control character": t("editors.cm.controlChar"),
    "current match": t("editors.cm.currentMatch"),
    "on line": t("editors.cm.onLine"),
  });
}

export interface BaseOptions {
  onsave?: () => void;
  /** Esc: işlenirse true */
  onescape?: () => boolean;
}

/** Dil, salt okunurluk ve satır kaydırma dışındaki sabit eklentiler */
export function baseExtensions(opts: BaseOptions): Extension {
  return [
    theme,
    phrases(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorState.allowMultipleSelections.of(true),
    keymap.of([
      ...searchKeymap,
      ...foldKeymap,
      ...historyKeymap,
      ...defaultKeymap,
      indentWithTab,
      { key: "Mod-s", preventDefault: true, run: () => (opts.onsave?.(), true) },
      { key: "Escape", run: () => opts.onescape?.() ?? false },
    ]),
  ];
}
