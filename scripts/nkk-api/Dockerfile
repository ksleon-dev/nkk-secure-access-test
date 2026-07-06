FROM python:3.11-alpine
WORKDIR /app
RUN pip install --no-cache-dir flask gunicorn
RUN adduser -D -u 10001 -h /home/app app
COPY app.py .
USER app
EXPOSE 9876
CMD ["gunicorn", "-b", "0.0.0.0:9876", "-w", "2", "app:app"]
