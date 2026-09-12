# training

Model training and alignment.

Data scarcity governs the plan — one plant and a short record. It is therefore staged: train a
small model on the real data, use it to generate synthetic data, then fine-tune a larger model
on the result. Alignment via RLHF or RLAIF (`PRODUCT.md` §3.4).

Whether to pretrain on PHYVAC simulator output is **not decided** (`PRODUCT.md` §7).

Training data and model weights do not belong in this repo — see the `.gitignore` at the repo
root.
