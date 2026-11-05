# FRAME Studio

2D animation and 3D line-art studio, designed iPad-first with a dark interface.

## Product direction

FRAME Studio is an original drawing and animation application inspired by the broad workflow of modern digital-art tools. Its focus is comic production, editable line art, area-based coloring, line animation, and 3D-to-2D workflows.

## Development status

- [x] Private GitHub repository connected
- [ ] Import and verify the existing v0.1 browser prototype
- [ ] Implement bounded flood fill across visible layers
- [ ] Separate line-art and color layers
- [ ] Add adjustable fill tolerance
- [ ] Build independent line selection and Line Boil
- [ ] Add comic tone and filter tools
- [ ] Add timeline and keyframe animation
- [ ] Add 3D primitive assembly and 2D line conversion
- [ ] Add secure server-side GPT/Claude API integration
- [ ] Develop native iPad drawing support

## Architecture principles

1. Keep the drawing document format independent of the web and native iPad front ends.
2. Separate rendering, fill, line, tone, animation, and 3D modules.
3. Keep provider API keys on a server; never commit secrets to this repository.
4. Prefer small, testable changes with a clear commit history.

See [docs/roadmap.md](docs/roadmap.md) and [docs/architecture.md](docs/architecture.md).
