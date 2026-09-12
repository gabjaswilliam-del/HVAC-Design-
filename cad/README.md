# cad

CAD Studio. Runs **once per installation**, not in the runtime loop.

In: a CAD drawing of the customer's chiller plant.
Out: a 2D visualisation the operator recognises, and a machine-readable topology the rest of
the system can reason over.

An LLM vision step reads the drawing (`PRODUCT.md` §3.1).

Customer drawings are plant data: do not commit them. See the `.gitignore` at the repo root.
