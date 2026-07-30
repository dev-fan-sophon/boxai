/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Link } from "@tanstack/react-router";
import { ArrowRight, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AnimateInView } from "@/components/animate-in-view";
import { Button } from "@/components/ui/button";
import { CLIENT_APPS } from "@/features/client-apps/constants";
import { DownloadActions } from "@/features/downloads/download-actions";
import { detectPlatform, primaryDownload } from "@/features/downloads/release";
import {
  useAppRelease,
  type ClientAppId,
} from "@/features/downloads/use-app-release";

function ClientAppShowcase(props: { app: ClientAppId; delay: number }) {
  const { t } = useTranslation();
  const meta = CLIENT_APPS[props.app];
  const AppIcon = meta.icon;
  const { release, loading, failed, fallbackUrl } = useAppRelease(props.app);
  const downloads = release?.downloads ?? [];
  const primary = primaryDownload(downloads, detectPlatform());
  const appName = t(meta.nameKey);

  return (
    <AnimateInView delay={props.delay}>
      <article className="border-border/50 bg-card hover:border-border transition-ui flex h-full flex-col rounded-2xl border p-6 shadow-xs md:p-8">
        <div className="bg-muted text-foreground mb-4 flex size-11 items-center justify-center rounded-xl">
          <AppIcon className="size-5" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <h3 className="text-lg font-semibold tracking-tight">{appName}</h3>
        <p className="text-foreground/80 mt-1.5 text-sm font-medium text-pretty">
          {t(meta.taglineKey)}
        </p>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed text-pretty">
          {t(meta.descriptionKey)}
        </p>

        <ul className="mt-5 space-y-2">
          {meta.stepKeys.map((step) => (
            <li key={step} className="flex items-start gap-2">
              <Check
                className="text-primary mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span className="text-muted-foreground text-sm">{t(step)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-2 pt-1">
          <DownloadActions
            downloads={downloads}
            primary={primary}
            loading={loading}
            failed={failed}
            fallbackUrl={fallbackUrl}
            productName={appName}
          />
        </div>

        <div className="mt-3">
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground -ml-2"
            render={
              props.app === "desktop" ? (
                <Link to="/agents" />
              ) : (
                <Link
                  to="/dashboard/$section"
                  params={{ section: meta.section }}
                />
              )
            }
          >
            {props.app === "desktop" ? t("Learn more") : t("Open in console")}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </article>
    </AnimateInView>
  );
}

/**
 * The two BoxAI desktop clients on the marketing page: what each one is for and
 * a download for the visitor's platform straight from the release manifest.
 */
export function ClientApps() {
  const { t } = useTranslation();

  return (
    <section
      aria-label={t("Desktop apps")}
      className="border-border/40 relative z-10 border-t px-6 py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl">
        <AnimateInView className="mb-12 max-w-2xl md:mb-16">
          <p className="text-muted-foreground mb-3 text-xs font-medium tracking-widest uppercase">
            {t("Desktop apps")}
          </p>
          <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
            {t("Two apps that put BoxAI on your own machine")}
          </h2>
          <p className="text-muted-foreground mt-4 text-sm leading-relaxed text-pretty md:text-base">
            {t(
              "Connect points your existing AI coding clients at BoxAI. Desktop runs an AI coworker locally. Both sign in from the browser, and every install stays revocable from your console.",
            )}
          </p>
        </AnimateInView>

        <div className="grid gap-4 md:grid-cols-2">
          <ClientAppShowcase app="connect" delay={100} />
          <ClientAppShowcase app="desktop" delay={160} />
        </div>
      </div>
    </section>
  );
}
