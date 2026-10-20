// Bağlantı hatalarını kullanıcı diline çevirir (durum ekranı ve "Bağlantıyı dene" sonucu ortak kullanır).
import type { ApiError } from "$lib/api";
import type { ConnectionConfig } from "$lib/api/types";
import { t } from "$lib/i18n/index.svelte";
import { address, hostPort } from "./connectionInfo";

export interface ErrorText {
  title: string;
  text: string;
}

export function sshTarget(c: Pick<ConnectionConfig, "ssh">): string {
  const user = c.ssh.username ? `${c.ssh.username}@` : "";
  return `${user}${hostPort(c.ssh.host, c.ssh.port)}`;
}

export function describeConnectionError(err: ApiError, c: ConnectionConfig | undefined): ErrorText {
  switch (err.kind) {
    case "auth":
      return { title: t("connections.errors.auth.title"), text: t("connections.errors.auth.text") };
    case "connection":
      return {
        title: t("connections.errors.connection.title", { address: c ? address(c) : "?" }),
        text: t("connections.errors.connection.text"),
      };
    case "timeout":
      return { title: t("connections.errors.timeout.title"), text: t("connections.errors.timeout.text", { seconds: c?.timeoutSec ?? 10 }) };
    case "ssh":
      return { title: t("connections.errors.ssh.title"), text: t("connections.errors.ssh.text", { target: c ? sshTarget(c) : "SSH" }) };
    case "tls":
      return { title: t("connections.errors.tls.title"), text: t("connections.errors.tls.text") };
    default:
      return { title: t(`common.errors.${err.kind}`), text: t("connections.errors.other") };
  }
}
