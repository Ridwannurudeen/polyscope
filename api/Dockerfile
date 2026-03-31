FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/

RUN pip install --no-cache-dir .

COPY api/ api/

RUN adduser --disabled-password --gecos "" --uid 1000 appuser && \
    mkdir -p data && chown -R appuser:appuser /app

VOLUME /app/data
USER appuser

EXPOSE 8020

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8020", "--workers", "1"]
