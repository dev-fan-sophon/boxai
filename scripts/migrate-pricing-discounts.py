#!/usr/bin/env python3
"""One-time discount migration; never changes billing prices.

Prepare (read-only): python3 scripts/migrate-pricing-discounts.py --plan /tmp/discounts.json
After deploying the unified discount UI/API, review and apply that exact plan:
  python3 scripts/migrate-pricing-discounts.py --apply /tmp/discounts.json

Uses BOXAI_BASE_URL, BOXAI_ADMIN_USER_ID and BOXAI_ADMIN_TOKEN. The plan contains
the original pricing snapshot for audit/recovery, but no credentials. A stale
revision or changed catalog aborts; repeated application is a no-op.
"""

import argparse
import copy
import json
import os
import subprocess
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from urllib.parse import quote


def api(base, method, path, body=None):
    wrapper = (
        Path(__file__).resolve().parents[1]
        / ".agents/skills/managing-boxai-platform/scripts/boxai-api"
    )
    command = [str(wrapper), method, path]
    if body is not None:
        command.append(json.dumps(body))
    response = subprocess.run(
        command,
        env=dict(os.environ, BOXAI_BASE_URL=base),
        capture_output=True,
        text=True,
        check=True,
        timeout=60,
    )
    result = json.loads(response.stdout)
    if result.get("success") is not True:
        raise RuntimeError(result.get("message", "API request failed"))
    return result["data"]


def migrated_percent(pricing, reference):
    if pricing.get("official_price_percent") is not None:
        return pricing["official_price_percent"], "preserved saved percentage"
    if (
        pricing["mode"] == "per-token"
        and reference
        and reference.get("quick_discount_supported") is True
        and reference.get("model_ratio", 0) > 0
        and pricing.get("model_ratio") is not None
    ):
        percent = (
            Decimal(str(pricing["model_ratio"]))
            / Decimal(str(reference["model_ratio"]))
            * 100
        )
        if percent.is_finite() and 1 <= percent <= 100:
            return float(
                percent.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            ), "one-time legacy input-price percentage"
    return 100, "no verified flat percentage; hide legacy badge"


def billing(rows):
    return {
        row["model_name"]: {
            k: v for k, v in row["pricing"].items() if k != "official_price_percent"
        }
        for row in rows
    }


def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--plan", type=Path)
    mode.add_argument("--apply", type=Path)
    args = parser.parse_args()
    base = os.environ.get("BOXAI_BASE_URL", "https://you-box.com").rstrip("/")
    current = api(base, "GET", "/api/admin/pricing/models")

    if args.plan:
        updates, audit = [], []
        for row in current["models"]:
            name, pricing = row["model_name"], row["pricing"]
            if pricing["mode"] == "unset":
                continue
            reference = None
            if (
                pricing.get("official_price_percent") is None
                and pricing["mode"] == "per-token"
            ):
                reference = api(
                    base,
                    "GET",
                    "/api/admin/pricing/models/reference?model_name="
                    + quote(name, safe=""),
                )["reference"]
            percent, reason = migrated_percent(pricing, reference)
            updated = dict(pricing, official_price_percent=percent)
            updates.append({"model_name": name, "pricing": updated})
            audit.append(
                {
                    "model_name": name,
                    "percent": percent,
                    "reason": reason,
                    "reference": reference,
                }
            )
        plan = {"base_url": base, "before": current, "updates": updates, "audit": audit}
        with args.plan.open("x") as file:
            json.dump(plan, file, indent=2, ensure_ascii=False)
            file.write("\n")
        print(
            json.dumps(
                {
                    "plan": str(args.plan),
                    "models": len(updates),
                    "audit": [
                        {k: v for k, v in item.items() if k != "reference"}
                        for item in audit
                    ],
                },
                indent=2,
            )
        )
        return

    plan = json.loads(args.apply.read_text())
    if plan["base_url"] != base:
        raise RuntimeError("Plan belongs to another API origin")
    expected = copy.deepcopy(plan["before"]["models"])
    updates = {row["model_name"]: row["pricing"] for row in plan["updates"]}
    for row in expected:
        if row["model_name"] in updates:
            row["pricing"] = updates[row["model_name"]]
    if billing(expected) != billing(plan["before"]["models"]):
        raise RuntimeError("Plan would change billing prices")
    expected_prices = {row["model_name"]: row["pricing"] for row in expected}
    if {
        row["model_name"]: row["pricing"] for row in current["models"]
    } == expected_prices:
        print("ALREADY_APPLIED: all percentages and prices match")
        return
    if current != plan["before"]:
        raise RuntimeError(
            "Pricing or catalog changed; prepare and review a fresh plan"
        )
    api(
        base,
        "POST",
        "/api/admin/pricing/models/bulk",
        {
            "revision": current["revision"],
            "models": plan["updates"],
        },
    )
    after = api(base, "GET", "/api/admin/pricing/models")
    if {
        row["model_name"]: row["pricing"] for row in after["models"]
    } != expected_prices:
        raise RuntimeError(
            "Post-write verification failed; inspect the saved plan before any retry"
        )
    print(f"MIGRATION_OK: {len(updates)} models; all billing prices unchanged")


if __name__ == "__main__":
    main()
