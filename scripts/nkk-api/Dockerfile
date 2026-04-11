FROM python:3.11-slim
RUN pip install --no-cache-dir flask gunicorn
COPY server.py /app/server.py
WORKDIR /app
ENV DATA_DIR=/data
EXPOSE 9876
CMD ["gunicorn", "--bind", "0.0.0.0:9876", "--workers", "2", "--timeout", "30", "server:app"]
