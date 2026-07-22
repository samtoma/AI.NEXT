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
# force-dynamic on every data page → build never touches the DB
RUN npm run build

# ---------- run ----------
FROM node:22-bookworm-slim AS run
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CONFIG_DIR=/repo/.claude \
    HOME=/home/node \
    PORT=3000 \
    AINEXT_THINKING_BUDGET=6000
# the app spawns `claude -p …` for every AI turn — it must be on PATH
RUN npm i -g @anthropic-ai/claude-code \
 && mkdir -p /repo/.claude /home/node \
 && chown -R node:node /repo /home/node
WORKDIR /repo/app
COPY --from=build --chown=node:node /repo/app ./
# content read at request time (lesson_content) — mirror the repo layout
COPY --chown=node:node services/extraction/seed/content /repo/services/extraction/seed/content
USER node
EXPOSE 3000
# healthcheck hits the app; the platform restarts it if it wedges
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "start"]
