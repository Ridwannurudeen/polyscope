FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/

RUN pip install --no-cache-dir .

COPY bot/ bot/
# api/ provides shared DB helpers consumed by bot loops (alert + digest)
COPY api/ api/

RUN adduser --disabled-password --gecos "" --uid 1000 appuser
USER appuser

CMD ["python", "-m", "bot.main"]
