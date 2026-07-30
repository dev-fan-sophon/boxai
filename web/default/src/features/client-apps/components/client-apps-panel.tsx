/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Link } from "@tanstack/react-router";
import { ArrowDownToLine, ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { IconBadge } from "@/components/ui/icon-badge";
import { detectPlatform, primaryDownload } from "@/features/downloads/release";
import {
  useAppRelease,
  type ClientAppId,
} from "@/features/downloads/use-app-release";
import { cn } from "@/lib/utils";

import { CLIENT_APPS } from "../constants";
import { useClientAppSessions } from "../hooks/use-client-app-sessions";

function ClientAppCard(props: { app: ClientAppId; connected: number }) {
  const { t } = useTranslation();
  const meta = CLIENT_APPS[props.app];
  const AppIcon = meta.icon;
  const { release, fallbackUrl } = useAppRelease(props.app);
  const primary = primaryDownload(release?.downloads ?? [], detectPlatform());
  const downloadUrl = primary?.url || fallbackUrl;

  return (
    <div className="bg-card ring-border flex flex-col gap-3 rounded-xl px-4 py-3.5 ring-1">
      <div className="flex items-start gap-3">
        <IconBadge size="md" tone="primary">
          <AppIcon aria-hidden="true" />
        </IconBadge>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold">{t(meta.nameKey)}</p>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                props.connected > 0
                  ? "bg-success/10 text-success"
                  : "bg-muted text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  props.connected > 0 ? "bg-success" : "bg-muted-foreground/50",
                )}
                aria-hidden="true"
              />
              {props.connected > 0
                ? t("{{count}} device(s) connected", { count: props.connected })
                : t("Not connected")}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 text-xs text-pretty">
            {t(meta.taglineKey)}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={!downloadUrl}
          render={
            downloadUrl ? (
              <a href={downloadUrl} download rel="noopener noreferrer" />
            ) : undefined
          }
        >
          <ArrowDownToLine data-icon="inline-start" />
          {t("Download")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          render={
            <Link to="/dashboard/$section" params={{ section: meta.section }} />
          }
        >
          {t("Open")}
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Desktop client apps at a glance: what they are, whether this account has a
 * device signed in, and a one-click download for the current platform.
 */
export function ClientAppsPanel() {
  const sessions = useClientAppSessions();

  return (
    <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
      <ClientAppCard app="connect" connected={sessions.connect.length} />
      <ClientAppCard app="desktop" connected={sessions.desktop.length} />
    </div>
  );
}
