import type { Shape } from "../types";
import type tr from "../tr/onboarding";

export default {
  welcomeTitle: "Welcome",
  importTitle: "Import connections",
  subtitle: "From Another Redis Desktop Manager",
  hero: {
    title: "Bring your connections over in two clicks",
    text: "Your Another Redis Desktop Manager connections come over with their passwords, SSH and TLS settings. Nothing changes in ARDM.",
  },
  detect: {
    searching: "Looking for Another Redis Desktop Manager…",
    found: (p) => (p.count === 1 ? "Found {count} connection" : "Found {count} connections"),
    alreadyHere: "{count} already here",
    noneTitle: "No ARDM connections found on this computer",
    noneText: "ARDM keeps its data in:",
    otherMachine: "Using ARDM on another computer? Export the connections from its settings there, then pick the file here.",
    errorTitle: "Couldn't read ARDM's data",
    errorHint: "If ARDM is running, close it and try again.",
    retry: "Search again",
    fromFile: "Import from file (.ardm / JSON)…",
    fileFilter: "ARDM connection file",
    fileTitle: "Choose an ARDM export file",
    fileEmpty: "No connections found in the file",
    readFailed: "Couldn't read the file",
  },
  review: {
    source: "Source",
    columns: {
      name: "Name",
      address: "Address",
      details: "Details",
    },
    selectAll: "Select all",
    summary: "{selected} of {total} connections will be imported",
    duplicates: (p) => (p.count === 1 ? "{count} connection already exists." : "{count} connections already exist."),
    forAll: "For all",
    actions: {
      skip: "Skip",
      replace: "Replace",
      keepBoth: "Keep both",
    },
    replaceHint: "Updates the existing connection's address and credentials; its tag, color and group are kept.",
    exists: "Already exists: {name}",
    warnings: {
      sshKeyMissing: "SSH key file not found: {detail}",
      tlsCaMissing: "CA certificate not found: {detail}",
      tlsCertMissing: "Client certificate not found: {detail}",
      tlsKeyMissing: "Client key not found: {detail}",
      unsupportedOption: "Unsupported setting skipped: {detail}",
    },
    warningsNote: (p) =>
      p.count === 1
        ? "{count} connection needs a look after importing; hover the warning icon for details."
        : "{count} connections need a look after importing; hover the warning icon for details.",
    group: "Put imported connections in the “{group}” group",
    import: (p) => (p.count === 1 ? "Import {count} connection" : "Import {count} connections"),
    nothing: "No connections selected",
  },
  importing: "Importing…",
  importFailed: "Import failed",
  done: {
    added: (p) => (p.count === 1 ? "{count} connection added" : "{count} connections added"),
    replaced: (p) => (p.count === 1 ? "{count} connection updated" : "{count} connections updated"),
    skipped: "{count} skipped",
    nothing: "No connections changed",
    attention: "Needs a look",
    attentionText: "These connections refer to files that weren't found; edit them before connecting.",
    connectTo: "Connect to {name}",
    edit: "Edit",
  },
  skip: "Skip for now",
  newConnection: "New connection",
  home: {
    tagline: "A fast, keyboard-first Redis client",
    newText: "Standalone, Cluster or Sentinel; over SSH and TLS",
    importTitle: "Import from ARDM",
    importText: "Bring over your Another Redis Desktop Manager connections",
    importReady: (p) => (p.count === 1 ? "{count} new connection ready" : "{count} new connections ready"),
    recent: "Recent",
    all: "Connections",
    more: (p) =>
      p.count === 1
        ? "{count} more connection — find it in the sidebar or the command palette."
        : "{count} more connections — find them in the sidebar or the command palette.",
    tips: "Shortcuts",
    tipPalette: "Command palette",
    tipNew: "New connection",
    tipSwitch: "Switch to the first nine connections",
    tipKey: "Go to key",
    tipSettings: "Settings",
  },
} satisfies Shape<typeof tr>;
