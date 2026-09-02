FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Note: 0.0.0.0 is required INSIDE the container so Docker can publish the
# port to the host — this is not the same as exposing it on your network.
# Docker's own port mapping (see docker-compose.yml) still only publishes
# to 127.0.0.1 on the host, keeping the app local-first.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
