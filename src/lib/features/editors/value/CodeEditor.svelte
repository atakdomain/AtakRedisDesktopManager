<script lang="ts">
  // CodeMirror sarmalayıcısı. `baseline` değişince belge baştan kurulur (geri alma geçmişi sıfırlanır);
  // kirlilik belgeyi `baseline` ile karşılaştırarak bulunur.
  import { Compartment, EditorState, Text } from "@codemirror/state";
  import { EditorView } from "@codemirror/view";
  import { untrack } from "svelte";
  import type { Language } from "../codec/formats";
  import { baseExtensions, languageExtension } from "./cm";

  interface Props {
    baseline: string;
    /** Taslaktan gelen başlangıç metni (yoksa baseline) */
    initial?: string;
    lang: Language;
    readOnly?: boolean;
    wrap?: boolean;
    ondirty?: (dirty: boolean) => void;
    /** Her belge değişikliğinde (taslak doğrulaması vb.) */
    onchange?: () => void;
    onsave?: () => void;
    onescape?: () => boolean;
    autofocus?: boolean;
    label?: string;
    /** Görünüm yok edilmeden hemen önce son metin (taslak saklamak için) */
    onteardown?: (text: string, dirty: boolean) => void;
  }

  let { baseline, initial, lang, readOnly = false, wrap = true, ondirty, onchange, onsave, onescape, autofocus = false, label, onteardown }: Props = $props();

  let host = $state<HTMLDivElement>();
  let view: EditorView | undefined;
  let baseDoc = Text.empty;
  let dirty = false;

  const langSlot = new Compartment();
  const readOnlySlot = new Compartment();
  const wrapSlot = new Compartment();

  function setDirty(next: boolean) {
    if (next === dirty) return;
    dirty = next;
    ondirty?.(next);
  }

  function createState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        baseExtensions({ onsave: () => onsave?.(), onescape: () => onescape?.() ?? false }),
        langSlot.of(languageExtension(lang)),
        readOnlySlot.of(EditorState.readOnly.of(readOnly)),
        wrapSlot.of(wrap ? EditorView.lineWrapping : []),
        EditorView.contentAttributes.of({ "aria-label": label ?? "", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          setDirty(!update.state.doc.eq(baseDoc));
          onchange?.();
        }),
      ],
    });
  }

  function load(base: string, start: string | undefined) {
    baseDoc = Text.of(base.split(/\r\n?|\n/));
    const state = createState(start ?? base);
    if (view) view.setState(state);
    else if (host) view = new EditorView({ state, parent: host });
    setDirty(start !== undefined && !state.doc.eq(baseDoc));
  }

  $effect(() => {
    const base = baseline;
    const start = initial;
    untrack(() => load(base, start));
  });

  $effect(() => {
    const next = lang;
    untrack(() => view?.dispatch({ effects: langSlot.reconfigure(languageExtension(next)) }));
  });

  $effect(() => {
    const ro = readOnly;
    untrack(() => view?.dispatch({ effects: readOnlySlot.reconfigure(EditorState.readOnly.of(ro)) }));
  });

  $effect(() => {
    const on = wrap;
    untrack(() => view?.dispatch({ effects: wrapSlot.reconfigure(on ? EditorView.lineWrapping : []) }));
  });

  $effect(() => {
    if (autofocus) untrack(() => view?.focus());
  });

  $effect(() => () => {
    if (view) onteardown?.(view.state.doc.toString(), dirty);
    view?.destroy();
    view = undefined;
  });

  export function getText(): string {
    return view?.state.doc.toString() ?? "";
  }

  /** Düzenleme olarak uygular (geri alınabilir) */
  export function replaceText(text: string): void {
    if (!view) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, userEvent: "input.format" });
  }

  /** Şimdiki belge yeni temel olur (kaydettikten sonra) */
  export function markClean(): void {
    if (!view) return;
    baseDoc = view.state.doc;
    setDirty(false);
  }

  /** Taslağı atıp temele döner */
  export function reset(): void {
    load(baseDoc.toString(), undefined);
  }

  export function focus(): void {
    view?.focus();
  }

  export function isDirty(): boolean {
    return dirty;
  }
</script>

<div class="code" bind:this={host}></div>

<style>
  .code {
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .code :global(.cm-editor) {
    height: 100%;
  }
</style>
