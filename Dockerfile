FROM node:22-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    python3 \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY solver/requirements.txt solver/requirements.txt
RUN python3 -m venv solver/.venv \
  && solver/.venv/bin/pip install --upgrade pip \
  && solver/.venv/bin/pip install --no-cache-dir -r solver/requirements.txt

COPY . .

RUN DATABASE_URL=postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder \
  npx prisma generate

CMD ["npm", "run", "solver:worker"]
