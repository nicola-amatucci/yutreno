# How YuTreno was developed: use of AI

> Italian copy: [it/USO_IA.md](it/USO_IA.md).

YuTreno is a personal project of Nicola Amatucci, developed with an AI coding assistant, Claude by Anthropic, used through Claude Code. This page says who did what, so that readers, reviewers and reusers can judge the work for what it is.

## Who did what

The author directed the project. He chose what to build and in which order: the request that started the plan (more trains with timetables and passengers), the network, the import of real lines, the research requests that came from comparing YuTreno with the literature. He took the design decisions: sixteen are recorded, with their reasons and dates, in [ROADMAP.md](ROADMAP.md#decisions-taken-by-the-owner). He approved the plan of every phase before it started, chose the real lines, downloaded or provided the data the development environment could not reach, and reviewed the results.

The assistant wrote most of the code, the checks and the documentation, under that direction. It also read the standards (Subset-026, Subset-039, Subset-130, EULYNX, the X2Rail-5 moving block specification) from their official texts and recorded what is implemented, simplified or missing in the requirement matrix. During development every commit made with the assistant carried a `Co-Authored-By` trailer naming the model. The public repository starts from a single commit of 10 November 2026; that history, about 250 commits, each with the reason for the change, stays in the author's private repository and can be shown on request, for example to a reviewer.

## How the work is checked

Code written with an AI assistant is only as trustworthy as the checks around it, so the project relies on checks rather than on review alone:

- 23 checks (`npm run verify`) that run the simulator and fail when a rule is switched off;
- a golden master of 282 runs (`npm run golden`) and one of the page, so that a change meant to leave behaviour alone cannot change any number unnoticed;
- deterministic campaigns with fingerprints, so that every result can be reproduced byte for byte;
- the requirement matrix (`docs/traceability/matrix.csv`), where every implemented or simplified requirement has a tagged test.

Errors found on the way are recorded rather than hidden: the roadmap lists, for example, an overrun the engine did not count, found while adding the odometry drift, and how it was fixed.

## What this means for reusers

- Copyright and licences are in [NOTICE.md](../NOTICE.md): the code is under the EUPL-1.2, the documentation under CC BY 4.0.
- The reference onboard is not validated against the ERA braking curve tool ([CURVE_VALIDATION.md](CURVE_VALIDATION.md)), and nothing in YuTreno is a certified implementation of a standard. It is a tool for research and teaching.
- Results obtained with YuTreno in a publication should cite the version (commit) used and, where it matters, say that the simulator was developed with AI assistance.
