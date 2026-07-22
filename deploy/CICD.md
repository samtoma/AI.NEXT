# CI/CD — GitHub Actions → OCI

Two workflows:

- **`.github/workflows/ci.yml`** — on every push/PR touching `app/**`, GitHub-hosted:
  `npm ci` → `tsc --noEmit` → `next build`. Catches breakage before it can deploy.
- **`.github/workflows/deploy-oci.yml`** — on push to `main` (or manual **Run workflow**),
  runs **on the OCI box** via a self-hosted runner: rebuilds the Docker stack in `deploy/`
  and health-checks `localhost:3100`. No inbound SSH; secrets stay on the box.

## One-time setup on the OCI box

### 1. Register a self-hosted runner (outbound-only; polls GitHub)
GitHub → repo **Settings → Actions → Runners → New self-hosted runner** (Linux · x64).
Run the download/config commands it shows you. When prompted for **labels, add `oci`**:

```bash
# (GitHub gives you the exact ./config.sh line + token)
./config.sh --url https://github.com/samtoma/AI.NEXT --token <TOKEN> --labels oci --name oci-box
# install as a service so it survives reboots:
sudo ./svc.sh install
sudo ./svc.sh start
```

Make sure the runner's user can talk to Docker:
```bash
sudo usermod -aG docker "$USER"    # then re-login / restart the runner service
```

> Security note: a self-hosted runner executes workflow code from the repo. Fine for a
> private repo you control. It runs as its own user — do **not** run it as root, and it
> never needs access to the talent.reletix.com stack.

### 2. Put the secret on the box (never in GitHub)
```bash
cat > ~/ainext.env <<'EOF'
POSTGRES_PASSWORD=your-strong-password
EOF
chmod 600 ~/ainext.env
```
The deploy workflow copies this into `deploy/.env` at build time. `deploy/.env` is gitignored.
There's **no API key** — the `claude` CLI runs on your Claude subscription (next step).

### 3. First deploy + one-time Claude login
- Merge the branch to `main`, **or** go to **Actions → Deploy to OCI → Run workflow** and
  pick your branch. The runner builds and starts the stack, then health-checks it.
- **Log the CLI in once** (OAuth can't run inside CI — it needs your browser):
  `cd <repo>/deploy && docker compose exec app claude` → approve in your browser.
  The login lives in the `claude_cfg` volume and **survives every future auto-deploy**
  (`up -d --build` never touches the volume). You only re-login after a `docker compose down -v`.
- Do the Cloudflare tunnel step once (see `deploy/DEPLOY.md` + `cloudflared-ingress.example.yml`).

## After that
Every push to `main` (touching app/content/deploy) redeploys automatically. The Postgres
volume persists across deploys; the seed runs only on the first boot. To reload data after
content changes, `docker compose down -v` on the box then re-run the workflow.

## Alternative (if you can't run a runner on the box)
Switch `deploy-oci.yml` to `runs-on: ubuntu-latest` and SSH in with
[`appleboy/ssh-action`], using a deploy key + host stored as GitHub secrets, running
`cd <path> && git pull && cd deploy && docker compose up -d --build`. This needs the box
reachable by SSH (public IP or a Cloudflare tunnel for SSH). The self-hosted runner avoids
opening any inbound port, which is why it's the default here.
