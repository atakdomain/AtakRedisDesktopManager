import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./app.css";
import { mount } from "svelte";
import App from "./App.svelte";
import { inTauri } from "$lib/api";

// Pencere ilk çizim bitene dek gizli kalır (beyaz parlama olmasın)
async function showWindow() {
  if (!inTauri) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().show();
}

mount(App, {
  target: document.getElementById("app")!,
  props: { onready: () => requestAnimationFrame(() => void showWindow()) },
});
