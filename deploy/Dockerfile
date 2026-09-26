# AI.Next tutor — Next.js app + the `claude` CLI (headless, ANTHROPIC_API_KEY).
# Build context is the REPO ROOT (see docker-compose.yml: context: ..), because
# the server reads services/extraction/seed/content/*.json at request time via
# process.cwd()/../services/... and public/maps/*.json via process.cwd()/public.
# syntax=docker/dockerfile:1

# ---------- build ----------
FROM node:22-bookworm-slim AS build
WORKDIR /repo/app
# deps first for layer caching
COPY app/package.json app/package-lock.json* ./
RUN npm ci
COPY app/ ./
# ---------------------------------------------------------------------------
# BOTH SURFACES ARE BUILT HERE, INTO ONE IMAGE (ADR-0014).
# ---------------------------------------------------------------------------
# `AINEXT_SURFACE` decides two things in next.config.ts: which files count as
# routes (`pageExtensions`) and where the artefact lands (`distDir` — `.next`
# for the student build, `.next-admin` for the console). Because the output
# directories differ, the two builds do not clobber each other and both can live
# in one image; `npm run start` and `npm run start:admin` then each serve the
# artefact their own config points at.
#
# WHY ONE IMAGE AND NOT TWO. The console is a view onto the same students, the
# same sessions and the same turns as the student surface, and its replay
# compares a stored `renderer_version` against the code it is running. Two
# images built from two contexts can be two commits — and the failure that
# produces is an operator being shown a reconstruction that never matches, or
# worse, one that matches and should not. One image makes "the console and the
# product are the same build" a property of the artefact rather than a promise
# about the deploy procedure. The cost is a second `next build` (a few minutes
# on the box) and the admin artefact's disk footprint in the image.
#
# force-dynamic on every data page → neither build touches the DB.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build
RUN npm run build:admin

# ---------- run ----------
FROM node:22-bookworm-slim AS run
# ---------------------------------------------------------------------------
# WHAT THIS BUILD CAN BE TRUSTED WITH (feature 003, T319).
# ---------------------------------------------------------------------------
# `curriculum-scope`: every student reader is scoped to the courses that
# student may see — the Ask context's list of books, /dashboard, the home
# page's counts and book, figures by objective (T314-T318, privacy review §5,
# FR-4202). `deploy/load-course.sh` reads this label off the RUNNING app and
# console containers and REFUSES to load a course while it is missing, because
# an image older than those readers would name a newly loaded book to every
# student, whatever the console's rules say.
#
# The label is a promise about the code in this image, so it ships in the SAME
# release as the scoped readers — never cherry-picked ahead of them. More
# features go here comma-separated; never remove one a release still honours.
# It changes nothing at runtime.
LABEL org.ainext.features="curriculum-scope"
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CONFIG_DIR=/repo/.claude \
    HOME=/home/node \
    PORT=3000 \
    AINEXT_THINKING_BUDGET=1024
# the app spawns `claude -p …` for every AI turn — it must be on PATH
RUN npm i -g @anthropic-ai/claude-code \
 && mkdir -p /repo/.claude /home/node \
 && chown -R node:node /repo /home/node
WORKDIR /repo/app
COPY --from=build --chown=node:node /repo/app ./
# content read at request time (lesson_content) — mirror the repo layout
COPY --chown=node:node services/extraction/seed/content /repo/services/extraction/seed/content
# the S8 coverage audits (coverage/<book>.json), read at request time by the
# console's /courses page beside each course's switch (FR-4309, lib/coverage-status.ts)
COPY --chown=node:node services/extraction/coverage /repo/services/extraction/coverage
USER node
EXPOSE 3000
# The healthcheck hits `/` and is correct for BOTH surfaces: on the student
# build that is the landing page, and on the console build an unauthenticated
# `/` redirects to `/signin`, which `fetch` follows to a 200. It answers "is
# this process serving HTTP", which is the only question a container healthcheck
# should answer — "is the database reachable" belongs to the app's own logs, and
# a healthcheck that failed on it would restart-loop a container that is fine.
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The DEFAULT is the student surface, deliberately: an image started with no
# command serves the thing a child is handed, never the admin console. The
# console service in docker-compose.mvp1.yml overrides this with
# `npm run start:admin`, which is the only difference between the two processes.
CMD ["npm", "run", "start"]
