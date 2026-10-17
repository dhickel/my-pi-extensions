# CC0 portable-core consumers

`saltworks-16` and `orchard-32` contain newly authored, native-resolution art and data. Neither reads, crops, traces, recolors, or scales RPGW art. The 32px drawing is not a scaled version of the 16px drawing. Each original directory includes its CC0 grant, help, and original SVG contour study. `AUTHORSHIP.txt` identifies the source selector. Full frozen cells were authored from original sheets before build, not from normalized terrain.

The fixture manifests contain explicit local executable capabilities. In a copy, set `python_executable` to your existing Python >=3.12 and `tiled_runtime` to your already installed AppRun. No operation installs dependencies or discovers consumer data from the package location. Pillow >=10.1 and NumPy >=1.26 are required.

## Actual core commands

Copy a consumer to a new owned directory. Do not build inside the distributed fixture or existing licensed source project.

```sh
export PYTHONPATH=/home/dhickel/AI/Workspaces/Pi-extensions/tileset-lab/python
export PYTHONDONTWRITEBYTECODE=1
python3 -m tileset_lab inspect --project-root /tmp/tileset-lab-my-consumer --manifest manifest.json --inspection-id source-v1 --initialize-inventory
python3 -m tileset_lab build --project-root /tmp/tileset-lab-my-consumer --manifest manifest.json --candidate-id candidate-v1
```

`inspect` creates an **UNAPPROVED** packet and never creates approval. Inventory initialization is explicit and exclusive. Existing inventories and frozen artwork are not refreshed. Reusing an inspection or candidate ID fails without overwriting its contents. The build command is expected to block until the independent review described below exists.

## Independent source review record

Read `outputs/inspections/source-v1/packet.json`. Actually open all three `source_images` (complete original sheets), both source pages, every `candidate` full-cell role crop, and every `frozen` full-cell crop. There are 14 roles per family, two families per consumer. Check material, convex/concave distinction, direction, contours/density, and authored sparse alpha in full-sheet context. The original and frozen coordinate selections are both recorded. Images in packet pages use nearest-neighbor integer zoom, checkerboard and ground contexts, and dimensions <=2000px.

Write the manifest's `source_review` file only as the independent reviewer, not the fixture selector. The closed record shape is:

- `schema_version`: integer `1`
- `consumer`: exact packet consumer
- `reviewer`: closed object with `id` (actual reviewer/session identity), `kind` (`independent` for actual image review), `independent_of` (exact packet `author_id`), and `image_capable` (boolean, actual capability/access)
- `packet`: closed `{path, sha256}`, copied from the inspect report
- `tool_sha256`: exact packet `tool.sha256`
- `verdict`: `PASS` only after actual complete review; otherwise `BLOCKED`
- `entries`: exactly one closed `{binding, observations, verdict}` per packet role

Each `binding` is the **entire unchanged role object** from `packet.roles`. It includes pack/family/role, source identity/path/file hash, catalog path/hash, candidate and independently frozen coordinates, material names/mode, raw and visible-RGBA crop hashes, frozen candidate hash, complete original context hash, page hash/dimensions, and pixel-correspondence diagnostic. `observations` is specific semantic evidence from the images actually viewed, not boilerplate or a computed equality assertion. Every entry must be current and `PASS` for guarded build. Negative review remains blocked even when hashes match. A record cannot approve an author as its own reviewer.

The backend validates completeness/provenance/pixels; JSON cannot demonstrate that a reviewer actually viewed artwork. The independent review process owns that fact. No backend operation produces an actual visual PASS. Unittest helpers write explicit `TEST-ONLY` trust records solely to exercise the same production parser/guard. Those require `build --test-trust`, produce `CANDIDATE_TEST_ONLY`, and never certify actual image review.

## Output and data contract

The complete versioned closed manifest is `manifest.json`; the complete catalog and finite scene data are `data/catalog.json` and `data/scenes.json`. Role coordinates are absolute cells and shuffled. No origin or 5x7 geometry is inferred. Source slots explicitly cover the entire declared frame grid; true empty sprite slots are excluded. The pair covers 20x36 and 44x28 sprites, non-row-major ordered frames, direct nonempty aliases, supplied 70/130/40ms timing, and materialized authoring-default 100ms timing. Components are complete source pixel rectangles, including 64px and 128px tall manually placed cliffs.

A successful guarded build creates a stable, unselected bundle under `outputs/candidates/<candidate-id>/`: root Tiled project, six external TSX, seven editable finite TMX, terrain atlases (16 opaque candidates and 15 alpha candidates with null mask 0), complete component images, full registrations/provenance, source inventory, playback, all-mask/connected-pattern/parts galleries, a consumer scene, boundary-time playback previews, and bounded checker/ground pages. References remain consumer-relative after independent package/consumer relocation.

`provenance.json` records full source rectangles and destination rectangles for quarters, complete component/frame geometry, mask registries, declared map coverage, effective non-occlusion counts, and animation probes. Preview PNGs are **computational**, not native proof. `output-inventory.json` hashes every payload file; itself and `report.json` are outside its self-referential boundary. Old approved outputs and selectors are never changed by these operations. Native validation/review and publication are not Phase 01 CLI operations.

## Reproduction tests

```sh
cd /home/dhickel/AI/Workspaces/Pi-extensions/tileset-lab
PYTHONPATH="$PWD/python" PYTHONDONTWRITEBYTECODE=1 python3 -W error::ResourceWarning -m unittest discover -s test/python -v
```

Tests exercise the real production guard with explicit synthetic trust. They independently reconstruct all masks from frozen full cells, enumerate 512 3x3 vertex neighborhoods and 81 partial constraints per mode, check all uint8 products and alpha boundaries, strict elapsed-greater-than animation timing, closed schema/path/inventory/license failures, honest updated-hash wrong convex/concave/direction selection against an unchanged frozen oracle, complete frames/stamps, visibility/non-occlusion, preservation, real cross-process locking, and actual CLI relocation from unrelated cwd.

`author_fixtures.py` is an exclusive **new-art authorship** command, not a reference-maintenance operation. It refuses existing destinations. Production code does not import it. Reauthoring original art or choosing different roles invalidates all affected approval and requires another independent reviewer.
