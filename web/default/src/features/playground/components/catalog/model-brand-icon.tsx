/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { Suspense, lazy } from "react";

import { LobeIcon } from "@/lib/lobe-icon";

/**
 * `ModelIcon` infers a brand from the raw model name, which requires LobeHub's
 * full model mapping table. It is only the fallback for models the API did not
 * tag with an icon key, so it stays behind a lazy boundary.
 */
const ModelIcon = lazy(() =>
  import("@lobehub/icons/es/features/ModelIcon").then((module) => ({
    default: module.default,
  })),
);

type ModelBrandIconProps = {
  modelName: string;
  icon?: string;
  vendorIcon?: string;
  size?: number;
};

export function ModelBrandIcon(props: ModelBrandIconProps) {
  const iconKey = props.icon?.trim() || props.vendorIcon?.trim();
  const size = props.size ?? 20;

  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center"
    >
      {iconKey ? (
        <LobeIcon name={iconKey} size={size} />
      ) : (
        <Suspense
          fallback={
            <span
              className="bg-muted block rounded-full"
              style={{ width: size, height: size }}
            />
          }
        >
          <ModelIcon model={props.modelName} size={size} type="color" />
        </Suspense>
      )}
    </span>
  );
}
