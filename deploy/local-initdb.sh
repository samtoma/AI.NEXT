#!/bin/bash
# Applies db/migrations/*.sql on first boot, after 00-schema.sql.
# Postgres runs docker-entrypoint-initdb.d entries in alphabetical order, and
# only when the data directory is empty — so this never re-runs on a restart.
set -e
for m in /docker-entrypoint-initdb.d/migrations/*.sql; do
  echo "  applying $(basename "$m")"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -q -f "$m"
done
echo "  all migrations applied"
