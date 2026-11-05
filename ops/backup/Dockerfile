FROM postgres:18-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends awscli nodejs ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY services/backend/scripts/ops/database-backup.sh /app/database-backup.sh
COPY ops/backup/run.sh /app/run.sh
USER postgres
ENTRYPOINT []
CMD ["bash", "/app/run.sh"]
