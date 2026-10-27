# Vendored engine: provenance and modifications

`phyvac.py` in this directory is third-party code. It is not ours, it is not edited in
place, and every difference from the baseline it was taken from is recorded below and
reproducible from `patches/`.

## Provenance

| Field | Value |
|---|---|
| Upstream project | [ShoheiMiyata/phyvac](https://github.com/ShoheiMiyata/phyvac) |
| Upstream copyright | Department of Architecture, School of Engineering, The University of Tokyo |
| Upstream licence | BSD 3-Clause — full text in `LICENSE` |
| **Upstream commit** | **Unknown.** See below. |
| Baseline taken from | `ssh://git@gitlab.hkust-gz.edu.cn:10022/sogroup/hvac_ai_group/simulate_ai.git` |
| Baseline commit | `5b452aa23474216a76d1e57b1d104cef123e1c04` (jiehong, 2026-08-24) |
| Baseline path | repository root, `phyvac.py` |
| Baseline size | 4,924 lines |
| Engine version string | `ver20231120` (`phyvac.py` line 7) |
| Vendored on | 2026-09-21 |

### Why the upstream commit is unknown

The baseline is a fork, and that fork records no upstream provenance: no commit, no tag,
no reference to the upstream project anywhere in its source or documentation. The only
marker is the engine's own version string, `ver20231120`. Recovering the matching
upstream commit would mean searching upstream history for that string, and the local
upstream clone is shallow. This field is left as unknown rather than filled with a guess.

Upstream is currently around 3,900 lines at `ver20260718`, so the baseline is roughly two
and a half years behind. Differences relevant to this project are recorded in
`docs/reference-review.md`.

## Licensing

BSD-3-Clause attaches to the code and is inherited. **The baseline fork ships without it:**
it has no licence file, and no occurrence of BSD, copyright, the University of Tokyo, or
the redistribution clause anywhere in that repository. A downstream fork cannot relicense
what it forked, so this is a compliance gap in that repository and not a reduction in our
obligation. `LICENSE` here is therefore copied from **upstream**, not from the baseline.
Note that upstream has no root licence file either — the text lives in its `Documents/`
directory and has to be copied explicitly.

This simulator ships with the product, which is distribution, so all three clauses bind:
retain the notice and disclaimer in source form, reproduce them in documentation
accompanying a binary distribution, and do not use the copyright holder's name to endorse
the product. Citing the project's published paper is academic courtesy, not a licence
term.

> ⚠️ **Outstanding.** The baseline fork's own modifications — two added classes, a
> redefined chiller specification schema, and its interpolation hardening — are the
> copyright of their authors (HKUST-GZ), who have declared no licence for them. Written
> permission to use and redistribute those modifications has **not** been obtained. This
> does not block internal development but must be resolved before the product is
> delivered to a customer.

## Modifications

Two, in order. Both are reproducible: normalise line endings, then apply `patches/` in
numeric order.

### Line endings

The baseline file uses CRLF. It is stored here with LF, because the product is built and
run on Linux. This is a whole-file transformation and is applied before any patch, so the
patches below are minimal and readable. The file is therefore **not** byte-identical to
its baseline; it is line-for-line identical.

### `patches/0001-numpy2-item.patch` — NumPy 2.x compatibility

Three lines. `float()` applied to a one-element array, which NumPy 2.0 no longer permits,
becomes `.item()`. Affects the chiller and air-source heat pump COP lookups.

Without it the engine raises `TypeError: only 0-dimensional arrays can be converted to
Python scalars` on the DGX, which carries NumPy 2.5. Confirmed by preflight on 2026-09-21.

Upstream made exactly this change on 2026-07-18 and records that calculation results are
unchanged, which is why it is applied rather than pinned: the rule for this vendored
engine is **patch what does not change numbers, pin what does.**

Upstream altered the same lines to add clamping at the same time. That part is
deliberately **not** ported: the baseline already clamps differently, and taking upstream's
version would change results.

## Known defects, deliberately not fixed

Three defects across four sites remain in this baseline, all of which upstream has since
fixed. Unlike the patch above, correcting them **would** change computed results, so under
the rule above they are pinned rather than patched.

| Class | Method | Defect |
|---|---|---|
| `VerticalWaterThermalStorageTank` | `water_density` | higher-order coefficients written as `10e-3`, `10e-6`, `10e-9`, `10e-12` where the correlation calls for `1e-3`, `1e-6`, … — a factor of ten on every higher-order term |
| `VerticalWaterThermalStorageTank` | `water_thermal_conductivity` | Horner evaluation runs `range(len(a) - 2, 0, -1)`, stopping before index zero and dropping the constant term; upstream ends at `-1` |
| `VerticalWaterThermalStorageTank` | `water_specific_heat` | the same off-by-one |
| `AbsorptionChillerESS` | `cal_c` | assigns from `tout_chsp` where the parameter is `tout_ch_sp`, raising `NameError`. Only reachable when requested duty exceeds rated capacity, which is why it appears never to have been executed |

**Why they are left alone: scope, not calibration.** All four sit in components outside
this project's topology family — a stratified thermal storage tank and a gas absorption
chiller. We model water-cooled electric chillers with open cooling towers, so nothing we
assemble calls them. Editing vendored code we do not exercise buys nothing and adds
divergence for the next sync to carry.

They become live if scope grows. One reference plant uses the storage tank and another
site has a buffer tank, so a topology family that includes one must fix the two tank
defects first and re-validate whatever depended on the old numbers.

Pinned as `xfail(strict=True)` in `tests/integrations/test_phyvac_known_defects.py`. Strict
mode means that if a future baseline or patch fixes one, the test reports XPASS and the
suite fails, forcing a decision rather than letting the change slip through.

## Rules

- **Never edit `phyvac.py` in place.** A change that belongs outside the module goes in
  the shim (`__init__.py`); a change that cannot be made from outside goes in `patches/`
  with a test that would fail if it were lost.
- **Every patch needs a stated reason and a guard test.** A patch whose effect cannot be
  observed from a test will be dropped at the next sync without anyone noticing.
- **Characterization baselines are recorded on the DGX**, not on a workstation. Library
  versions differ enough to matter; a workstation on NumPy 1.x cannot even reproduce the
  failure that patch 0001 fixes.

## Syncing to a newer baseline

1. Copy the new file in, normalising line endings to LF.
2. Re-apply `patches/` in order. A patch that no longer applies has either been fixed
   upstream — delete it and note that here — or the surrounding code moved, in which case
   rebase it.
3. Re-run the characterization suite **on the DGX**. Differences are the real content of
   the upgrade; review each one before recording new baselines.
4. Update the provenance table above.
