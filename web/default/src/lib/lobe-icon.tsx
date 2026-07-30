/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
/**
 * LobeHub Icon Loader
 *
 * Renders an icon from `@lobehub/icons` by its API-provided key.
 *
 * Supports:
 * - Basic: "OpenAI", "OpenAI.Color"
 * - Chained properties: "OpenAI.Avatar.type={'platform'}"
 *
 * The icon key comes from backend data, so it cannot be statically analysed.
 * Instead of importing the package barrel (which pulls all ~309 brands into
 * the bundle) each brand is resolved through the generated loader registry and
 * arrives in its own chunk.
 */
import { useEffect, useState } from "react";

import { LOBE_ICON_LOADERS } from "./lobe-icon-registry.generated";

type IconComponent = React.ComponentType<Record<string, unknown>>;
type IconProps = Record<string, string | number | boolean>;

// `undefined` = not requested yet, `null` = resolved but unavailable.
const moduleCache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

function loadIconModule(baseKey: string): Promise<unknown> {
  const existing = inFlight.get(baseKey);
  if (existing) return existing;

  const loader = LOBE_ICON_LOADERS[baseKey];
  const request = loader
    ? loader()
        .then((module) => module.default ?? null)
        .catch(() => null)
    : Promise.resolve(null);

  const tracked = request.then((module) => {
    moduleCache.set(baseKey, module);
    return module;
  });
  inFlight.set(baseKey, tracked);
  return tracked;
}

/**
 * Reads the resolved brand module from the shared cache during render so a
 * remounting cell (table rows, virtualized lists) never flashes a placeholder
 * for an icon that was already downloaded.
 */
function useIconModule(baseKey: string): unknown {
  const [, setRevision] = useState(0);

  useEffect(() => {
    if (moduleCache.has(baseKey)) return;
    let active = true;
    void loadIconModule(baseKey).then(() => {
      if (active) setRevision((revision) => revision + 1);
    });
    return () => {
      active = false;
    };
  }, [baseKey]);

  return moduleCache.has(baseKey) ? moduleCache.get(baseKey) : undefined;
}

/**
 * Parse a property value from string to appropriate type
 * @param raw - Raw string value
 * @returns Parsed value (boolean, number, or string)
 */
function parseValue(raw: string | undefined | null): string | number | boolean {
  if (raw == null) return true;

  let v = String(raw).trim();

  // Remove curly braces
  if (v.startsWith("{") && v.endsWith("}")) {
    v = v.slice(1, -1).trim();
  }

  // Remove quotes
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }

  // Boolean
  if (v === "true") return true;
  if (v === "false") return false;

  // Number
  if (/^-?\d+(?:\.\d+)?$/.test(v)) return Number(v);

  // Return as string
  return v;
}

function resolveComponent(
  module: unknown,
  segments: string[],
): { Icon: IconComponent; propStartIndex: number } | null {
  const base = module as Record<string, unknown> | undefined;
  if (!base) return null;

  const sub = segments.length > 1 ? base[segments[1]] : undefined;
  if (sub) {
    return { Icon: sub as IconComponent, propStartIndex: 2 };
  }

  if (typeof base !== "function" && typeof base !== "object") return null;
  return {
    Icon: base as unknown as IconComponent,
    propStartIndex: segments.length > 1 && /^[A-Z]/.test(segments[1]) ? 2 : 1,
  };
}

function parseChainedProps(
  segments: string[],
  propStartIndex: number,
  size: number,
): IconProps {
  const props: IconProps = {};

  for (let i = propStartIndex; i < segments.length; i++) {
    const segment = segments[i];
    if (!segment) continue;

    const equalsIndex = segment.indexOf("=");
    if (equalsIndex === -1) {
      props[segment.trim()] = true;
      continue;
    }

    props[segment.slice(0, equalsIndex).trim()] = parseValue(
      segment.slice(equalsIndex + 1).trim(),
    );
  }

  if (props.size == null) props.size = size;
  return props;
}

function IconPlaceholder(props: { size: number; letter?: string }) {
  return (
    <div
      className="bg-muted text-muted-foreground flex items-center justify-center rounded-full text-xs font-medium"
      style={{ width: props.size, height: props.size }}
    >
      {props.letter}
    </div>
  );
}

export type LobeIconProps = {
  /** Icon key from the API, e.g. "OpenAI", "OpenAI.Color", "Claude.Avatar". */
  name: string | undefined | null;
  size?: number;
};

export function LobeIcon(props: LobeIconProps) {
  const size = props.size ?? 20;
  const trimmedName = typeof props.name === "string" ? props.name.trim() : "";
  const segments = trimmedName.split(".");
  const module = useIconModule(segments[0] ?? "");

  if (!trimmedName) return <IconPlaceholder size={size} letter="?" />;

  // Still downloading: keep the footprint stable without flashing a letter.
  if (module === undefined) return <IconPlaceholder size={size} />;

  const resolved = resolveComponent(module, segments);
  if (!resolved) {
    return (
      <IconPlaceholder
        size={size}
        letter={trimmedName.charAt(0).toUpperCase()}
      />
    );
  }

  const { Icon } = resolved;
  return (
    <Icon {...parseChainedProps(segments, resolved.propStartIndex, size)} />
  );
}
