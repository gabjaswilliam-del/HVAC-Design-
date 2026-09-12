# HVAC Agent System — Product Description

**Status:** draft · **Updated:** 2026-09-11 · Chinese mirror: `PRODUCT-zh.md`

---

## 1. What it is

An LLM agent that helps a chiller-plant operator run their plant.

The operator asks in plain language — *"why is efficiency down today?"*, *"will I need a fourth
chiller this afternoon?"*, *"is chiller 3 faulty?"* — and the agent pulls the relevant plant data,
reasons over it, and answers with a recommendation.

**The agent advises; it does not actuate.** Every change to the plant is made by a human. This is a
deliberate product decision, not a missing feature: it removes the safety-certification and
liability burden that blocks autonomous control products, and it means the system can be deployed
alongside an existing PLC rather than replacing it.

## 2. The problem it addresses

A chiller plant is typically the largest single electrical load in a commercial building. It is
usually run by a fixed PLC control policy — reactive IF-THEN rules plus PID loops, with no
foresight — supervised by operators working from experience.

The information needed to do better already exists: the building management system logs chiller
loads, flows, temperatures, and power continuously. But it sits in a database in a form nobody can
act on in the moment. The gap is not sensing, and not (only) optimisation — it is that **no one can
ask the plant a question and get an answer.**

## 3. The parts

The system has six parts. The first runs once at installation; the rest run continuously.

### 3.1 CAD Studio — install-time, once

**In:** a CAD drawing of the customer's chiller plant.
**Process:** an LLM vision step reads the drawing and extracts the plant layout.
**Out:** a 2D visualisation of the plant that the operator recognises, and a machine-readable
topology the rest of the system can reason over.

Runs once per installation; it is not part of the runtime loop.

### 3.2 Agent loop — the core

A fine-tuned LLM running in an agent loop. It receives a natural-language question, decides which
tools to call, calls them, and composes an answer with a recommendation.

Tools available to it include the forecasting capability (§3.3), direct data queries, and
diagnostic checks. An agent-runtime harness and an agent-memory system are **optional
infrastructure, not requirements** — the loop must work without them.

### 3.3 Forecasting — cooling load

Time-series foundation models forecast the plant's cooling load over a short horizon, so the
operator knows what is coming before it arrives — how many chillers to stage, when the morning ramp
starts. Exposed to the agent as a tool behind a defined interface.

### 3.4 Model training

Real operational data is the governing constraint: we have one plant and a short record. The plan
is therefore staged — train a small model on the real data, use it to generate synthetic data, then
fine-tune a larger model on the result. Pretraining on simulator output is under consideration but
**not decided**. Alignment via RLHF or RLAIF.

### 3.5 PHYVAC simulator

A physics-based HVAC simulator (open source, BSD licence) that stands in for the customer's real
plant during development and evaluation. It can be run faster than real time, driven with arbitrary
load profiles, and configured into plants we have no access to — none of which is possible against a
live building.

It is a development and evaluation environment, **not a component of the shipped product**.

### 3.6 Security and ethics

A later workstream. Scope is **not yet defined**.

## 4. How the parts fit together

**At installation (once):**

```
CAD drawing ──► CAD Studio ──► plant visualisation + machine-readable topology
```

**At runtime (the loop):**

```
operator question
      │
      ▼
   agent loop ──► tools: forecasting · data queries · diagnostics
      │
      ▼
answer + recommendation ──► operator decides ──► operator acts (or does not)
```

**In development (offline):**

```
real plant data ─┐
                 ├──► train / evaluate models ──► deploy into the agent
PHYVAC simulator ┘
```

## 5. Design constraints (deliberate, not accidental)

- **Advisory, never autonomous.** The loop closes through a human. The agent has no write path to
  the plant.
- **The simulator is ours; the plant is the customer's.** Anything that must be tried repeatedly,
  or tried on a plant we do not have, happens in PHYVAC.
- **Data scarcity governs the architecture.** One plant and a short record is why the training plan
  is staged, and why zero-shot foundation models are attractive for forecasting — they need no
  per-plant training data.
- **The agent must degrade gracefully.** If a tool is unavailable or a forecast is unreliable, the
  agent says so rather than guessing.

## 6. Current status (2026-09-11)

| Part | Status |
|---|---|
| CAD Studio | Not started in this repo |
| Agent loop | Not started in this repo |
| Forecasting — cooling load | Not started in this repo |
| Model training | Not started in this repo |
| PHYVAC simulator | Not started in this repo |
| Security and ethics | Not started in this repo |

## 7. Not yet decided

- Detailed product structure beyond the six parts above
- Which agent-runtime framework (if any)
- Whether to pretrain on simulated data
- What data belongs in this repo
- Scope of the security and ethics workstream
- Deployment target and packaging
