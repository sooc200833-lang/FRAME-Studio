# Color system workstream

## Goal
Make color selection fast, precise, and visually discoverable.

## Scope
- Add color disc/classic picker modes.
- Add HSB/RGB numeric entry and HEX entry.
- Add eyedropper from the rendered composite.
- Improve palette creation, rename, reorder, import/export, favorites, and recents.
- Preserve current palette categories and local persistence.

## Guardrails
- Own color-specific UI and modules.
- Coordinate shared panel shell with UI workstream.
- Never overwrite user palettes during migration or reset without clear confirmation.

## Acceptance
- Picker modes stay synchronized.
- Numeric and HEX values round-trip accurately.
- Eyedropper samples visible composite color.
- Existing palettes survive upgrade.
- Tests/build pass.
